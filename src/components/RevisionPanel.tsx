"use client";

import { useState } from "react";
import { useScoreStore } from "@/store/score-store";

/**
 * Named-revision panel. Always renders its contents — the consumer is
 * responsible for any collapse/expand chrome (PropSection handles that
 * in the embedded case). Previously RevisionPanel had its own internal
 * disclosure arrow on top of PropSection's, which forced the user to
 * click twice to see anything.
 *
 * Note: most users get all the recovery they need from File → Recover
 * from Auto-save (50 snapshots in IndexedDB). Named revisions are
 * mostly for milestones the user wants to label and never lose. Kept
 * compact accordingly.
 */
export default function RevisionPanel() {
  const {
    score,
    savedRevisions,
    saveRevision,
    restoreRevision,
    deleteRevision,
    history,
    historyIndex,
  } = useScoreStore();
  const [saveName, setSaveName] = useState("");

  if (!score) return null;

  const handleSave = () => {
    const name = saveName.trim() || `Revision ${savedRevisions.length + 1}`;
    saveRevision(name);
    setSaveName("");
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="px-3 py-2 space-y-2">
      <div className="text-[10px] text-gray-500">
        {savedRevisions.length} named revision{savedRevisions.length === 1 ? "" : "s"}
        {history.length > 1 && (
          <span className="text-gray-400 ml-2">
            · {historyIndex + 1}/{history.length} undo steps
          </span>
        )}
      </div>

      {/* Name + Save form. The placeholder is explicit: this names a
       * NEW milestone, it isn't a search box. (Earlier user feedback:
       * 'the search box doesn't work' — they were typing here expecting
       * filter behavior.) */}
      <div className="flex gap-1">
        <input
          type="text"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Name this version (e.g. 'pre-bridge edit')…"
          aria-label="New revision name"
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800 placeholder-gray-400"
        />
        <button
          onClick={handleSave}
          className="px-2 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded transition-colors whitespace-nowrap"
          title="Save the current state as a named milestone"
        >
          Save
        </button>
      </div>

      <p className="text-[10px] text-gray-400 leading-snug">
        For ad-hoc recovery, use <strong>File → Recover from Auto-save…</strong>{" "}
        — the editor snapshots automatically every few seconds.
      </p>

      {savedRevisions.length === 0 ? null : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {[...savedRevisions].reverse().map((rev) => (
            <div
              key={rev.id}
              className="flex items-center justify-between bg-white border border-gray-200 rounded px-2 py-1.5"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-700 truncate">
                  {rev.name}
                </div>
                <div className="text-[10px] text-gray-400">
                  {formatDate(rev.timestamp)} {formatTime(rev.timestamp)}
                  {" · "}
                  {rev.score.staves.length} staves, {rev.score.measures} measures
                </div>
              </div>
              <div className="flex gap-1 ml-2 shrink-0">
                <button
                  onClick={() => restoreRevision(rev.id)}
                  className="px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-blue-50 rounded"
                  title="Restore this revision"
                >
                  Restore
                </button>
                <button
                  onClick={() => deleteRevision(rev.id)}
                  className="px-1.5 py-0.5 text-[10px] text-red-500 hover:bg-red-50 rounded"
                  title="Delete this revision"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
