"use client";

import { useEffect, useState } from "react";
import { useScoreStore } from "@/store/score-store";
import {
  getSongs,
  saveSong,
  deleteSong,
  setSongs as writeLocalSongs,
  SongBankEntry,
} from "@/lib/song-bank";
import {
  CLOUD_ENABLED,
  cloudDeleteSong,
  cloudGetSong,
  cloudListSongs,
  cloudPutSong,
  enqueueOffline,
  flushQueue,
  getDeviceId,
  hasPendingOps,
  isTransient,
  setDeviceId,
} from "@/lib/song-cloud";

type SyncStatus = "idle" | "syncing" | "ok" | "offline";

export default function MySongsModal({ onClose }: { onClose: () => void }) {
  const score = useScoreStore(s => s.score);
  const setScore = useScoreStore(s => s.setScore);
  const [songs, setSongsState] = useState<SongBankEntry[]>(() =>
    getSongs().slice().reverse()
  );
  const [saveTitle, setSaveTitle] = useState(score?.title || "");
  const [justSaved, setJustSaved] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    CLOUD_ENABLED ? "syncing" : "idle"
  );
  const [deviceId, setDeviceIdState] = useState<string>(() =>
    CLOUD_ENABLED ? getDeviceId() : ""
  );
  const [pasteCode, setPasteCode] = useState("");
  const [showSync, setShowSync] = useState(false);
  const [copied, setCopied] = useState(false);

  const refreshLocal = () => setSongsState(getSongs().slice().reverse());

  // Pull cloud list, hydrate cloud-only songs, push local-only songs
  // (auto-migrate from old localStorage-only setup). Returns when finished.
  const syncWithCloud = async (): Promise<void> => {
    if (!CLOUD_ENABLED) return;
    setSyncStatus("syncing");
    try {
      if (hasPendingOps()) await flushQueue();

      const local = getSongs();
      const summaries = await cloudListSongs();
      const localById = new Map(local.map(e => [e.id, e]));
      const cloudIds = new Set(summaries.map(s => s.id));
      const merged: SongBankEntry[] = [];

      for (const summary of summaries) {
        const localEntry = localById.get(summary.id);
        if (localEntry && localEntry.savedAt >= summary.updatedAt) {
          try {
            await cloudPutSong({
              id: summary.id,
              title: localEntry.title,
              score: localEntry.score,
              savedAt: localEntry.savedAt,
            });
          } catch {
            /* keep local; retry next time */
          }
          merged.push(localEntry);
        } else {
          try {
            const dto = await cloudGetSong(summary.id);
            merged.push({
              id: dto.id,
              title: dto.title,
              savedAt: dto.savedAt,
              score: dto.score,
            });
          } catch {
            if (localEntry) merged.push(localEntry);
          }
        }
      }

      for (const entry of local) {
        if (cloudIds.has(entry.id)) continue;
        try {
          await cloudPutSong({
            id: entry.id,
            title: entry.title,
            score: entry.score,
            savedAt: entry.savedAt,
          });
          merged.push(entry);
        } catch (err) {
          merged.push(entry);
          if (isTransient(err)) {
            enqueueOffline({
              type: "put",
              id: entry.id,
              title: entry.title,
              score: entry.score,
              savedAt: entry.savedAt,
            });
          }
        }
      }

      merged.sort((a, b) => a.savedAt - b.savedAt);
      writeLocalSongs(merged);
      setSongsState(merged.slice().reverse());
      setSyncStatus("ok");
    } catch (err) {
      setSyncStatus("offline");
      console.warn("[my-songs] sync failed", err);
    }
  };

  useEffect(() => {
    void syncWithCloud();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopyDeviceId = async () => {
    try {
      await navigator.clipboard.writeText(deviceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API blocked — user can still read the value */
    }
  };

  const handleApplyPastedCode = async () => {
    const next = pasteCode.trim();
    if (!next || next === deviceId) return;
    setDeviceId(next);
    setDeviceIdState(next);
    setPasteCode("");
    // After switching identity, the local list is from the OLD device — wipe
    // it so we don't push old songs into the new songbook.
    writeLocalSongs([]);
    setSongsState([]);
    await syncWithCloud();
  };

  const handleSave = async () => {
    if (!score) return;
    const title = saveTitle.trim() || score.title || "Untitled Song";
    saveSong(title, score);
    refreshLocal();
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);

    if (!CLOUD_ENABLED) return;
    const fresh = getSongs();
    const entry = fresh[fresh.length - 1];
    if (!entry) return;
    setSyncStatus("syncing");
    try {
      await cloudPutSong({
        id: entry.id,
        title: entry.title,
        score: entry.score,
        savedAt: entry.savedAt,
      });
      setSyncStatus("ok");
    } catch (err) {
      if (isTransient(err)) {
        enqueueOffline({
          type: "put",
          id: entry.id,
          title: entry.title,
          score: entry.score,
          savedAt: entry.savedAt,
        });
        setSyncStatus("offline");
      } else {
        setSyncStatus("ok");
        console.warn("[my-songs] cloud save failed", err);
      }
    }
  };

  const handleLoad = (entry: SongBankEntry) => {
    setScore(entry.score);
    onClose();
  };

  const handleDelete = async (id: string) => {
    deleteSong(id);
    refreshLocal();
    if (!CLOUD_ENABLED) return;
    setSyncStatus("syncing");
    try {
      await cloudDeleteSong(id);
      setSyncStatus("ok");
    } catch (err) {
      if (isTransient(err)) {
        enqueueOffline({ type: "delete", id });
        setSyncStatus("offline");
      } else {
        setSyncStatus("ok");
      }
    }
  };

  const badge = (() => {
    if (syncStatus === "idle") return null;
    const map = {
      syncing: { color: "bg-blue-400", label: "Syncing…" },
      ok: { color: "bg-green-500", label: "Synced" },
      offline: { color: "bg-amber-500", label: "Offline — will retry" },
    } as const;
    const { color, label } = map[syncStatus];
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <span className={`w-1.5 h-1.5 rounded-full ${color}`} aria-hidden />
        {label}
      </span>
    );
  })();

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-gray-900 text-base">My Songs</h2>
            {badge}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {score ? (
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
            <input
              type="text"
              value={saveTitle}
              onChange={e => setSaveTitle(e.target.value)}
              placeholder={score.title || "Song name"}
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={e => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") onClose();
              }}
            />
            <button
              onClick={handleSave}
              className={`px-4 py-1.5 text-sm font-medium text-white rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                justSaved
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
              }`}
            >
              {justSaved ? "Saved!" : "Save Song"}
            </button>
          </div>
        ) : (
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
            <p className="text-sm text-gray-500">Open or create a score to save it here.</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {songs.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">
              {syncStatus === "syncing"
                ? "Loading…"
                : score
                ? "No songs saved yet. Enter a name above and click Save Song."
                : "No songs saved yet."}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {songs.map(entry => (
                <li key={entry.id} className="flex items-center px-5 py-3 hover:bg-gray-50 gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{entry.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {new Date(entry.savedAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handleLoad(entry)}
                    className="px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 active:bg-blue-100 border border-blue-200 rounded-lg transition-colors shrink-0"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 rounded-lg transition-colors shrink-0"
                    title="Remove from My Songs"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {CLOUD_ENABLED && (
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
            <button
              onClick={() => setShowSync(s => !s)}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <svg
                className={`w-3 h-3 transition-transform ${showSync ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Sync settings
            </button>
            {showSync && (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">This device's sync code</div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1.5 text-xs font-mono bg-white border border-gray-200 rounded text-gray-700 truncate">
                      {deviceId}
                    </code>
                    <button
                      onClick={handleCopyDeviceId}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-100 active:bg-gray-200 rounded transition-colors shrink-0"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">
                    Paste another device's code to share its songbook
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={pasteCode}
                      onChange={e => setPasteCode(e.target.value)}
                      placeholder="paste sync code"
                      className="flex-1 px-2 py-1.5 text-xs font-mono bg-white border border-gray-200 rounded text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleApplyPastedCode}
                      disabled={!pasteCode.trim() || pasteCode.trim() === deviceId}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded transition-colors shrink-0"
                    >
                      Apply
                    </button>
                  </div>
                  <div className="text-xs text-amber-600 mt-1">
                    Switching codes replaces the local song list with the new device's.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
