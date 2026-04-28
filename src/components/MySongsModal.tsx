"use client";

import { useState } from "react";
import { useScoreStore } from "@/store/score-store";
import { getSongs, saveSong, deleteSong, SongBankEntry } from "@/lib/song-bank";

export default function MySongsModal({ onClose }: { onClose: () => void }) {
  const score = useScoreStore(s => s.score);
  const setScore = useScoreStore(s => s.setScore);
  const [songs, setSongs] = useState<SongBankEntry[]>(() =>
    getSongs().slice().reverse()
  );
  const [saveTitle, setSaveTitle] = useState(score?.title || "");
  const [justSaved, setJustSaved] = useState(false);

  const refresh = () => setSongs(getSongs().slice().reverse());

  const handleSave = () => {
    if (!score) return;
    const title = saveTitle.trim() || score.title || "Untitled Song";
    saveSong(title, score);
    refresh();
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const handleLoad = (entry: SongBankEntry) => {
    setScore(entry.score);
    onClose();
  };

  const handleDelete = (id: string) => {
    deleteSong(id);
    refresh();
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 text-base">My Songs</h2>
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

        {/* Save current song */}
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

        {/* Song list */}
        <div className="flex-1 overflow-y-auto">
          {songs.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">
              {score
                ? "No songs saved yet. Enter a name above and click Save Song."
                : "No songs saved yet."
              }
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

        {/* Footer */}
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
