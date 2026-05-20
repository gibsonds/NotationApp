/**
 * Row-level diff classification for the duplicate-song compare view.
 *
 * Each entry's chord chart is flattened to an array of text rows
 * (section headings, chord lines, lyric lines, blanks) via
 * `chordChartLines` below. The classifier walks position-by-position
 * across N entries and marks each row "same" (every entry has the
 * exact same text at that index) or "diff" (they differ, or one is
 * missing).
 *
 * This is intentionally a simple per-position comparison rather than
 * a Myers / LCS diff — it works perfectly when entries are
 * save-twice duplicates (1:1 row alignment), and a single inserted
 * line cascades into a run of diffs that the user can read past with
 * the "show only differences" toggle. If we later need true edit-
 * distance alignment we can swap the algorithm without touching the
 * UI shape (the return type is just `RowKind[]`).
 */

import type { SongBankEntry } from "@/lib/song-bank";

export type RowKind = "same" | "diff";

/**
 * Walk position-by-position across all entries' row arrays. Returns
 * one RowKind per row index in the longest entry; entries shorter
 * than the longest get a "diff" classification for the trailing
 * positions (they're missing those rows).
 */
export function diffClassifyRows(entryRows: ReadonlyArray<ReadonlyArray<string>>): RowKind[] {
  if (entryRows.length === 0) return [];
  const maxLen = entryRows.reduce((m, e) => Math.max(m, e.length), 0);
  const out: RowKind[] = [];
  for (let i = 0; i < maxLen; i++) {
    const first = entryRows[0][i];
    let allSame = true;
    for (let j = 0; j < entryRows.length; j++) {
      if (entryRows[j][i] !== first) {
        allSame = false;
        break;
      }
    }
    out.push(allSame ? "same" : "diff");
  }
  return out;
}

/**
 * Flatten a SongBankEntry's chord chart into a text-row array suitable
 * for diffing. One row per section header / chord line / lyric line /
 * blank. Section dividers are emitted as a blank row so visual blocks
 * stay readable in the side-by-side view.
 *
 * Staff-notation-only scores (no `sections`) get a single
 * "(no chord chart content)" row.
 */
export function chordChartLines(entry: SongBankEntry): string[] {
  const sections = entry.score.sections ?? [];
  if (sections.length === 0) return ["(no chord chart content)"];
  const rows: string[] = [];
  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    rows.push(`[${section.label || section.id}]`);
    for (const line of section.lines ?? []) {
      if (line.chords) rows.push(line.chords);
      if (line.lyrics) rows.push(line.lyrics);
      if (!line.chords && !line.lyrics) rows.push("");
    }
    // Blank divider BETWEEN sections (not after the last) so intentional
    // blank lines INSIDE a section are preserved verbatim in the diff
    // view, while the trailing tail doesn't pad it with a same-classified
    // row that everyone agrees on but nobody cares about.
    if (si < sections.length - 1) rows.push("");
  }
  return rows;
}

/**
 * Build a "with collapsed runs of same rows" row plan for the compare
 * view. When `showOnlyDiffs` is off, returns every row index in order.
 * When on, collapses runs of ≥ `collapseThreshold` consecutive same
 * rows into a single "ellipsis" placeholder so the user sees only the
 * interesting parts.
 */
export interface VisibleRow {
  kind: "row";
  index: number;
}
export interface CollapsedGap {
  kind: "gap";
  /** How many consecutive same rows this gap represents. */
  count: number;
}
export type CompareRowSlot = VisibleRow | CollapsedGap;

export function planCompareRows(
  classifications: ReadonlyArray<RowKind>,
  showOnlyDiffs: boolean,
  collapseThreshold = 1,
): CompareRowSlot[] {
  if (!showOnlyDiffs) {
    return classifications.map((_, index) => ({ kind: "row", index } as CompareRowSlot));
  }
  const out: CompareRowSlot[] = [];
  let runStart = -1;
  const flushSameRun = (endExclusive: number) => {
    if (runStart < 0) return;
    const count = endExclusive - runStart;
    if (count >= collapseThreshold) {
      out.push({ kind: "gap", count });
    } else {
      // Short run — keep the rows inline so the user has context.
      for (let i = runStart; i < endExclusive; i++) {
        out.push({ kind: "row", index: i });
      }
    }
    runStart = -1;
  };
  for (let i = 0; i < classifications.length; i++) {
    if (classifications[i] === "same") {
      if (runStart < 0) runStart = i;
    } else {
      flushSameRun(i);
      out.push({ kind: "row", index: i });
    }
  }
  flushSameRun(classifications.length);
  return out;
}
