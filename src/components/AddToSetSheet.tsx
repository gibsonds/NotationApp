"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addSongToSet,
  createSet,
  filterCandidatesForSheet,
  getSets,
  SetsUpdatedEvent,
  type SongSet,
} from "@/lib/song-sets";
import { getSongs, SongsUpdatedEvent, type SongBankEntry } from "@/lib/song-bank";
import { scoreTypeOf } from "@/lib/analytics";

/**
 * Stacked sheet (z-[110], above MySongsModal's z-50) used for two
 * complementary flows:
 *
 *  - `pickSet`  → caller pre-selected songs; user picks which set
 *                 (existing or "+ New set") to add them to.
 *  - `pickSongs` → caller pre-selected a set; user picks which songs
 *                 (multi-select with search) to add.
 *
 * Adds happen in one batch with `addSongToSet` per id (dedup is handled
 * inside song-sets.ts already). Closes on success.
 *
 * Follows the small-modal styling from AutosaveRecoveryDialog.tsx
 * (560px, pt-[12vh], black/40 backdrop, Esc + backdrop-click dismiss).
 */
interface AddToSetSheetProps {
  onClose: () => void;
}

interface PickSetProps extends AddToSetSheetProps {
  mode: "pickSet";
  /** Song ids already chosen by the caller. The sheet picks the target set. */
  songIds: string[];
}

interface PickSongsProps extends AddToSetSheetProps {
  mode: "pickSongs";
  /** Target set pre-chosen by the caller. The sheet picks the songs. */
  targetSetId: string;
}

type Props = PickSetProps | PickSongsProps;

export default function AddToSetSheet(props: Props) {
  const { onClose } = props;

  // Sets + songs lists. Subscribed so renames/edits elsewhere reflect.
  const [sets, setSetsState] = useState<SongSet[]>(() => getSets());
  const [songs, setSongsState] = useState<SongBankEntry[]>(() => getSongs());

  useEffect(() => {
    const refresh = () => {
      setSetsState(getSets());
      setSongsState(getSongs());
    };
    window.addEventListener(SetsUpdatedEvent, refresh);
    window.addEventListener(SongsUpdatedEvent, refresh);
    return () => {
      window.removeEventListener(SetsUpdatedEvent, refresh);
      window.removeEventListener(SongsUpdatedEvent, refresh);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-start justify-center pt-[12vh] bg-black/40"
      // Stop the bubble so clicking the backdrop doesn't ALSO trigger the
      // parent MySongsModal's onClose (its outer div uses the same
      // backdrop-click-to-close pattern).
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[560px] max-w-[92vw] max-h-[70vh] flex flex-col overflow-hidden text-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {props.mode === "pickSet" ? (
          <PickSetBody
            sets={sets}
            songIds={props.songIds}
            onClose={onClose}
          />
        ) : (
          <PickSongsBody
            sets={sets}
            songs={songs}
            targetSetId={props.targetSetId}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

// ── pickSet mode ───────────────────────────────────────────────────

function PickSetBody({
  sets,
  songIds,
  onClose,
}: {
  sets: SongSet[];
  songIds: string[];
  onClose: () => void;
}) {
  // Radio choice across existing sets + a synthetic "__new__" option
  // that reveals a name input on the right.
  const [chosen, setChosen] = useState<string>(sets[0]?.id ?? "__new__");
  const [newName, setNewName] = useState("");

  const handleAdd = () => {
    if (songIds.length === 0) {
      onClose();
      return;
    }
    let setId: string | null = null;
    if (chosen === "__new__") {
      const trimmed = newName.trim();
      if (!trimmed) return;
      const fresh = createSet(trimmed);
      setId = fresh.id;
    } else {
      setId = chosen;
    }
    if (!setId) return;
    for (const id of songIds) addSongToSet(setId, id);
    onClose();
  };

  const disabled =
    songIds.length === 0 ||
    (chosen === "__new__" && !newName.trim());

  return (
    <>
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Add {songIds.length} {songIds.length === 1 ? "song" : "songs"} to a set
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Pick an existing set or create a new one.
          </p>
        </div>
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
        {sets.length === 0 ? (
          <div className="px-5 py-6 text-sm text-gray-500 text-center">
            No sets yet. Name a new one below to create your first set.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sets.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="target-set"
                    checked={chosen === s.id}
                    onChange={() => setChosen(s.id)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{s.name}</div>
                    <div className="text-xs text-gray-400">
                      {s.songIds.length} song{s.songIds.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
        {/* + New set row, always present at the bottom */}
        <label className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 cursor-pointer border-t border-gray-100">
          <input
            type="radio"
            name="target-set"
            checked={chosen === "__new__"}
            onChange={() => setChosen("__new__")}
            className="w-4 h-4 text-blue-600"
          />
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900 mb-1">+ New set</div>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onFocus={() => setChosen("__new__")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder="Set name (e.g. 'Friday gig')"
              className="w-full text-sm text-gray-900 placeholder-gray-400 border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </label>
      </div>
      <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg"
        >
          Cancel
        </button>
        <button
          onClick={handleAdd}
          disabled={disabled}
          className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg"
        >
          Add
        </button>
      </div>
    </>
  );
}

// ── pickSongs mode ────────────────────────────────────────────────

function PickSongsBody({
  sets,
  songs,
  targetSetId,
  onClose,
}: {
  sets: SongSet[];
  songs: SongBankEntry[];
  targetSetId: string;
  onClose: () => void;
}) {
  const target = sets.find((s) => s.id === targetSetId) ?? null;

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  // Candidate list: not-yet-in-set + non-alias + search-matching.
  // Lives in src/lib/song-sets.ts so the rule is unit-testable.
  const filtered = useMemo(
    () => filterCandidatesForSheet(songs, target?.songIds ?? [], query),
    [songs, target?.songIds, query],
  );
  const candidates = useMemo(
    () => filterCandidatesForSheet(songs, target?.songIds ?? []),
    [songs, target?.songIds],
  );

  const togglePicked = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    if (picked.size === 0 || !target) {
      onClose();
      return;
    }
    for (const id of picked) addSongToSet(target.id, id);
    onClose();
  };

  if (!target) {
    return (
      <>
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Set not found</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-lg px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-6 text-sm text-gray-500 text-center">
          The set may have been deleted in another tab.
        </div>
      </>
    );
  }

  return (
    <>
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900 truncate">
            Add songs to {target.name}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {target.songIds.length} already in set
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 text-lg px-2 shrink-0"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="px-5 py-2 border-b border-gray-100">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs…"
          className="w-full text-sm text-gray-900 placeholder-gray-400 border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-5 py-6 text-sm text-gray-500 text-center">
            {candidates.length === 0
              ? "Every song is already in this set."
              : "No songs match that search."}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((entry) => {
              const t = scoreTypeOf(entry.score);
              return (
                <li key={entry.id}>
                  <label className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={picked.has(entry.id)}
                      onChange={() => togglePicked(entry.id)}
                      className="w-4 h-4 text-blue-600 mt-0.5 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 truncate inline-flex items-center gap-2">
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
                      {/* Folder pill — critical for disambiguating
                          same-titled songs that live in different
                          folders. Hidden when the song has no folder
                          (avoids a generic "(Unfiled)" pill on most
                          rows). */}
                      {entry.folder && (
                        <div className="mt-0.5">
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200"
                            title={`Folder: ${entry.folder}`}
                          >
                            {entry.folder}
                          </span>
                        </div>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">
          {picked.size > 0 ? `${picked.size} selected` : "Pick at least one"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={picked.size === 0}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg"
          >
            Add
          </button>
        </div>
      </div>
    </>
  );
}
