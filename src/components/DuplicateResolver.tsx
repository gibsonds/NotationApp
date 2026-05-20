/**
 * Duplicate-song resolution panel. Shown inside MySongsModal's right
 * pane when the user has same-titled song entries (typically the
 * result of repeated Save-as instead of Save-over).
 *
 * The right pane is light-themed (matches MySongsModal's white
 * background), so the resolver uses dark text on light backgrounds —
 * the previous iteration assumed PerformView's dark theme and rendered
 * white text on light grey, which was unreadable.
 *
 * Per group:
 *  - Radio selector for the winner (defaults to richest content).
 *  - "Compare" button opens a full-screen overlay showing all entries
 *    side-by-side / stacked so the user can see what's actually
 *    different. The inline-preview approach was cramped and forced
 *    horizontal scroll on chord lines.
 *  - "Keep selected · delete N copies" actions one group at a time.
 *    The list shrinks as groups resolve; pane closes when empty.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type DuplicateGroup,
  type SongBankEntry,
  entryContentScore,
  findDuplicateGroups,
} from "@/lib/song-bank";
import {
  chordChartLines,
  diffClassifyRows,
  planCompareRows,
} from "@/lib/chord-chart-diff";

interface Props {
  songs: ReadonlyArray<SongBankEntry>;
  onResolve: (keep: SongBankEntry, drop: SongBankEntry[]) => void | Promise<void>;
  onClose: () => void;
}

export default function DuplicateResolver({ songs, onResolve, onClose }: Props) {
  const groups = useMemo(() => findDuplicateGroups(songs), [songs]);
  // selectedKeepId per canonical key — defaults to the richest-content
  // entry (groups[*].entries[0] is already sorted that way).
  const [selectedKeepIds, setSelectedKeepIds] = useState<Record<string, string>>({});
  const [compareGroupKey, setCompareGroupKey] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // Initialize / sync selection defaults whenever the groups change
  // (e.g., after resolving one and the list shrinks).
  useEffect(() => {
    setSelectedKeepIds((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (!next[g.canonicalKey] || !g.entries.find((e) => e.id === next[g.canonicalKey])) {
          next[g.canonicalKey] = g.entries[0].id;
        }
      }
      // Drop entries for groups that no longer exist.
      for (const k of Object.keys(next)) {
        if (!groups.find((g) => g.canonicalKey === k)) delete next[k];
      }
      return next;
    });
  }, [groups]);

  // Auto-close once nothing is left to resolve.
  useEffect(() => {
    if (groups.length === 0) onClose();
  }, [groups.length, onClose]);

  // Close compare overlay if its group disappeared (e.g. user resolved
  // it from another path).
  useEffect(() => {
    if (compareGroupKey && !groups.find((g) => g.canonicalKey === compareGroupKey)) {
      setCompareGroupKey(null);
    }
  }, [groups, compareGroupKey]);

  const resolveGroup = async (group: DuplicateGroup) => {
    const keepId = selectedKeepIds[group.canonicalKey] ?? group.entries[0].id;
    const keep = group.entries.find((e) => e.id === keepId) ?? group.entries[0];
    const drop = group.entries.filter((e) => e.id !== keep.id);
    setWorking(true);
    try {
      await onResolve(keep, drop);
    } finally {
      setWorking(false);
    }
  };

  const compareGroup = compareGroupKey
    ? groups.find((g) => g.canonicalKey === compareGroupKey)
    : null;

  if (groups.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-600">
        No duplicate-titled songs.
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col h-full bg-white text-gray-900">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Resolve duplicates
            </h3>
            <p className="text-[11px] text-gray-600 mt-0.5">
              {groups.length} {groups.length === 1 ? "title" : "titles"} with more
              than one copy. Pick which to keep per group.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 p-1 rounded hover:bg-gray-100"
            aria-label="Close duplicate resolver"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 bg-gray-50">
          {groups.map((group) => (
            <DuplicateGroupCard
              key={group.canonicalKey}
              group={group}
              keepId={selectedKeepIds[group.canonicalKey] ?? group.entries[0].id}
              onSelect={(id) =>
                setSelectedKeepIds((prev) => ({ ...prev, [group.canonicalKey]: id }))
              }
              onOpenCompare={() => setCompareGroupKey(group.canonicalKey)}
              disabled={working}
              onResolve={() => resolveGroup(group)}
            />
          ))}
        </div>
      </div>

      {compareGroup && (
        <CompareOverlay
          group={compareGroup}
          keepId={selectedKeepIds[compareGroup.canonicalKey] ?? compareGroup.entries[0].id}
          onSelect={(id) =>
            setSelectedKeepIds((prev) => ({ ...prev, [compareGroup.canonicalKey]: id }))
          }
          onClose={() => setCompareGroupKey(null)}
          onResolve={async () => {
            await resolveGroup(compareGroup);
            setCompareGroupKey(null);
          }}
          working={working}
        />
      )}
    </>
  );
}

interface GroupCardProps {
  group: DuplicateGroup;
  keepId: string;
  onSelect: (id: string) => void;
  onOpenCompare: () => void;
  disabled: boolean;
  onResolve: () => void;
}

function DuplicateGroupCard({
  group,
  keepId,
  onSelect,
  onOpenCompare,
  disabled,
  onResolve,
}: GroupCardProps) {
  const displayTitle = group.entries[0].title;
  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden bg-white shadow-sm">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-900 truncate">
          {displayTitle}
        </span>
        <button
          type="button"
          onClick={onOpenCompare}
          className="text-[12px] font-medium text-blue-700 hover:text-blue-900 px-2 py-0.5 rounded hover:bg-blue-50 border border-blue-200"
        >
          Compare
        </button>
      </div>
      <div className="divide-y divide-gray-200">
        {group.entries.map((entry) => (
          <label
            key={entry.id}
            className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-blue-50"
          >
            <input
              type="radio"
              name={`keep-${group.canonicalKey}`}
              checked={keepId === entry.id}
              onChange={() => onSelect(entry.id)}
              className="mt-0.5 accent-blue-600"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[13px] text-gray-900">
                <span className="font-medium truncate">{entry.title}</span>
                {entry.folder && (
                  <span className="text-[9px] uppercase tracking-wider text-gray-600 px-1.5 py-0.5 rounded bg-gray-200">
                    {entry.folder}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-600 mt-0.5">
                Saved {formatSavedAt(entry.savedAt)} · {entryContentScore(entry)}{" "}
                content chars
              </div>
            </div>
          </label>
        ))}
      </div>
      <div className="px-3 py-2 border-t border-gray-200 bg-white">
        <button
          type="button"
          onClick={onResolve}
          disabled={disabled}
          className="w-full text-[12px] px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Keep selected · delete {group.entries.length - 1}{" "}
          {group.entries.length - 1 === 1 ? "copy" : "copies"}
        </button>
      </div>
    </div>
  );
}

interface CompareOverlayProps {
  group: DuplicateGroup;
  keepId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onResolve: () => Promise<void> | void;
  working: boolean;
}

/** Full-screen compare overlay. The right-pane preview was cramped and
 *  forced wrapping that scrambled chord/lyric alignment — this gives
 *  each entry its own column at full reading width. Stacks on narrow
 *  viewports (iPad portrait). */
function CompareOverlay({
  group,
  keepId,
  onSelect,
  onClose,
  onResolve,
  working,
}: CompareOverlayProps) {
  const [showOnlyDiffs, setShowOnlyDiffs] = useState(false);

  // Esc closes the overlay.
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

  // Flatten each entry to its array of text rows, then classify each
  // row position as same / diff across all entries. Memoize so toggling
  // showOnlyDiffs doesn't redo the work.
  const { entryRows, classifications, diffCount } = useMemo(() => {
    const rows = group.entries.map(chordChartLines);
    const cls = diffClassifyRows(rows);
    const diffs = cls.filter((k) => k === "diff").length;
    return { entryRows: rows, classifications: cls, diffCount: diffs };
  }, [group]);

  const plan = useMemo(
    () => planCompareRows(classifications, showOnlyDiffs, 1),
    [classifications, showOnlyDiffs],
  );

  return (
    <div className="fixed inset-0 z-[200] bg-white flex flex-col text-gray-900">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900 truncate">
            Compare “{group.entries[0].title}”
          </h2>
          <p className="text-[12px] text-gray-600 mt-0.5">
            {group.entries.length} copies · {diffCount}{" "}
            {diffCount === 1 ? "row differs" : "rows differ"}. Pick a
            winner; the others get deleted.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-gray-700 px-2 py-1 rounded hover:bg-gray-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnlyDiffs}
              onChange={(e) => setShowOnlyDiffs(e.target.checked)}
              className="accent-blue-600"
              disabled={diffCount === 0}
            />
            Only diffs
          </label>
          <button
            type="button"
            onClick={onResolve}
            disabled={working}
            className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white disabled:opacity-50"
          >
            Keep selected · delete {group.entries.length - 1}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 p-2 rounded hover:bg-gray-200"
            aria-label="Close compare"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 bg-gray-100">
        <div
          className="grid gap-4 min-h-full"
          style={{
            gridTemplateColumns: `repeat(${Math.min(group.entries.length, 3)}, minmax(0, 1fr))`,
          }}
        >
          {group.entries.map((entry, entryIdx) => {
            const selected = keepId === entry.id;
            const rows = entryRows[entryIdx];
            return (
              <div
                key={entry.id}
                className={`flex flex-col rounded-lg border-2 bg-white shadow-sm overflow-hidden ${
                  selected
                    ? "border-blue-500 ring-2 ring-blue-200"
                    : "border-gray-300"
                }`}
              >
                <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 cursor-pointer hover:bg-blue-50">
                  <input
                    type="radio"
                    name={`compare-keep-${group.canonicalKey}`}
                    checked={selected}
                    onChange={() => onSelect(entry.id)}
                    className="accent-blue-600"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">
                      {entry.title}
                      {selected && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-blue-700">
                          keep
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-600">
                      Saved {formatSavedAt(entry.savedAt)} ·{" "}
                      {entryContentScore(entry)} content chars
                      {entry.folder ? ` · ${entry.folder}` : ""}
                    </div>
                  </div>
                </label>
                <div className="flex-1 overflow-auto text-[13px] leading-relaxed font-mono bg-white">
                  {plan.map((slot, slotIdx) => {
                    if (slot.kind === "gap") {
                      return (
                        <div
                          key={`gap-${slotIdx}`}
                          className="px-3 py-1 text-[11px] italic text-gray-500 bg-gray-50 border-y border-gray-100 select-none"
                        >
                          ··· {slot.count} unchanged{" "}
                          {slot.count === 1 ? "row" : "rows"} ···
                        </div>
                      );
                    }
                    const text = rows[slot.index];
                    const isDiff = classifications[slot.index] === "diff";
                    // `missing` styles the slot where THIS entry has no
                    // row at this index but the longer entries do —
                    // shown as an empty dashed row so the diff column
                    // count stays aligned across the grid.
                    const missing = text === undefined;
                    return (
                      <div
                        key={slot.index}
                        className={`px-3 whitespace-pre min-h-[1.4em] ${
                          missing
                            ? "bg-amber-50 text-gray-400 italic border-l-2 border-amber-300"
                            : isDiff
                            ? "bg-amber-100 text-amber-900 border-l-2 border-amber-400"
                            : "text-gray-900"
                        }`}
                      >
                        {missing ? "— (no row in this copy)" : text === "" ? " " : text}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatSavedAt(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

