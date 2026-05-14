/**
 * Flat list of every bar in a chord-chart score, in playback order.
 *
 * A "bar" is the column range from one `|` marker (inclusive) up to
 * the next `|` (exclusive). N pipes on a line → N-1 bars. Lines
 * without `|` markers contribute zero bars; lines with one `|` also
 * contribute zero (no closing barline). This keeps the inventory
 * grounded in explicit bar markers — songs that pre-date barline
 * editing fall back to constant-rate scroll without highlighting.
 *
 * Used by:
 *  - PerformView's auto-scroll loop to derive the active bar from
 *    elapsed time × BPM (one bar = `beatsPerBar` beats).
 *  - ChordChartView to render the active bar's green overlay at the
 *    correct char-column range on the correct line.
 */

import type { Score } from "@/lib/schema";

export interface BarPos {
  /** Index into the flat inventory list (0-based, global across the song). */
  globalIdx: number;
  /** Index of the section in score.sections[]. */
  sectionIdx: number;
  /** Index of the line within the section's lines[]. */
  lineIdx: number;
  /** Inclusive start column in the chord line (the leading `|`). */
  startCol: number;
  /** Exclusive end column (the next `|`). Use endCol - startCol for the bar's character width. */
  endCol: number;
}

export function computeBarInventory(score: Score): BarPos[] {
  const out: BarPos[] = [];
  const sections = score.sections ?? [];
  for (let si = 0; si < sections.length; si++) {
    const lines = sections[si].lines ?? [];
    for (let li = 0; li < lines.length; li++) {
      const chords = lines[li].chords ?? "";
      const pipes: number[] = [];
      for (let c = 0; c < chords.length; c++) {
        if (chords[c] === "|") pipes.push(c);
      }
      for (let p = 0; p < pipes.length - 1; p++) {
        out.push({
          globalIdx: out.length,
          sectionIdx: si,
          lineIdx: li,
          startCol: pipes[p],
          endCol: pipes[p + 1],
        });
      }
    }
  }
  return out;
}

/**
 * Parse a time-signature string like "4/4" / "6/8" / "12/8". Returns
 * the numerator (beats per bar). Defaults to 4 on parse failure so
 * autoscroll never explodes on weird input.
 */
export function beatsPerBarOf(timeSignature: string | undefined | null): number {
  if (!timeSignature) return 4;
  const [num] = timeSignature.split("/");
  const n = parseInt(num ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

/**
 * Given a tempo (BPM) and beats-per-bar, return the active bar index
 * for an `elapsedSec` reading. Returns null when the elapsed time
 * runs past the end of the inventory (caller can pause auto-scroll).
 */
export function activeBarFromElapsed(
  inventory: readonly BarPos[],
  elapsedSec: number,
  tempo: number,
  beatsPerBar: number,
): number | null {
  if (inventory.length === 0 || tempo <= 0 || beatsPerBar <= 0) return null;
  const beats = elapsedSec * (tempo / 60);
  const idx = Math.floor(beats / beatsPerBar);
  if (idx < 0) return 0;
  if (idx >= inventory.length) return null;
  return idx;
}
