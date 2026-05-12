"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createSet,
  deleteSet,
  getSets,
  removeSongFromSet,
  renameSet,
  reorderSong,
  SetsUpdatedEvent,
  type SongSet,
} from "@/lib/song-sets";
import { getSongs, SongsUpdatedEvent, type SongBankEntry } from "@/lib/song-bank";
import AddToSetSheet from "@/components/AddToSetSheet";
import { useScoreStore } from "@/store/score-store";
import { saveSnapshot } from "@/lib/autosave";
import { scoreTypeOf } from "@/lib/analytics";

/**
 * Sets pane (#73). Two-mode: list of sets at top level; click into a
 * set to manage its song order and to load songs from inside it.
 *
 * No cloud sync yet (per-device only). Cloud-aware sets land alongside
 * #74 OAuth42 since per-set permissions need user identity.
 */
export default function SetsPanel({ onClose }: { onClose: () => void }) {
  const [sets, setSetsState] = useState<SongSet[]>(() => getSets());
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renameOpen, setRenameOpen] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Target set for the AddToSetSheet (pickSongs mode). Lets us trigger
  // the sheet from either the list view (inline "+ Add songs" on each
  // row) or the detail view (header button) — both write the same
  // setId here, so the sheet pre-targets correctly without an extra
  // boolean.
  const [addToSetId, setAddToSetId] = useState<string | null>(null);
  // Live search filter for the songs-in-set list. Critical once a set
  // gets above ~10 songs.
  const [setQuery, setSetQuery] = useState("");
  const setScore = useScoreStore((s) => s.setScore);
  const setUIState = useScoreStore((s) => s.setUIState);
  const score = useScoreStore((s) => s.score);

  // Subscribe to localStorage changes via custom events so concurrent
  // edits in another component (or another tab) reflect here without a
  // page reload.
  useEffect(() => {
    const refresh = () => setSetsState(getSets());
    window.addEventListener(SetsUpdatedEvent, refresh);
    window.addEventListener(SongsUpdatedEvent, refresh);
    return () => {
      window.removeEventListener(SetsUpdatedEvent, refresh);
      window.removeEventListener(SongsUpdatedEvent, refresh);
    };
  }, []);

  // Re-read songs whenever the sets list changes too — sets and songs
  // are written by adjacent flows, so a sets-update often coincides with
  // a songs-update we'd want to pick up. Cheap (one localStorage read).
  const songsById = useMemo(() => {
    void sets;
    const map = new Map<string, SongBankEntry>();
    for (const s of getSongs()) map.set(s.id, s);
    return map;
  }, [sets]);

  const openSet = openSetId ? sets.find((s) => s.id === openSetId) : null;

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    const s = createSet(name);
    setNewName("");
    setOpenSetId(s.id);
  };

  const handleLoadSong = async (songId: string, setId: string) => {
    const entry = songsById.get(songId);
    if (!entry) return;
    if (score) {
      try { await saveSnapshot(score); } catch { /* best-effort */ }
    }
    setScore(entry.score);
    const isChordChart = !!(entry.score.sections && entry.score.sections.length > 0);
    setUIState({
      currentSongId: entry.id,
      activeSetId: setId,
      ...(isChordChart && { performMode: true }),
    });
    onClose();
  };

  // ── List view: all sets ─────────────────────────────────────────────

  if (!openSet) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New set (e.g. 'Friday gig')…"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg whitespace-nowrap shrink-0"
          >
            Create
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sets.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-500">
              No sets yet. Type a name above to create one — useful for grouping
              songs you play together at a gig or rehearsal.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {sets.map((set) => {
                const songCount = set.songIds.filter((id) => songsById.has(id)).length;
                const missingCount = set.songIds.length - songCount;
                return (
                  <li key={set.id} className="flex items-center px-5 py-3 hover:bg-gray-50 gap-3">
                    <button
                      type="button"
                      onClick={() => setOpenSetId(set.id)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="text-sm font-medium text-gray-900 truncate">{set.name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {songCount} song{songCount === 1 ? "" : "s"}
                        {missingCount > 0 && (
                          <span className="text-amber-600 ml-2">
                            · {missingCount} missing
                          </span>
                        )}
                      </div>
                    </button>
                    {/* Inline "+ Add songs" — skips the open-the-set
                        step. Pre-targets the AddToSetSheet at this set,
                        so the sheet opens straight into pickSongs mode.
                        Critical for "I just want to add a song without
                        clicking into the set first." */}
                    <button
                      type="button"
                      onClick={() => setAddToSetId(set.id)}
                      className="px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 active:bg-blue-100 border border-blue-200 rounded"
                      title={`Add songs to ${set.name}`}
                    >
                      + Add songs
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameOpen(set.id);
                        setRenameValue(set.name);
                      }}
                      className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete set "${set.name}"? Songs themselves are not deleted.`)) {
                          deleteSet(set.id);
                        }
                      }}
                      className="px-2 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {renameOpen && (
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center p-4 z-10">
              <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-sm font-semibold mb-2">Rename set</h3>
                <input
                  type="text"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      renameSet(renameOpen, renameValue);
                      setRenameOpen(null);
                    }
                    if (e.key === "Escape") setRenameOpen(null);
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setRenameOpen(null)}
                    className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      renameSet(renameOpen, renameValue);
                      setRenameOpen(null);
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        {/* AddToSetSheet — also mounted from the list view so the
            inline "+ Add songs" button on each row works without first
            opening a set. */}
        {addToSetId && (
          <AddToSetSheet
            mode="pickSongs"
            targetSetId={addToSetId}
            onClose={() => setAddToSetId(null)}
          />
        )}
      </div>
    );
  }

  // ── Detail view: songs inside the open set ──────────────────────────

  // Filter songs-in-set by search query (case-insensitive, title only).
  // Empty query passes everything through. Reordering controls only show
  // when no query is active — moving rows in a filtered view would be
  // confusing (you'd move "song 2 of 3 visible" to a position that means
  // nothing in the unfiltered list).
  const setQueryLc = setQuery.trim().toLowerCase();
  const filterMatch = (entry: SongBankEntry | undefined) => {
    if (!setQueryLc) return true;
    return !!entry && entry.title.toLowerCase().includes(setQueryLc);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpenSetId(null)}
          className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded inline-flex items-center gap-1"
        >
          ← Back
        </button>
        <div className="flex-1 min-w-0 text-sm font-medium text-gray-900 truncate">
          {openSet.name}
        </div>
        <span className="text-xs text-gray-400">
          {openSet.songIds.length} song{openSet.songIds.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => setAddToSetId(openSet.id)}
          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg"
          title="Add multiple songs to this set"
        >
          + Add songs…
        </button>
      </div>

      {/* Search field — only useful once the set has >1 song. Hides for
          empty sets to avoid clutter. */}
      {openSet.songIds.length > 1 && (
        <div className="px-5 py-2 border-b border-gray-100">
          <input
            type="text"
            value={setQuery}
            onChange={(e) => setSetQuery(e.target.value)}
            placeholder="Search this set…"
            className="w-full text-sm text-gray-900 placeholder-gray-400 border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Songs in the set, in order, with up/down/remove controls. */}
        {openSet.songIds.length === 0 ? (
          <div className="px-5 py-6 text-sm text-gray-500 text-center">
            Empty set. Tap <strong>+ Add songs…</strong> above to pick songs to add.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {openSet.songIds.map((songId, idx) => {
              const entry = songsById.get(songId);
              if (!entry) {
                if (setQueryLc) return null;
                return (
                  <li key={songId} className="px-5 py-2 flex items-center text-amber-700 bg-amber-50">
                    <span className="text-xs italic flex-1">
                      Missing song (not in My Songs anymore)
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSongFromSet(openSet.id, songId)}
                      className="px-2 py-1 text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </li>
                );
              }
              if (!filterMatch(entry)) return null;
              return (
                <li key={songId} className="flex items-center px-5 py-2 hover:bg-gray-50 gap-2">
                  <span className="text-xs text-gray-400 w-6">{idx + 1}.</span>
                  <button
                    type="button"
                    onClick={() => handleLoadSong(songId, openSet.id)}
                    className="flex-1 text-left min-w-0 text-sm text-gray-900 hover:text-blue-700 truncate"
                  >
                    {entry.title}
                    <SongTypeBadge entry={entry} />
                  </button>
                  {!setQueryLc && (
                    <>
                      <button
                        type="button"
                        onClick={() => reorderSong(openSet.id, idx, idx - 1)}
                        disabled={idx === 0}
                        className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30"
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => reorderSong(openSet.id, idx, idx + 1)}
                        disabled={idx === openSet.songIds.length - 1}
                        className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30"
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => removeSongFromSet(openSet.id, songId)}
                    className="px-2 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {addToSetId && (
        <AddToSetSheet
          mode="pickSongs"
          targetSetId={addToSetId}
          onClose={() => setAddToSetId(null)}
        />
      )}
    </div>
  );
}

function SongTypeBadge({ entry }: { entry: SongBankEntry }) {
  const t = scoreTypeOf(entry.score);
  if (t === "chord-chart") {
    return (
      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 ml-2">
        Chart
      </span>
    );
  }
  if (t === "notation") {
    return (
      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 ml-2">
        Score
      </span>
    );
  }
  return null;
}
