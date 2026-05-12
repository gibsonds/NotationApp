"use client";

import { useEffect } from "react";
import type { Score } from "@/lib/schema";
import type { SongDTO } from "@/lib/song-cloud-types";
import { computeConflictDiff, describeDelta } from "@/lib/conflict-diff";

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
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 text-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          This song was changed elsewhere
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          Someone (your other device, or a bandmate) saved a different version
          of <strong>{current.title}</strong> after you loaded it. Pick how to
          resolve — your unsaved work is still in the editor either way.
        </p>

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

        {/* What's different — per-section deltas so the user can pick
            with the actual changes in view. Empty if the section-level
            structure is identical (the conflict may then be annotations
            only, or metadata; the summary counts above hint at that). */}
        {diff.deltas.length > 0 && (
          <div className="mb-4">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-1.5">
              What's different
            </div>
            <ul className="text-sm text-gray-700 space-y-1 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              {visibleDeltas.map((d, i) => (
                <li key={`${d.kind}-${d.label}-${i}`} className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                      d.kind === "only-mine"
                        ? "bg-blue-500"
                        : d.kind === "only-theirs"
                        ? "bg-amber-500"
                        : "bg-gray-400"
                    }`}
                    aria-hidden
                  />
                  <span className="leading-snug">{describeDelta(d)}</span>
                </li>
              ))}
              {hiddenDeltaCount > 0 && (
                <li className="text-xs text-gray-500 pt-1">
                  + {hiddenDeltaCount} more change{hiddenDeltaCount === 1 ? "" : "s"}
                </li>
              )}
            </ul>
          </div>
        )}

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
