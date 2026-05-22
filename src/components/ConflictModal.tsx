"use client";

import { useEffect, useState } from "react";
import type { ChordChartLine, Score } from "@/lib/schema";
import type { SongDTO } from "@/lib/song-cloud-types";
import {
  computeConflictDiff,
  describeDelta,
  type SectionDelta,
} from "@/lib/conflict-diff";

/**
 * Conflict resolution modal (#87, Tier 1). Fires when cloudPutSong returns
 * 409 — the row in cloud was changed by someone else (other tab, other
 * device, bandmate) since this client loaded it.
 *
 * Three resolution paths:
 *  - Keep mine: re-save WITHOUT expectedVersion → forces last-write-wins.
 *  - Discard mine: load cloud version into the editor.
 *  - Cancel: leave both alone; user can revisit by editing again.
 *
 * The diff is intentionally summary-level for now (sections, lines,
 * annotations counts) — full structural diff lives in #89's auto-merge
 * slice and reuses the same modal.
 */
interface ConflictModalProps {
  current: SongDTO;
  local: Score;
  songId: string;
  onKeepMine: () => void;
  onDiscardMine: () => void;
  onCancel: () => void;
}

export default function ConflictModal({
  current,
  local,
  onKeepMine,
  onDiscardMine,
  onCancel,
}: ConflictModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const summary = computeDiffSummary(local, current.score as Score);
  // Per-section deltas — replaces the previous "just look at the counts"
  // approach. First N deltas render; the rest collapse behind a count.
  const diff = computeConflictDiff(local, current.score as Score);
  const SHOWN_DELTAS = 5;
  const visibleDeltas = diff.deltas.slice(0, SHOWN_DELTAS);
  const hiddenDeltaCount = Math.max(0, diff.deltas.length - SHOWN_DELTAS);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col text-gray-800">
        <div className="p-6 pb-4 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            This song was changed elsewhere
          </h2>
          <p className="text-sm text-gray-600">
            Someone (your other device, or a bandmate) saved a different version
            of <strong>{current.title}</strong> after you loaded it. Pick how to
            resolve — your unsaved work is still in the editor either way.
          </p>
        </div>

        <div className="px-6 flex-1 overflow-y-auto min-h-0">
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-4 text-xs text-gray-700 font-mono space-y-0.5">
            <div>
              <span className="text-gray-500">Their version:</span>{" "}
              {summary.theirSections} sections, {summary.theirChordChars} chord
              chars, {summary.theirAnnotations} annotations
            </div>
            <div>
              <span className="text-gray-500">Your version:</span>{" "}
              {summary.yourSections} sections, {summary.yourChordChars} chord
              chars, {summary.yourAnnotations} annotations
            </div>
            {summary.note && (
              <div className="pt-1 text-amber-700 not-italic">{summary.note}</div>
            )}
          </div>

          {/* What's different — per-section deltas, each expandable into
              a line-by-line diff so the user can see the actual chord /
              lyric content they're being asked to pick between. */}
          {diff.deltas.length > 0 && (
            <div className="mb-4">
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-1.5">
                What's different — tap a section to see the lines
              </div>
              <ul className="text-sm text-gray-700 space-y-1.5">
                {visibleDeltas.map((d, i) => (
                  <DeltaRow key={`${d.kind}-${d.label}-${i}`} delta={d} />
                ))}
                {hiddenDeltaCount > 0 && (
                  <li className="text-xs text-gray-500 pt-1 px-1">
                    + {hiddenDeltaCount} more change{hiddenDeltaCount === 1 ? "" : "s"}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="p-6 pt-3 shrink-0 border-t border-gray-100 bg-white">
          <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onDiscardMine}
            className="w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white transition-colors"
            title="Replace your unsaved work with the cloud version"
          >
            Discard mine — load latest
          </button>
          <button
            type="button"
            onClick={onKeepMine}
            className="w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 transition-colors"
            title="Overwrite the cloud version with what's in your editor"
          >
            Keep mine — overwrite cloud
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel — decide later
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

/** One row in the "What's different" list. Always-expandable —
 *  collapsed shows the one-line summary; expanded shows the actual
 *  chord + lyric content per changed line (or the full section
 *  content for only-mine / only-theirs). */
function DeltaRow({ delta }: { delta: SectionDelta }) {
  const [expanded, setExpanded] = useState(false);
  const dotColor =
    delta.kind === "only-mine"
      ? "bg-blue-500"
      : delta.kind === "only-theirs"
      ? "bg-amber-500"
      : "bg-gray-400";
  return (
    <li className="bg-amber-50 border border-amber-100 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-amber-100 text-left"
        aria-expanded={expanded}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`}
          aria-hidden
        />
        <span className="leading-snug flex-1">{describeDelta(delta)}</span>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-amber-100 bg-white px-3 py-2 font-mono text-[12px] leading-relaxed">
          {delta.kind === "lines-differ" && (
            <div className="space-y-2.5">
              {delta.changes.map((c) => (
                <div key={c.idx} className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 not-italic font-sans">
                    Line {c.idx + 1}
                  </div>
                  <DiffLineSide label="theirs" line={c.theirs} side="theirs" />
                  <DiffLineSide label="mine" line={c.mine} side="mine" />
                </div>
              ))}
            </div>
          )}
          {(delta.kind === "only-mine" || delta.kind === "only-theirs") && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 not-italic font-sans">
                {delta.kind === "only-mine"
                  ? "Section content (lost if you discard mine):"
                  : "Section content (gained if you discard mine):"}
              </div>
              {delta.lines.length === 0 ? (
                <div className="text-gray-400 italic">(empty section)</div>
              ) : (
                delta.lines.map((line, i) => (
                  <DiffLineSide
                    key={i}
                    label={`${i + 1}`}
                    line={line}
                    side={delta.kind === "only-mine" ? "mine" : "theirs"}
                  />
                ))
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** A single chord+lyric pair styled per side. `mine` = blue tint
 *  (matches the "Keep mine" / blue Discard button accents); `theirs`
 *  = amber tint (matches the "their version" warm color used above).
 *  Missing rows render as a dashed placeholder so the diff stays
 *  aligned visually. */
function DiffLineSide({
  label,
  line,
  side,
}: {
  label: string;
  line: ChordChartLine | undefined;
  side: "mine" | "theirs";
}) {
  const tint =
    side === "mine"
      ? "bg-blue-50 border-blue-200 text-blue-900"
      : "bg-amber-50 border-amber-200 text-amber-900";
  const sideLabel = side === "mine" ? "yours" : "theirs";
  if (!line) {
    return (
      <div className={`rounded border border-dashed ${tint} opacity-70 px-2 py-1 flex items-start gap-2`}>
        <span className="text-[10px] uppercase tracking-wider opacity-70 shrink-0 w-12">
          {sideLabel}
        </span>
        <span className="italic opacity-70">(no line {label})</span>
      </div>
    );
  }
  const chords = (line.chords ?? "").replace(/^\s+|\s+$/g, "");
  const lyrics = (line.lyrics ?? "").replace(/^\s+|\s+$/g, "");
  return (
    <div className={`rounded border ${tint} px-2 py-1 flex items-start gap-2`}>
      <span className="text-[10px] uppercase tracking-wider opacity-70 shrink-0 w-12 pt-0.5">
        {sideLabel}
      </span>
      <div className="flex-1 min-w-0 break-words">
        {chords && <div className="whitespace-pre-wrap">{chords}</div>}
        {lyrics && <div className="whitespace-pre-wrap opacity-90">{lyrics}</div>}
        {!chords && !lyrics && <div className="italic opacity-60">(blank line)</div>}
      </div>
    </div>
  );
}

function computeDiffSummary(
  local: Score,
  remote: Score,
): {
  yourSections: number;
  theirSections: number;
  yourChordChars: number;
  theirChordChars: number;
  yourAnnotations: number;
  theirAnnotations: number;
  note?: string;
} {
  const chordChars = (s: Score) =>
    (s.sections ?? []).reduce(
      (sum, sec) =>
        sum + sec.lines.reduce((n, l) => n + (l.chords?.length ?? 0), 0),
      0,
    );
  const yourSections = local.sections?.length ?? 0;
  const theirSections = remote.sections?.length ?? 0;
  const yourChordChars = chordChars(local);
  const theirChordChars = chordChars(remote);
  const yourAnnotations = local.annotations?.length ?? 0;
  const theirAnnotations = remote.annotations?.length ?? 0;

  let note: string | undefined;
  if (yourSections > theirSections || yourChordChars > theirChordChars + 50) {
    note = "Your version looks like it has more content.";
  } else if (
    theirSections > yourSections ||
    theirChordChars > yourChordChars + 50
  ) {
    note = "Their version looks like it has more content.";
  }
  return {
    yourSections,
    theirSections,
    yourChordChars,
    theirChordChars,
    yourAnnotations,
    theirAnnotations,
    note,
  };
}
