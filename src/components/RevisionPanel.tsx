"use client";

import { useState } from "react";
import { useScoreStore } from "@/store/score-store";

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
  const [showPanel, setShowPanel] = useState(false);

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
    <div className="border-t border-gray-200">
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
      >
        <span>
          Revisions ({savedRevisions.length})
          {history.length > 1 && (
            <span className="text-gray-400 ml-1">
              &middot; {historyIndex + 1}/{history.length} undo steps
            </span>
          )}
        </span>
        <span className="text-[10px]">{showPanel ? "\u25B2" : "\u25BC"}</span>
      </button>

      {showPanel && (
        <div className="px-3 pb-3 space-y-2">
          {/* Save form */}
          <div className="flex gap-1">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Revision name..."
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800 placeholder-gray-400"
            />
            <button
              onClick={handleSave}
              className="px-2 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded transition-colors"
            >
              Save
            </button>
          </div>

          {/* Revision list */}
          {savedRevisions.length === 0 ? (
            <p className="text-[10px] text-gray-400 text-center py-2">
              No saved revisions yet
            </p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {[...savedRevisions].reverse().map((rev) => (
                <div
                  key={rev.id}
                  className="flex items-center justify-between bg-white border border-gray-200 rounded px-2 py-1.5 group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-700 truncate">
                      {rev.name}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {formatDate(rev.timestamp)} {formatTime(rev.timestamp)}
                      {" \u00B7 "}
                      {rev.score.staves.length} staves, {rev.score.measures} measures
                    </div>
                  </div>
                  <div className="flex gap-1 ml-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
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
                      &times;
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
