"use client";

// ── The peek card ───────────────────────────────────────────────────────────
//
// "How does that riff go again?" — answered without losing your place.
//
// `position: fixed` is the mechanical guarantee, not a style choice: a fixed
// element cannot be clipped by a scroll container and contributes nothing to
// `scrollHeight`, so opening one provably cannot move an auto-scroll target or
// change 2-column page counts. The chart underneath does not reflow.
//
// Bottom-docked for the same reason: auto-scroll parks the active line a third
// of the way down the viewport, so a card along the bottom edge geometrically
// cannot cover the line you're playing.

import { useEffect, useMemo } from "react";
import RiffTabStaff from "@/components/RiffTabStaff";
import type { Riff } from "@/lib/schema";

export default function RiffPeekCard({
  riff,
  allRiffs,
  onClose,
  onSelect,
  performMode,
}: {
  riff: Riff;
  /** Every riff in the score, for ←/→ cycling. */
  allRiffs: Riff[];
  onClose: () => void;
  onSelect: (riff: Riff) => void;
  performMode?: boolean;
}) {
  const idx = useMemo(() => allRiffs.findIndex((r) => r.id === riff.id), [allRiffs, riff.id]);
  const hasSiblings = allRiffs.length > 1;

  useEffect(() => {
    // CAPTURE phase, and stopPropagation: PerformView registers a bubble-phase
    // window keydown that exits perform mode on Escape. Without capturing, the
    // first Esc would throw the user out of perform instead of closing this.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (!hasSiblings) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        const step = e.key === "ArrowLeft" ? -1 : 1;
        const next = (idx + step + allRiffs.length) % allRiffs.length;
        onSelect(allRiffs[next]);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, onSelect, allRiffs, idx, hasSiblings]);

  const z = performMode ? "z-[60]" : "z-[110]";

  return (
    <>
      {/* Click-catcher, deliberately NOT dimmed — the whole point is that the
          chart stays readable behind the card. */}
      <div className={`fixed inset-0 ${z} print-hide`} onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label={`Tab for ${riff.label}`}
        className={
          `fixed left-1/2 -translate-x-1/2 bottom-20 ${z} print-hide ` +
          "w-[min(640px,92vw)] max-h-[40vh] overflow-auto rounded-xl shadow-2xl " +
          "bg-[#12121f] border border-pink-500/40 text-gray-100"
        }
        // The tab renderer knocks the string line out behind each fret number
        // using this colour, so it must match the card's background.
        style={{ ["--riff-bg" as string]: "#12121f" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
          <span aria-hidden className="text-pink-300">♪</span>
          <h2 className="text-sm font-medium truncate flex-1">{riff.label}</h2>
          {hasSiblings && (
            <>
              <span className="text-[11px] text-gray-400 tabular-nums">
                {idx + 1}/{allRiffs.length}
              </span>
              <button
                type="button"
                onClick={() => onSelect(allRiffs[(idx - 1 + allRiffs.length) % allRiffs.length])}
                className="w-11 h-11 sm:w-8 sm:h-8 rounded hover:bg-white/10 active:bg-white/20 text-gray-300"
                aria-label="Previous riff"
                title="Previous riff (←)"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => onSelect(allRiffs[(idx + 1) % allRiffs.length])}
                className="w-11 h-11 sm:w-8 sm:h-8 rounded hover:bg-white/10 active:bg-white/20 text-gray-300"
                aria-label="Next riff"
                title="Next riff (→)"
              >
                ›
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 sm:w-8 sm:h-8 rounded hover:bg-white/10 active:bg-white/20 text-gray-300"
            aria-label="Close"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 overflow-x-auto">
          <RiffTabStaff riff={riff} />
        </div>

        {riff.capo ? (
          <div className="px-4 pb-2 text-[11px] text-gray-400">Capo {riff.capo}</div>
        ) : null}
      </div>
    </>
  );
}
