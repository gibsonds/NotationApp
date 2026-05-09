"use client";

import { useEffect, useMemo, useState } from "react";
import { listSnapshots, loadSnapshot, deleteSnapshot, AutosaveSnapshot } from "@/lib/autosave";
import { useScoreStore } from "@/store/score-store";
import {
  CLOUD_ENABLED,
  cloudGetVersion,
  cloudListVersions,
} from "@/lib/song-cloud";
import type { VersionEntry } from "@/lib/song-cloud-types";
import { getSongs, saveSong } from "@/lib/song-bank";

interface AutosaveRecoveryDialogProps {
  onClose: () => void;
  /** When set, only show snapshots whose title matches (case-insensitive
   *  exact match). Used by My Songs to scope the recovery list to one
   *  song's history. */
  filterTitle?: string;
  /** When set, also fetch cloud versions (named revisions, daily
   *  milestones, recent auto) for this song id and show them above the
   *  local IndexedDB snapshots. */
  cloudSongId?: string;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${date}, ${time}`;
}

/**
 * Lists IndexedDB autosave snapshots, newest first. Click a row to restore
 * (replaces the current score; the previous state is itself snapshot first
 * so the user can always undo a restore).
 */
export default function AutosaveRecoveryDialog({ onClose, filterTitle, cloudSongId }: AutosaveRecoveryDialogProps) {
  const setScore = useScoreStore((s) => s.setScore);
  const currentScore = useScoreStore((s) => s.score);
  const addMessage = useScoreStore((s) => s.addMessage);

  const [snapshots, setSnapshots] = useState<Omit<AutosaveSnapshot, "score">[] | null>(null);
  const [cloudVersions, setCloudVersions] = useState<VersionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listSnapshots()
      .then((all) => {
        if (filterTitle) {
          const needle = filterTitle.toLowerCase();
          setSnapshots(all.filter(s => (s.title || "").toLowerCase() === needle));
        } else {
          setSnapshots(all);
        }
      })
      .catch((err) => setError(err.message ?? "Failed to read autosave history"));
  }, [filterTitle]);

  useEffect(() => {
    if (!cloudSongId || !CLOUD_ENABLED) {
      setCloudVersions(null);
      return;
    }
    cloudListVersions(cloudSongId)
      .then(setCloudVersions)
      .catch(() => setCloudVersions([]));
  }, [cloudSongId]);

  const handleRestoreCloud = async (ts: number) => {
    if (!cloudSongId || busy) return;
    setBusy(true);
    try {
      const dto = await cloudGetVersion(cloudSongId, ts);
      // setScore auto-snapshots the outgoing state — restore is reversible.
      setScore(dto.score);
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Restored cloud version from ${formatTimestamp(ts)}.`,
        timestamp: Date.now(),
      });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to restore version";
      setError(msg);
      setBusy(false);
    }
  };

  const handleRestore = async (timestamp: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const snap = await loadSnapshot(timestamp);
      if (!snap) {
        setError("Snapshot not found.");
        setBusy(false);
        return;
      }
      // Snapshot the CURRENT state first so the restore itself is reversible.
      const { saveSnapshot } = await import("@/lib/autosave");
      if (currentScore) await saveSnapshot(currentScore).catch(() => {});
      setScore(snap.score);
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Restored autosave from ${formatTimestamp(timestamp)} — "${snap.title}". The previous state was also snapshotted; reopen this dialog to roll back if needed.`,
        timestamp: Date.now(),
      });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to restore snapshot";
      setError(msg);
      setBusy(false);
    }
  };

  // Aggressively normalize titles so 'San Francisco' / ' san francisco '
  // / 'san  francisco' all collapse to the same key. Earlier version
  // only lower-cased — left near-duplicates because the whitespace
  // differed slightly between the snapshot and an existing My Songs
  // entry, so the existence check missed.
  const normalizeTitle = (s: string) =>
    (s || "").trim().toLowerCase().replace(/\s+/g, " ");

  // Snapshots grouped by normalized title — used by both the rendering
  // pass and the "Recover all" button. Each title's newest snapshot is
  // the candidate to materialize into My Songs.
  const groupedByTitle = useMemo(() => {
    if (!snapshots) return null;
    const map = new Map<string, Omit<AutosaveSnapshot, "score">>();
    for (const s of snapshots) {
      const key = normalizeTitle(s.title || "Untitled");
      const existing = map.get(key);
      if (!existing || s.timestamp > existing.timestamp) map.set(key, s);
    }
    return map;
  }, [snapshots]);

  /** Recover every unique-title snapshot whose title isn't already
   *  represented in My Songs. The newest snapshot per title wins.
   *  Used after the save flow loses a song (e.g. silent overwrite via
   *  the now-fixed currentSongId clobber). One click rescues everything. */
  const handleRecoverAllUnique = async () => {
    if (!groupedByTitle || busy) return;
    setBusy(true);
    try {
      const existingTitles = new Set(
        getSongs().map((s) => normalizeTitle(s.title)),
      );
      let recovered = 0;
      const recoveredTitles: string[] = [];
      for (const [key, snapMeta] of groupedByTitle.entries()) {
        if (existingTitles.has(key)) continue;
        if (key === "untitled") continue; // skip the placeholder
        const full = await loadSnapshot(snapMeta.timestamp);
        if (!full) continue;
        saveSong(snapMeta.title, full.score);
        recovered++;
        recoveredTitles.push(snapMeta.title);
      }
      if (recovered === 0) {
        addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Nothing to recover — every snapshotted title is already in My Songs.",
          timestamp: Date.now(),
        });
      } else {
        addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Recovered ${recovered} song${recovered === 1 ? "" : "s"} into My Songs: ${recoveredTitles.join(", ")}.`,
          timestamp: Date.now(),
        });
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to recover snapshots";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (timestamp: number) => {
    if (busy) return;
    if (!confirm(`Delete this autosave from ${formatTimestamp(timestamp)}?`)) return;
    setBusy(true);
    try {
      await deleteSnapshot(timestamp);
      const next = await listSnapshots();
      setSnapshots(next);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete snapshot";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[560px] max-h-[70vh] flex flex-col overflow-hidden text-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              {filterTitle ? `History — ${filterTitle}` : "Recover from Auto-save"}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Up to the last 50 snapshots, saved as you edit. Click any row to load
              it; click <strong>Recover all</strong> below to bulk-rescue every
              unique title that isn&rsquo;t already in My Songs.
            </p>
          </div>
          {!filterTitle && groupedByTitle && groupedByTitle.size > 0 && (
            <button
              type="button"
              onClick={handleRecoverAllUnique}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg disabled:opacity-50 whitespace-nowrap shrink-0"
              title="Bulk-recover every unique-titled snapshot not already in My Songs. The newest snapshot per title wins."
            >
              Recover all
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-lg px-2 shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="px-5 py-3 text-sm text-red-700 bg-red-50 border-b border-red-100">
              {error}
            </div>
          )}

          {/* Cloud versions: named revisions, daily milestones, recent
              auto. Sticky-named ones shown with a tag. */}
          {cloudVersions && cloudVersions.length > 0 && (
            <div className="border-b border-gray-200">
              <div className="px-5 py-1.5 text-[11px] uppercase tracking-wider text-gray-500 bg-gray-50">
                Cloud history ({cloudVersions.length})
              </div>
              <ul className="divide-y divide-gray-100">
                {cloudVersions.map((v) => {
                  const tagColor = v.kind === "named"
                    ? "bg-blue-100 text-blue-700"
                    : v.kind === "daily"
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-600";
                  const tagLabel = v.kind === "named"
                    ? (v.name || "Named")
                    : v.kind === "daily"
                    ? "Daily"
                    : "Auto";
                  return (
                    <li key={v.ts} className="px-5 py-2 flex items-center justify-between hover:bg-gray-50">
                      <button
                        type="button"
                        onClick={() => handleRestoreCloud(v.ts)}
                        disabled={busy}
                        className="flex-1 text-left disabled:opacity-50"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${tagColor}`}>
                            {tagLabel}
                          </span>
                          {v.title && (
                            <span className="text-sm font-medium text-gray-900 truncate">{v.title}</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {formatTimestamp(v.ts)}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {snapshots === null && !error && (
            <div className="px-5 py-6 text-sm text-gray-500">Loading…</div>
          )}
          {snapshots !== null && snapshots.length === 0 && cloudVersions && cloudVersions.length === 0 && (
            <div className="px-5 py-6 text-sm text-gray-500">
              No history yet. Recovery points appear here as you edit.
            </div>
          )}
          {snapshots !== null && snapshots.length > 0 && cloudVersions && (
            <div className="px-5 py-1.5 text-[11px] uppercase tracking-wider text-gray-500 bg-gray-50 border-b border-gray-100">
              On this device ({snapshots.length})
            </div>
          )}
          {snapshots && snapshots.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {snapshots.map((s) => (
                <li
                  key={s.timestamp}
                  className="px-5 py-2 flex items-center justify-between hover:bg-gray-50"
                >
                  <button
                    type="button"
                    onClick={() => handleRestore(s.timestamp)}
                    disabled={busy}
                    className="flex-1 text-left disabled:opacity-50"
                  >
                    <div className="text-sm font-medium text-gray-900">{s.title}</div>
                    <div className="text-xs text-gray-500">
                      {formatTimestamp(s.timestamp)} · {s.summary}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.timestamp)}
                    disabled={busy}
                    className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 ml-2 disabled:opacity-30"
                    title="Delete this snapshot"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
