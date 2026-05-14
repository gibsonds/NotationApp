/**
 * Pure helpers for PerformView's auto-scroll. Extracted so the scroll
 * behaviour (warmup, long-line pause, line-transition target,
 * end-of-content clamp) is unit-testable without a real browser /
 * layout engine.
 *
 * Three regression-prone behaviours we want to lock in tests:
 *
 *  1. Warmup — while the active line sits in the top viewport/3, the
 *     scroll target is 0. The chart doesn't move until the playhead
 *     would otherwise be too high in the viewport.
 *
 *  2. Long-line pause — while bars walk across the same line, the
 *     target doesn't move. Scroll stays still.
 *
 *  3. Line transition — when the active bar moves to a different
 *     line, the target jumps to the new line's position minus
 *     viewport/3. Caller animates between targets.
 *
 *  4. End-of-content clamp — target never exceeds the scrollable
 *     range (otherwise the lerp could overshoot off-screen).
 */

import type { BarPos } from "@/lib/chord-bar-inventory";

/**
 * Compute the scrollTop position that should hold the active line at
 * `targetFraction` from the top of the viewport, but DON'T engage
 * scroll until the line's content-Y has passed `triggerFraction` of
 * the viewport. Separating the two means scroll can stay parked while
 * early lines are read (line 1, 2, 3 in the top half), then start
 * tracking the active line once it's past the trigger zone.
 *
 *  - `triggerFraction` (default 0.5): "warm-up zone." While the
 *    active line's content-Y is at or below `viewport × triggerFraction`,
 *    target stays at 0. The chord chart doesn't scroll at all during
 *    the song's opening — the user reads top-down while the playhead
 *    walks toward the trigger.
 *
 *  - `targetFraction` (default 1/3): where the active line settles
 *    once scroll is engaged. The user said "1/3 of the page above the
 *    active bar," which matches.
 *
 * Why two values and not one: testing on Twig showed the
 * single-fraction model engaged scroll on line 2, because line 2's
 * content-Y already exceeded viewport/3. Pulling the trigger deeper
 * (viewport/2) keeps line 2 parked, while still settling the active
 * line at 1/3 once engagement happens.
 */
export function computeLineScrollTarget(
  lineContentY: number,
  viewportSize: number,
  maxScroll: number,
  options: {
    triggerFraction?: number;
    targetFraction?: number;
  } = {},
): number {
  const triggerFraction = options.triggerFraction ?? 0.5;
  const targetFraction = options.targetFraction ?? 1 / 3;
  if (viewportSize <= 0) return 0;
  if (maxScroll <= 0) return 0;
  // Warm-up: don't engage scroll until the active line has crossed
  // the trigger threshold.
  if (lineContentY <= viewportSize * triggerFraction) return 0;
  const ideal = lineContentY - viewportSize * targetFraction;
  if (ideal <= 0) return 0;
  if (ideal >= maxScroll) return maxScroll;
  return ideal;
}

/** True if `next` is on a different (sectionId, lineIdx) than `prev`. */
export function isLineTransition(prev: BarPos | null, next: BarPos | null): boolean {
  if (next === null) return false; // end-of-song; caller stops anyway
  if (prev === null) return true;  // first bar of a session
  return prev.sectionId !== next.sectionId || prev.lineIdx !== next.lineIdx;
}

/**
 * Walk a bar inventory in playback order and emit the sequence of
 * (barIdx, shouldTriggerScroll) decisions a caller would make. Used
 * by tests to verify the scroll trigger pattern matches expected:
 * one trigger per LINE, not one per BAR.
 */
export function scrollTriggerSequence(
  inventory: readonly BarPos[],
): { barIdx: number; lineKey: string; trigger: boolean }[] {
  const out: { barIdx: number; lineKey: string; trigger: boolean }[] = [];
  let prev: BarPos | null = null;
  for (let i = 0; i < inventory.length; i++) {
    const b = inventory[i];
    const trigger = isLineTransition(prev, b);
    out.push({
      barIdx: i,
      lineKey: `${b.sectionId}-${b.lineIdx}`,
      trigger,
    });
    prev = b;
  }
  return out;
}
