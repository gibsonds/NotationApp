"use client";

import { useEffect, useState } from "react";
import { listSnapshots, loadSnapshot, deleteSnapshot, AutosaveSnapshot } from "@/lib/autosave";
import { useScoreStore } from "@/store/score-store";

interface AutosaveRecoveryDialogProps {
  onClose: () => void;
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
export default function AutosaveRecoveryDialog({ onClose }: AutosaveRecoveryDialogProps) {
  const setScore = useScoreStore((s) => s.setScore);
  const currentScore = useScoreStore((s) => s.score);
  const addMessage = useScoreStore((s) => s.addMessage);

  const [snapshots, setSnapshots] = useState<Omit<AutosaveSnapshot, "score">[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listSnapshots()
      .then(setSnapshots)
      .catch((err) => setError(err.message ?? "Failed to read autosave history"));
  }, []);

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
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Recover from Auto-save</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Up to the last 20 snapshots, saved every 30 seconds when there are changes.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-lg px-2"
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
          {snapshots === null && !error && (
            <div className="px-5 py-6 text-sm text-gray-500">Loading…</div>
          )}
          {snapshots !== null && snapshots.length === 0 && (
            <div className="px-5 py-6 text-sm text-gray-500">
              No autosaves yet. They start appearing 30 seconds after your first edit.
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
