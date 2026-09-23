"use client";

// The inline affordance for a riff: a compact text chip, and in perform mode
// a small stave for riffs short enough to glance at.
//
// Rendering tab inline fights three invariants — the monospace `!important` on
// `.chord-chart-line-body *`, the `whitespace-pre` / `ch`-unit column math,
// and PaginatedPerformChart's height-measured bin-packing. The chip sidesteps
// all three. The inline stave is safe for different reasons: RiffTabStaff is
// an SVG with its own font and explicit size (the monospace rule and the
// column math don't reach into it), this row sets `white-space: normal`, and
// the 2-column chart renders this same row in its hidden measuring pass, so
// the stave's height is packed like any other line. Long riffs stay chips —
// a tall stave inline would push the chart around under auto-scroll.

import RiffTabStaff from "@/components/RiffTabStaff";
import { showsInline } from "@/lib/riff-inline";
import type { Riff } from "@/lib/schema";
import { useScoreStore } from "@/store/score-store";

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
  const hiddenIds = useScoreStore((s) => s.uiState.hiddenInlineRiffIds);
  const setUIState = useScoreStore((s) => s.setUIState);
  if (riffs.length === 0) return null;

  const setHidden = (riff: Riff, hidden: boolean) => {
    const rest = hiddenIds.filter((id) => id !== riff.id);
    setUIState({ hiddenInlineRiffIds: hidden ? [...rest, riff.id] : rest });
  };

  return (
    <div
      data-riff-row
      className="flex flex-wrap items-center gap-1.5 mb-2"
      // The line body is `whitespace-pre`; chips wrap normally.
      style={{ whiteSpace: "normal" }}
    >
      {riffs.map((r) =>
        performMode && showsInline(r, hiddenIds) ? (
          <InlineRiff key={r.id} riff={r} onOpen={onOpen} onHide={() => setHidden(r, true)} />
        ) : (
          <RiffChip
            key={r.id}
            riff={r}
            // A hidden small riff comes back inline on tap; a long one opens
            // the peek card as always.
            onOpen={performMode && hiddenIds.includes(r.id) && showsInline(r, []) ? (x) => setHidden(x, false) : onOpen}
            performMode={performMode}
          />
        ),
      )}
    </div>
  );
}

/** A small riff drawn under its line in perform mode: name, Hide, the tab.
 *  Tapping the name opens the peek card for the bigger view. */
function InlineRiff({
  riff,
  onOpen,
  onHide,
}: {
  riff: Riff;
  onOpen: (riff: Riff) => void;
  onHide: () => void;
}) {
  return (
    <div
      className="print-hide w-full max-w-full rounded-lg border border-pink-500/30 bg-pink-500/5 px-2 pt-1 pb-1.5"
      // RiffTabStaff knocks the string line out behind each fret number with
      // this colour; it must read as the box's own background.
      style={{ ["--riff-bg" as string]: "#1a1420" }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(riff);
          }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 min-h-[44px] sm:min-h-0 sm:py-0.5 text-[11px] font-medium text-pink-200 hover:bg-pink-500/20 active:bg-pink-500/30"
          title={`Open "${riff.label}" full size`}
          aria-label={`Open ${riff.label} full size`}
        >
          <span aria-hidden>♪</span>
          <span className="truncate max-w-[16rem]">{riff.label}</span>
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onHide();
          }}
          className="px-2 py-1 min-h-[44px] sm:min-h-0 sm:py-0.5 rounded text-[11px] text-pink-200/80 hover:bg-pink-500/20 active:bg-pink-500/30"
          title="Hide the tab (the chip stays; tap it to show again)"
          aria-label={`Hide tab for ${riff.label}`}
        >
          Hide
        </button>
      </div>
      <div className="overflow-x-auto text-pink-100">
        <RiffTabStaff riff={riff} stringGap={11} />
      </div>
    </div>
  );
}
