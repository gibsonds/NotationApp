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
  /** Stable section id (matches Score.sections[i].id). Used to address
   *  the DOM line wrapper when PerformView scroll-tracks the active bar. */
  sectionId: string;
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
      // A line with no pipes contributes no bars — fall back to
      // constant tempo-scaled scroll for that line. (User must add
      // `|` markers to enable bar tracking on that line.)
      if (pipes.length === 0) continue;

      // Implicit boundaries: chord content that sits OUTSIDE the
      // pipe-bracketed region still represents bars. Two common
      // patterns we used to miss:
      //
      //   "Em | Bm | C |"  — leading Em chord before the first `|`
      //                       is a real bar (3 bars total, not 2).
      //   "| C | F | G"    — trailing G chord after the last `|` is
      //                       a real bar (3 bars total, not 2).
      //
      // Treat the first non-space col as an implicit boundary when
      // it precedes the first pipe; treat the position just past the
      // last non-space col as an implicit boundary when it follows
      // the last pipe.
      const firstNonSpace = chords.search(/\S/);
      // Index just past the last non-space character (exclusive end).
      const lastNonSpaceEnd = chords.replace(/\s+$/, "").length;
      const hasLeadingContent =
        firstNonSpace !== -1 && firstNonSpace < pipes[0];
      const hasTrailingContent =
        lastNonSpaceEnd > pipes[pipes.length - 1] + 1;

      const boundaries: number[] = [];
      if (hasLeadingContent) boundaries.push(firstNonSpace);
      for (const p of pipes) boundaries.push(p);
      if (hasTrailingContent) boundaries.push(lastNonSpaceEnd);

      for (let p = 0; p < boundaries.length - 1; p++) {
        out.push({
          globalIdx: out.length,
          sectionIdx: si,
          sectionId: sections[si].id,
          lineIdx: li,
          startCol: boundaries[p],
          endCol: boundaries[p + 1],
        });
      }
    }
  }
  return out;
}

/**
 * Bar-coverage heuristic for the perform-mode scroll-mode toggle.
 *
 * Returns the fraction of CHORD-CONTAINING lines that have at least
 * one `|` marker. Lines without chord content (blank, lyric-only,
 * section headers) don't enter the denominator — they couldn't have
 * bars anyway. Zero chord lines → 0 (defensive; caller treats as
 * "no usable bar coverage").
 *
 * Used by PerformView to decide whether to default to bar-driven
 * scroll (good coverage) or constant-rate scroll (sparse / no bars).
 * The user can override the auto-decision with the toolbar toggle.
 */
export function barCoverageFraction(score: { sections?: { lines?: { chords?: string; lyrics?: string }[] }[] }): number {
  const sections = score.sections ?? [];
  let chordLines = 0;
  let barredLines = 0;
  for (const section of sections) {
    for (const line of section.lines ?? []) {
      const chords = line.chords ?? "";
      if (chords.length === 0) continue;
      chordLines++;
      if (chords.includes("|")) barredLines++;
    }
  }
  if (chordLines === 0) return 0;
  return barredLines / chordLines;
}

/**
 * Convenience predicate: is bar coverage good enough to use the
 * bar-tracked scroll model by default? Threshold defaults to 0.8
 * (80% of chord-containing lines have at least one `|`).
 */
export function hasUsableBarTracking(
  score: { sections?: { lines?: { chords?: string; lyrics?: string }[] }[] },
  threshold = 0.8,
): boolean {
  return barCoverageFraction(score) >= threshold;
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
