/**
 * Duplicate-song resolution panel. Shown inside MySongsModal's right
 * pane when the user has same-titled song entries (typically the
 * result of repeated Save-as instead of Save-over).
 *
 * Per group:
 *  - Radio selector for the winner (defaults to richest content).
 *  - "Compare" toggle expands a side-by-side text preview of each
 *    entry's chord chart — that's the user's only handle for telling
 *    near-identical copies apart.
 *  - "Keep selected, delete N others" actions a single group at a
 *    time. The list shrinks as groups resolve; pane closes when empty.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type DuplicateGroup,
  type SongBankEntry,
  entryContentScore,
  findDuplicateGroups,
} from "@/lib/song-bank";

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
  const [compareOpen, setCompareOpen] = useState<Record<string, boolean>>({});
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

  if (groups.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No duplicate-titled songs.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">
            Resolve duplicates
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {groups.length} {groups.length === 1 ? "title" : "titles"} with more
            than one copy. Pick which to keep per group.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 p-1 rounded hover:bg-white/10"
          aria-label="Close duplicate resolver"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {groups.map((group) => (
          <DuplicateGroupCard
            key={group.canonicalKey}
            group={group}
            keepId={selectedKeepIds[group.canonicalKey] ?? group.entries[0].id}
            onSelect={(id) =>
              setSelectedKeepIds((prev) => ({ ...prev, [group.canonicalKey]: id }))
            }
            compareOpen={!!compareOpen[group.canonicalKey]}
            onToggleCompare={() =>
              setCompareOpen((prev) => ({
                ...prev,
                [group.canonicalKey]: !prev[group.canonicalKey],
              }))
            }
            disabled={working}
            onResolve={() => resolveGroup(group)}
          />
        ))}
      </div>
    </div>
  );
}

interface GroupCardProps {
  group: DuplicateGroup;
  keepId: string;
  onSelect: (id: string) => void;
  compareOpen: boolean;
  onToggleCompare: () => void;
  disabled: boolean;
  onResolve: () => void;
}

function DuplicateGroupCard({
  group,
  keepId,
  onSelect,
  compareOpen,
  onToggleCompare,
  disabled,
  onResolve,
}: GroupCardProps) {
  const displayTitle = group.entries[0].title;
  return (
    <div className="border border-white/10 rounded-lg overflow-hidden bg-black/20">
      <div className="flex items-center justify-between px-3 py-2 bg-white/5 border-b border-white/10">
        <span className="text-sm font-medium text-gray-100 truncate">
          {displayTitle}
        </span>
        <button
          type="button"
          onClick={onToggleCompare}
          className="text-[11px] text-blue-300 hover:text-blue-200 px-2 py-0.5 rounded hover:bg-blue-500/10"
        >
          {compareOpen ? "Hide compare" : "Compare"}
        </button>
      </div>
      <div className="divide-y divide-white/5">
        {group.entries.map((entry) => (
          <label
            key={entry.id}
            className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-white/5"
          >
            <input
              type="radio"
              name={`keep-${group.canonicalKey}`}
              checked={keepId === entry.id}
              onChange={() => onSelect(entry.id)}
              className="mt-0.5 accent-blue-500"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[12px] text-gray-200">
                <span className="font-medium truncate">{entry.title}</span>
                {entry.folder && (
                  <span className="text-[9px] uppercase tracking-wider text-gray-500 px-1.5 py-0.5 rounded bg-white/5">
                    {entry.folder}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                Saved {formatSavedAt(entry.savedAt)} · {entryContentScore(entry)}{" "}
                content chars
              </div>
              {compareOpen && (
                <pre className="mt-2 text-[10px] text-gray-400 font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto bg-black/30 rounded p-2 border border-white/5">
                  {chartPreviewText(entry)}
                </pre>
              )}
            </div>
          </label>
        ))}
      </div>
      <div className="px-3 py-2 border-t border-white/10 bg-white/[0.02]">
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

/** Render an entry's chord chart as text for the inline compare view —
 *  section labels + chord row + lyric row per line. Falls back to a
 *  "(no chord chart content)" placeholder for staff-notation-only scores
 *  where there's nothing chord-charty to diff. */
function chartPreviewText(entry: SongBankEntry): string {
  const sections = entry.score.sections ?? [];
  if (sections.length === 0) return "(no chord chart content)";
  const lines: string[] = [];
  for (const section of sections) {
    lines.push(`[${section.label || section.id}]`);
    for (const line of section.lines ?? []) {
      if (line.chords) lines.push(line.chords);
      if (line.lyrics) lines.push(line.lyrics);
      if (!line.chords && !line.lyrics) lines.push("");
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
