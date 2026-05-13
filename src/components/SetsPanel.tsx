"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addSongToSet,
  createSet,
  deleteSet,
  getSets,
  removeSongFromSet,
  renameSet,
  reorderSong,
  songSetMembership,
  SetsUpdatedEvent,
  type SongSet,
} from "@/lib/song-sets";
import { getSongs, isAliasTitle, SongsUpdatedEvent, type SongBankEntry } from "@/lib/song-bank";
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
export default function SetsPanel({
  onClose,
  onPickSongs,
}: {
  onClose: () => void;
  /** Optional: when set, the "+ Add songs" actions delegate to the
   *  parent instead of opening SetsPanel's own AddToSetSheet. The
   *  parent (MySongsModal) uses this to route the pickSongs flow into
   *  its right pane — no modal-on-modal. When unset, SetsPanel falls
   *  back to mounting AddToSetSheet itself so it remains usable in
   *  isolation. */
  onPickSongs?: (setId: string) => void;
}) {
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
  // Which sets are checked in the list-view multi-select. When ≥1 is
  // checked, the Songs section below shows per-row Add buttons that
  // commit to all checked sets at once. This is the inverse of the
  // pickSongs sheet flow: instead of pick-songs-then-pick-set, here
  // it's pick-sets-then-add-songs.
  const [selectedSetIds, setSelectedSetIds] = useState<Set<string>>(new Set());
  const toggleSelectedSet = (id: string) => {
    setSelectedSetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
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

  // Load the first existing song of a set and enter perform mode.
  // Critical for "open a set and play it" — without this, the only
  // way to load a set was: open detail view → tap a song. This makes
  // sets usable from the list view directly.
  const handlePlaySet = async (setId: string) => {
    const set = sets.find((s) => s.id === setId);
    if (!set) return;
    const firstSongId = set.songIds.find((id) => songsById.has(id));
    if (!firstSongId) {
      window.alert(`"${set.name}" has no songs yet. Add some songs first.`);
      return;
    }
    await handleLoadSong(firstSongId, setId);
  };

  // Bulk-add a single song to every currently-checked set. Skips sets
  // that already contain the song (dedup handled inside addSongToSet).
  const handleAddSongToSelectedSets = (songId: string) => {
    if (selectedSetIds.size === 0) return;
    for (const setId of selectedSetIds) {
      addSongToSet(setId, songId);
    }
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
    // Membership map: songId → SongSets the song belongs to. Drives the
    // per-song "✓ Added" / "Add" state in the Songs section below.
    const membership = songSetMembership(sets);
    // Songs to show in the bottom section. Alias artifacts ("(snapped)"
    // etc.) hidden so the list stays scannable — same convention as
    // AddToSetSheet's pickSongs.
    const songsForAdd = Array.from(songsById.values())
      .filter((s) => !isAliasTitle(s.title))
      .sort((a, b) => b.savedAt - a.savedAt);

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

        {/* ── Sets section (top): multi-select target picker ─────────
            Capped at ~40% of available height so the songs section
            below always has room. When empty, shows an explanatory
            empty state and skips straight to "No sets yet" guidance. */}
        {sets.length === 0 ? (
          // Compact empty-state — kept small so the Songs section
          // below stays visible. Without this, the modal collapsed
          // to a tiny height the moment you switched to the Sets tab
          // before creating your first set.
          <div className="px-5 py-3 text-sm text-gray-500 bg-gray-50 border-b border-gray-100">
            No sets yet. Type a name above to create one — useful for
            grouping songs you play together at a gig or rehearsal.
          </div>
        ) : (
          <>
            <div className="px-5 py-1.5 text-[11px] uppercase tracking-wider text-gray-500 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <span>Sets ({sets.length})</span>
              {selectedSetIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedSetIds(new Set())}
                  className="text-[10px] normal-case tracking-normal text-gray-500 hover:text-gray-700"
                >
                  Clear selection
                </button>
              )}
            </div>
            <ul className="overflow-y-auto divide-y divide-gray-100 max-h-[40%] shrink-0">
              {sets.map((set) => {
                const songCount = set.songIds.filter((id) => songsById.has(id)).length;
                const missingCount = set.songIds.length - songCount;
                const isSelected = selectedSetIds.has(set.id);
                return (
                  <li
                    key={set.id}
                    className={`flex items-center px-5 py-3 hover:bg-gray-50 gap-3 ${
                      isSelected ? "bg-blue-50/40" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectedSet(set.id)}
                      className="w-4 h-4 text-blue-600 shrink-0"
                      title="Select to bulk-add songs to this set"
                    />
                    <button
                      type="button"
                      onClick={() => setOpenSetId(set.id)}
                      className="flex-1 text-left min-w-0"
                      title="Open this set to reorder or remove songs"
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
                    <button
                      type="button"
                      onClick={() => handlePlaySet(set.id)}
                      disabled={songCount === 0}
                      className="px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50 active:bg-green-100 border border-green-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                      title={songCount === 0 ? "Empty set" : `Play ${set.name} from the top in perform mode`}
                    >
                      ▶ Play
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
                          setSelectedSetIds((prev) => {
                            const next = new Set(prev);
                            next.delete(set.id);
                            return next;
                          });
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
          </>
        )}

        {/* ── Songs section (bottom): per-row Add to selected sets ──
            Mirrors the Songs tab list but the only action is Add. Disabled
            until ≥1 set is checked above. When a song is already in every
            checked set, button flips to "✓ Added" (still tap-friendly so
            you can tap-add the same song again to MORE sets after
            checking them — addSongToSet is idempotent).
            Rendered regardless of sets count so the layout doesn't
            jump when you first land on the Sets tab — the Add buttons
            stay disabled until ≥1 set is selected. */}
        {(
          <>
            <div className="px-5 py-1.5 text-[11px] uppercase tracking-wider text-gray-500 bg-gray-50 border-y border-gray-100 flex items-center justify-between">
              <span>
                Add songs to{" "}
                {selectedSetIds.size === 0
                  ? <em className="not-italic text-gray-400">no set selected</em>
                  : selectedSetIds.size === 1
                  ? sets.find((s) => selectedSetIds.has(s.id))?.name ?? "1 set"
                  : `${selectedSetIds.size} sets`}
              </span>
            </div>
            <ul className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {songsForAdd.length === 0 ? (
                <li className="px-5 py-6 text-sm text-gray-500 text-center">
                  No songs saved yet.
                </li>
              ) : (
                songsForAdd.map((entry) => {
                  const memberOf = membership.get(entry.id) ?? [];
                  const inSelectedCount = memberOf.filter((s) =>
                    selectedSetIds.has(s.id),
                  ).length;
                  const allSelectedAlreadyHave =
                    selectedSetIds.size > 0 &&
                    inSelectedCount === selectedSetIds.size;
                  const t = scoreTypeOf(entry.score);
                  return (
                    <li key={entry.id} className="flex items-center px-5 py-3 hover:bg-gray-50 gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate inline-flex items-center gap-2">
                          <span className="truncate">{entry.title}</span>
                          {t === "chord-chart" && (
                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 shrink-0">
                              Chart
                            </span>
                          )}
                          {t === "notation" && (
                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 shrink-0">
                              Score
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                          {entry.folder && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200"
                              title={`Folder: ${entry.folder}`}
                            >
                              {entry.folder}
                            </span>
                          )}
                          {memberOf.length > 0 && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-pink-50 text-pink-700 border border-pink-100"
                              title={memberOf.map((s) => s.name).join(", ")}
                            >
                              In {memberOf.length} set{memberOf.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddSongToSelectedSets(entry.id)}
                        disabled={selectedSetIds.size === 0 || allSelectedAlreadyHave}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 ${
                          allSelectedAlreadyHave
                            ? "text-green-700 bg-green-50 border border-green-200 cursor-default"
                            : selectedSetIds.size === 0
                            ? "text-gray-400 bg-gray-50 border border-gray-200 cursor-not-allowed"
                            : "text-blue-700 hover:bg-blue-50 active:bg-blue-100 border border-blue-200"
                        }`}
                        title={
                          selectedSetIds.size === 0
                            ? "Select one or more sets above first"
                            : allSelectedAlreadyHave
                            ? "Already in every selected set"
                            : `Add to ${selectedSetIds.size} selected set${selectedSetIds.size === 1 ? "" : "s"}`
                        }
                      >
                        {allSelectedAlreadyHave ? "✓ Added" : "Add"}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </>
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
        {/* AddToSetSheet — kept for any caller path that still uses
            addToSetId, but the list-view's row workflow no longer
            opens it (per-song Add via the new Songs section). */}
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
          onClick={() => onPickSongs ? onPickSongs(openSet.id) : setAddToSetId(openSet.id)}
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
