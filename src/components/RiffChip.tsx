"use client";

// The inline affordance for a riff: a compact text chip, never a stave.
//
// Rendering tab inline would fight three invariants at once — the monospace
// `!important` on `.chord-chart-line-body *`, the `whitespace-pre` / `ch`-unit
// column math, and PaginatedPerformChart's height-measured bin-packing. A text
// chip participates in all of them like any other line, and the notation lives
// in the peek card instead.

import type { Riff } from "@/lib/schema";

export default function RiffChip({
  riff,
  onOpen,
  performMode,
}: {
  riff: Riff;
  onOpen: (riff: Riff) => void;
  performMode?: boolean;
}) {
  return (
    <button
      type="button"
      // A <button> means the print stylesheet's
      // `.chord-chart button { display: none !important }` hides it for free.
      onClick={(e) => {
        e.stopPropagation();
        onOpen(riff);
      }}
      className={
        "inline-flex items-center gap-1 rounded px-2 py-1 min-h-[44px] sm:min-h-0 sm:py-0.5 " +
        "text-[11px] font-medium border transition-colors align-middle " +
        (performMode
          ? "border-pink-400/50 text-pink-200 bg-pink-500/10 hover:bg-pink-500/20 active:bg-pink-500/30"
          : "border-pink-300/60 text-pink-300 hover:bg-pink-500/10 active:bg-pink-500/20")
      }
      title={`Show the tab for "${riff.label}"`}
      aria-label={`Show tab for ${riff.label}`}
    >
      <span aria-hidden>♪</span>
      <span className="truncate max-w-[16rem]">{riff.label}</span>
    </button>
  );
}

/**
 * The row that holds a line's chips. Rendered as a SIBLING of the
 * `data-bar-line` wrapper, never inside it: the auto-scroll effect measures
 * that element's `getBoundingClientRect().top`, so adding content inside it
 * would move every scroll target.
 */
export function RiffChipRow({
  riffs,
  onOpen,
  performMode,
}: {
  riffs: Riff[];
  onOpen: (riff: Riff) => void;
  performMode?: boolean;
}) {
  if (riffs.length === 0) return null;
  return (
    <div
      data-riff-row
      className="flex flex-wrap items-center gap-1.5 mb-2"
      // The line body is `whitespace-pre`; chips wrap normally.
      style={{ whiteSpace: "normal" }}
    >
      {riffs.map((r) => (
        <RiffChip key={r.id} riff={r} onOpen={onOpen} performMode={performMode} />
      ))}
    </div>
  );
}
