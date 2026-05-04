"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useScoreStore } from "@/store/score-store";
import { saveSnapshot } from "@/lib/autosave";
import AutosaveRecoveryDialog from "@/components/AutosaveRecoveryDialog";
import {
  getSongs,
  saveSong,
  deleteSong,
  renameSong,
  setSongFolder,
  setSongs as writeLocalSongs,
  updateSong,
  SongBankEntry,
} from "@/lib/song-bank";
import {
  CLOUD_ENABLED,
  cloudDeleteSong,
  cloudPutSong,
  enqueueOffline,
  extractJoinCode,
  getDeviceId,
  isTransient,
  setDeviceId,
  syncSongbook,
  type SyncStatus as CloudSyncStatus,
} from "@/lib/song-cloud";

type SyncStatus = "idle" | CloudSyncStatus;

// Stable empty array for selectors that need a fallback. Returning `[]`
// inline from a zustand selector creates a new reference per call and
// triggers a "getSnapshot should be cached" loop.
const EMPTY_STRINGS: string[] = [];

export default function MySongsModal({ onClose }: { onClose: () => void }) {
  const score = useScoreStore(s => s.score);
  const setScore = useScoreStore(s => s.setScore);
  const setUIState = useScoreStore(s => s.setUIState);
  const currentSongId = useScoreStore(s => s.uiState.currentSongId);
  // Selector returns the raw value (undefined-safe via store rehydrate
  // migration). Default applied OUTSIDE the selector against a module-
  // level constant so reference equality holds across renders.
  const collapsedFoldersRaw = useScoreStore(s => s.uiState.collapsedFolders);
  const collapsedFolders = collapsedFoldersRaw ?? EMPTY_STRINGS;
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
  const [showRawCode, setShowRawCode] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  // Per-row UI state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Menu and folder picker render at FIXED position anchored to the
  // kebab button — this escapes the modal's overflow-y-auto, which was
  // clipping/swallowing taps on iPad.
  type Anchor = { entry: SongBankEntry; top: number; right: number };
  const [menuAnchor, setMenuAnchor] = useState<Anchor | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<Anchor | null>(null);
  const [historyForTitle, setHistoryForTitle] = useState<string | null>(null);

  const openKebab = (entry: SongBankEntry, e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuAnchor({
      entry,
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  };

  const toggleFolderCollapse = (folder: string) => {
    const set = new Set(collapsedFolders);
    if (set.has(folder)) set.delete(folder);
    else set.add(folder);
    setUIState({ collapsedFolders: Array.from(set) });
  };

  // All distinct folder names across the bank, sorted — used by the
  // folder picker so the user doesn't have to remember/retype names.
  const folderNames = useMemo(() => {
    const set = new Set<string>();
    for (const s of songs) if (s.folder) set.add(s.folder);
    return Array.from(set).sort();
  }, [songs]);

  // Group entries by folder. Sorted: "(Unfiled)" first, then named folders
  // alphabetically; songs within a folder by savedAt newest-first.
  const grouped = useMemo(() => {
    const buckets = new Map<string, SongBankEntry[]>();
    for (const s of songs) {
      const key = s.folder || "";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(s);
    }
    const folderNames = Array.from(buckets.keys()).filter(k => k !== "").sort();
    const result: Array<{ name: string; label: string; entries: SongBankEntry[] }> = [];
    if (buckets.has("")) {
      result.push({ name: "", label: "(Unfiled)", entries: buckets.get("")! });
    }
    for (const f of folderNames) {
      result.push({ name: f, label: f, entries: buckets.get(f)! });
    }
    return result;
  }, [songs]);

  const refreshLocal = () => setSongsState(getSongs().slice().reverse());

  const runSync = async (): Promise<void> => {
    const merged = await syncSongbook({ onStatus: setSyncStatus });
    setSongsState(merged.slice().reverse());
  };

  useEffect(() => {
    void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Share links always point at the deployed Pages site so they're
  // resolvable from any device. (Using window.location would emit
  // http://localhost:3000/... when generated during local dev, which
  // the iPad can't reach.)
  const SHARE_BASE = "https://gibsonds.github.io/NotationApp/";
  const buildShareLink = (id: string): string =>
    `${SHARE_BASE}?join=${encodeURIComponent(id)}`;

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(buildShareLink(deviceId));
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      /* clipboard blocked — the input below shows the link as a fallback */
    }
  };

  const handleCopyDeviceId = async () => {
    try {
      await navigator.clipboard.writeText(deviceId);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const handleApplyPastedCode = async () => {
    const next = extractJoinCode(pasteCode);
    if (!next || next === deviceId) return;
    setDeviceId(next);
    setDeviceIdState(next);
    setPasteCode("");
    // After switching identity, the local list is from the OLD device — wipe
    // it so we don't push old songs into the new songbook.
    writeLocalSongs([]);
    setSongsState([]);
    await runSync();
  };

  // Save logic. The default Save UPDATES the current song (matching by
  // currentSongId) instead of always creating a new entry — that's the
  // root cause of the "duplicates pile up every time I save" complaint.
  // Save As (asNew=true) explicitly creates a new entry; useful for
  // forking/copying a song.
  const performSave = async (asNew: boolean) => {
    if (!score) return;
    const title = saveTitle.trim() || score.title || "Untitled Song";

    let entry: SongBankEntry | undefined;
    const localList = getSongs();
    const existing = !asNew && currentSongId ? localList.find(s => s.id === currentSongId) : null;
    if (existing) {
      // Update in place — no new id, no duplicate.
      const updated = updateSong(existing.id, { title, score, savedAt: Date.now() });
      entry = updated || undefined;
    } else {
      saveSong(title, score);
      const fresh = getSongs();
      entry = fresh[fresh.length - 1];
    }
    refreshLocal();
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);

    if (entry) setUIState({ currentSongId: entry.id });

    if (!CLOUD_ENABLED || !entry) return;
    setSyncStatus("syncing");
    try {
      await cloudPutSong({
        id: entry.id,
        title: entry.title,
        score: entry.score,
        savedAt: entry.savedAt,
        folder: entry.folder ?? null,
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

  const handleSave = () => performSave(false);
  const handleSaveAs = () => performSave(true);

  const handleLoad = async (entry: SongBankEntry) => {
    // Take an autosave snapshot of the OUTGOING score before replacing it.
    // Recovery from this snapshot is how we get back from accidental Loads
    // that overwrite unsaved work — exactly what bit us before.
    if (score) {
      try { await saveSnapshot(score); } catch { /* best-effort */ }
    }
    setScore(entry.score);
    setUIState({ currentSongId: entry.id });
    onClose();
  };

  const startRename = (entry: SongBankEntry) => {
    setRenamingId(entry.id);
    setRenameValue(entry.title);
    setMenuAnchor(null);
  };

  const commitRename = async (entry: SongBankEntry) => {
    const next = renameValue.trim();
    setRenamingId(null);
    if (!next || next === entry.title) return;
    const updated = renameSong(entry.id, next);
    refreshLocal();
    if (!updated || !CLOUD_ENABLED) return;
    // Push the rename to cloud (same id, new title — replaces the entry).
    try {
      await cloudPutSong({
        id: updated.id,
        title: updated.title,
        score: updated.score,
        savedAt: updated.savedAt,
        folder: updated.folder ?? null,
      });
    } catch (err) {
      if (isTransient(err)) {
        enqueueOffline({
          type: "put",
          id: updated.id,
          title: updated.title,
          score: updated.score,
          savedAt: updated.savedAt,
        });
        setSyncStatus("offline");
      }
    }
  };

  const handleMoveToFolder = (entry: SongBankEntry) => {
    // Promote the menu anchor into a picker anchor at the same position
    // so the picker drops where the menu was.
    if (!menuAnchor) return;
    setPickerAnchor({ ...menuAnchor, entry });
    setMenuAnchor(null);
  };

  const applyFolder = async (entry: SongBankEntry, folder: string | null) => {
    setPickerAnchor(null);
    setSongFolder(entry.id, folder);
    refreshLocal();
    if (!CLOUD_ENABLED) return;
    try {
      await cloudPutSong({
        id: entry.id,
        title: entry.title,
        score: entry.score,
        savedAt: entry.savedAt,
        folder: folder ?? null,
      });
    } catch (err) {
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
  };

  const applyNewFolder = async (entry: SongBankEntry) => {
    setPickerAnchor(null);
    const next = window.prompt(`New folder name:`, "");
    if (!next || !next.trim()) return;
    await applyFolder(entry, next.trim());
  };

  const [historyForId, setHistoryForId] = useState<string | null>(null);

  const handleViewHistory = (entry: SongBankEntry) => {
    setMenuAnchor(null);
    setHistoryForTitle(entry.title);
    setHistoryForId(entry.id);
  };

  // Find groups of duplicate-titled songs and delete all but the newest
  // (highest savedAt) per title. Both local and cloud — keeps the user
  // out of the "every save creates another copy and they pile up" trap.
  const handleCleanupDuplicates = async () => {
    const list = getSongs();
    const byTitle = new Map<string, SongBankEntry[]>();
    for (const s of list) {
      const k = s.title.trim().toLowerCase();
      if (!byTitle.has(k)) byTitle.set(k, []);
      byTitle.get(k)!.push(s);
    }
    const toDelete: SongBankEntry[] = [];
    for (const entries of byTitle.values()) {
      if (entries.length <= 1) continue;
      entries.sort((a, b) => b.savedAt - a.savedAt);
      toDelete.push(...entries.slice(1));
    }
    if (toDelete.length === 0) {
      window.alert("No duplicates found.");
      return;
    }
    const summary = toDelete
      .slice(0, 5)
      .map(e => `• ${e.title} (${new Date(e.savedAt).toLocaleString()})`)
      .join("\n");
    const more = toDelete.length > 5 ? `\n…and ${toDelete.length - 5} more` : "";
    const ok = window.confirm(
      `Delete ${toDelete.length} duplicate ${toDelete.length === 1 ? "song" : "songs"}? Newest copy of each title is kept.\n\n${summary}${more}`
    );
    if (!ok) return;
    for (const entry of toDelete) {
      deleteSong(entry.id);
      if (CLOUD_ENABLED) {
        try { await cloudDeleteSong(entry.id); } catch { /* best-effort */ }
      }
    }
    refreshLocal();
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
              title={
                currentSongId && songs.some(s => s.id === currentSongId)
                  ? "Update the current song (no duplicate)"
                  : "Create a new song"
              }
            >
              {justSaved
                ? "Saved!"
                : currentSongId && songs.some(s => s.id === currentSongId)
                ? "Save"
                : "Save Song"}
            </button>
            {currentSongId && songs.some(s => s.id === currentSongId) && (
              <button
                onClick={handleSaveAs}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 active:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                title="Save as a new entry (keeps the current one)"
              >
                Save As…
              </button>
            )}
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
            <div className="divide-y divide-gray-100">
              {grouped.map(group => {
                const collapsed = collapsedFolders.includes(group.name || "_unfiled");
                return (
                <div key={group.name || "_unfiled"}>
                  {grouped.length > 1 && (
                    <button
                      type="button"
                      onClick={() => toggleFolderCollapse(group.name || "_unfiled")}
                      className="w-full px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-50 hover:bg-gray-100 active:bg-gray-200 border-b border-gray-100 flex items-center gap-2 transition-colors"
                    >
                      <svg
                        className={`w-3 h-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                      </svg>
                      <span>{group.label}</span>
                      <span className="text-gray-400 font-normal">{group.entries.length}</span>
                    </button>
                  )}
                  {!collapsed && (
                  <ul className="divide-y divide-gray-100">
                    {group.entries.map(entry => (
                      <li key={entry.id} className="flex items-center px-5 py-3 hover:bg-gray-50 gap-3 relative">
                        <div className="flex-1 min-w-0">
                          {renamingId === entry.id ? (
                            <input
                              type="text"
                              autoFocus
                              value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") commitRename(entry);
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              onBlur={() => commitRename(entry)}
                              className="w-full px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => startRename(entry)}
                              className="text-sm font-medium text-gray-900 truncate text-left hover:text-blue-700 w-full"
                              title="Click to rename"
                            >
                              {entry.title}
                            </button>
                          )}
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
                          onClick={(e) => openKebab(entry, e)}
                          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors shrink-0"
                          title="More"
                          aria-label="More actions"
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <circle cx="5" cy="12" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="19" cy="12" r="2" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                  )}
                </div>
                );
              })}
            </div>
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
                  <div className="text-xs text-gray-500 mb-1">
                    Share this songbook with another device
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1.5 text-xs bg-white border border-gray-200 rounded text-gray-700 truncate">
                      {buildShareLink(deviceId)}
                    </code>
                    <button
                      onClick={handleCopyShareLink}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded transition-colors shrink-0"
                    >
                      {linkCopied ? "Copied!" : "Copy link"}
                    </button>
                  </div>
                  <button
                    onClick={() => setShowRawCode(s => !s)}
                    className="text-xs text-gray-500 hover:text-gray-700 mt-2"
                  >
                    {showRawCode ? "Hide raw code" : "Show raw code"}
                  </button>
                  {showRawCode && (
                    <div className="flex items-center gap-2 mt-2">
                      <code className="flex-1 px-2 py-1.5 text-xs font-mono bg-white border border-gray-200 rounded text-gray-700 truncate">
                        {deviceId}
                      </code>
                      <button
                        onClick={handleCopyDeviceId}
                        className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-100 active:bg-gray-200 rounded transition-colors shrink-0"
                      >
                        {codeCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  )}
                </div>
                <div className="pt-2 border-t border-gray-200">
                  <div className="text-xs text-gray-500 mb-1">
                    Or paste a share link / code from another device
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={pasteCode}
                      onChange={e => setPasteCode(e.target.value)}
                      placeholder="paste link or code"
                      className="flex-1 px-2 py-1.5 text-xs bg-white border border-gray-200 rounded text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleApplyPastedCode}
                      disabled={
                        !pasteCode.trim() || extractJoinCode(pasteCode) === deviceId
                      }
                      className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded transition-colors shrink-0"
                    >
                      Apply
                    </button>
                  </div>
                  <div className="text-xs text-amber-600 mt-1">
                    Replaces the local song list with the linked device's.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-4 border-t border-gray-200 flex justify-between items-center">
          <button
            onClick={handleCleanupDuplicates}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors"
            title="Delete duplicate-titled songs, keeping the newest of each"
          >
            Clean up duplicates
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* Kebab menu — fixed-positioned at the button anchor so it isn't
          clipped by the modal's overflow-y-auto song list (the bug that
          made taps unreliable on iPad). */}
      {menuAnchor && (
        <>
          <div className="fixed inset-0 z-[110]" onClick={() => setMenuAnchor(null)} />
          <div
            className="fixed z-[120] w-48 bg-white rounded-lg shadow-2xl border border-gray-200 py-1 text-sm"
            style={{ top: menuAnchor.top, right: menuAnchor.right }}
          >
            <button
              onClick={() => startRename(menuAnchor.entry)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 text-gray-700"
            >
              Rename
            </button>
            <button
              onClick={() => handleMoveToFolder(menuAnchor.entry)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 text-gray-700"
            >
              Move to folder…
            </button>
            <button
              onClick={() => handleViewHistory(menuAnchor.entry)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 text-gray-700"
            >
              View history
            </button>
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => { const e = menuAnchor.entry; setMenuAnchor(null); handleDelete(e.id); }}
              className="w-full text-left px-3 py-2 hover:bg-red-50 active:bg-red-100 text-red-600"
            >
              Delete
            </button>
          </div>
        </>
      )}

      {/* Folder picker — also fixed-positioned for the same reason. */}
      {pickerAnchor && (
        <>
          <div className="fixed inset-0 z-[110]" onClick={() => setPickerAnchor(null)} />
          <div
            className="fixed z-[120] w-56 bg-white rounded-lg shadow-2xl border border-gray-200 py-1 text-sm max-h-[60vh] overflow-y-auto"
            style={{ top: pickerAnchor.top, right: pickerAnchor.right }}
          >
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-400">Move to…</div>
            <button
              onClick={() => applyFolder(pickerAnchor.entry, null)}
              className={`w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 ${
                !pickerAnchor.entry.folder ? "text-blue-700 font-medium" : "text-gray-700"
              }`}
            >
              {!pickerAnchor.entry.folder && "✓ "}(Unfiled)
            </button>
            {folderNames.map(f => (
              <button
                key={f}
                onClick={() => applyFolder(pickerAnchor.entry, f)}
                className={`w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 ${
                  pickerAnchor.entry.folder === f ? "text-blue-700 font-medium" : "text-gray-700"
                }`}
              >
                {pickerAnchor.entry.folder === f && "✓ "}{f}
              </button>
            ))}
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => applyNewFolder(pickerAnchor.entry)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 text-blue-700"
            >
              + New folder…
            </button>
          </div>
        </>
      )}

      {/* Per-song history (autosave snapshots filtered by title). Restores
          the chosen snapshot via setScore — which auto-snapshots the
          current state first, so picking a history entry is itself reversible. */}
      {historyForTitle && (
        <AutosaveRecoveryDialog
          filterTitle={historyForTitle}
          cloudSongId={historyForId ?? undefined}
          onClose={() => {
            setHistoryForTitle(null);
            setHistoryForId(null);
            onClose();
          }}
        />
      )}
    </div>
  );
}
