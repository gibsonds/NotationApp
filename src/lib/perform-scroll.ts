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
 * Position the active line at the 1/3-from-top mark of the viewport,
 * but never propose scrolling above 0 (warmup) or past the maximum
 * scroll (end-of-content clamp).
 */
export function computeLineScrollTarget(
  lineContentY: number,
  viewportSize: number,
  maxScroll: number,
): number {
  if (viewportSize <= 0) return 0;
  if (maxScroll <= 0) return 0;
  const ideal = lineContentY - viewportSize / 3;
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
