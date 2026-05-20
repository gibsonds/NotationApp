/**
 * Wrap a chord+lyric line pair into sub-rows that each fit within
 * `maxChars`, preserving the chord/lyric column alignment.
 *
 * Used by 2-col perform mode: long lines that overflow the narrow
 * column are split into multiple visual rows so they display without
 * being clipped.
 *
 * Split priority:
 *  1. Rightmost `|` in the chord line at column ≤ maxChars — each
 *     wrapped sub-row starts on a clean bar boundary.
 *  2. Rightmost whitespace in either chord or lyric ≤ maxChars — break
 *     between words / chord names. Whitespace is preserved in the next
 *     sub-row (no character is dropped).
 *  3. Hard cut at maxChars — last resort for lines with no breakable
 *     boundary.
 *
 * Column alignment is maintained by slicing chords and lyrics at the
 * SAME character offset every time. The character that sat at column
 * N in the original pair stays at column N within whichever sub-row
 * contains it.
 */

export interface WrappedSubRow {
  chords: string;
  lyrics: string;
  /** Offset in characters from the original line's column 0. Lets a
   *  caller re-base highlight / underline ranges per sub-row. */
  offset: number;
}

export function wrapChordLineAtBars(
  chords: string,
  lyrics: string,
  maxChars: number,
): WrappedSubRow[] {
  if (maxChars <= 0) return [{ chords, lyrics, offset: 0 }];

  const rows: WrappedSubRow[] = [];
  let pos = 0;
  while (true) {
    const remC = chords.slice(pos);
    const remL = lyrics.slice(pos);
    const remLen = Math.max(remC.length, remL.length);
    if (remLen <= maxChars) {
      rows.push({ chords: remC, lyrics: remL, offset: pos });
      break;
    }
    const off = findWrapOffset(remC, remL, maxChars);
    rows.push({
      chords: remC.slice(0, off),
      lyrics: remL.slice(0, off),
      offset: pos,
    });
    pos += off;
    // Safety: if findWrapOffset ever returns 0 we'd loop forever.
    if (off <= 0) {
      rows.push({ chords: remC.slice(1), lyrics: remL.slice(1), offset: pos + 1 });
      break;
    }
  }
  return rows;
}

/**
 * Compute the column positions that separate bars in a chord line.
 * Matches the boundary logic in `chord-bar-inventory.ts` so consumers
 * of this helper see the same bar count as the active-bar overlay.
 *
 * Returns `[]` when the line has no `|` markers (the line contributes
 * no addressable bars). Otherwise the returned array describes
 * `boundaries.length - 1` bars: bar K spans columns
 * `[boundaries[K], boundaries[K+1])`.
 */
export function computeBarBoundaries(chords: string): number[] {
  const pipes: number[] = [];
  for (let c = 0; c < chords.length; c++) {
    if (chords[c] === "|") pipes.push(c);
  }
  if (pipes.length === 0) return [];
  const firstNonSpace = chords.search(/\S/);
  const lastNonSpaceEnd = chords.replace(/\s+$/, "").length;
  const hasLeadingContent = firstNonSpace !== -1 && firstNonSpace < pipes[0];
  const hasTrailingContent = lastNonSpaceEnd > pipes[pipes.length - 1] + 1;
  const out: number[] = [];
  if (hasLeadingContent) out.push(firstNonSpace);
  for (const p of pipes) out.push(p);
  if (hasTrailingContent) out.push(lastNonSpaceEnd);
  return out;
}

/**
 * Persistent reflow: split a chord+lyric line into multiple lines of
 * `barsPerLine` bars each, slicing both strings at the SAME column
 * positions to preserve chord/lyric alignment.
 *
 * Differs from `wrapChordLineAtBars` (which is display-time): this is
 * the building block for the `reflow_section` patch op that writes
 * back into the score, so the LLM, editor, 1-col view, and print
 * surface all see the same shorter lines.
 *
 * Idempotency: if the line already has ≤ `barsPerLine` bars, returns
 * a single sub-line equal to the input. Lines without `|` markers
 * pass through unchanged.
 *
 * Each sub-line's chord slice is extended by 1 char IF the next
 * column is `|`, so each output sub-line carries its own closing
 * barline (matching how users typically format chord charts —
 * "| Em | Bm |" not "| Em | Bm").
 */
export function reflowChordLine(
  chords: string,
  lyrics: string,
  barsPerLine: number,
): { chords: string; lyrics: string }[] {
  if (barsPerLine <= 0) return [{ chords, lyrics }];
  const boundaries = computeBarBoundaries(chords);
  if (boundaries.length === 0) return [{ chords, lyrics }];
  const barCount = boundaries.length - 1;
  if (barCount <= barsPerLine) return [{ chords, lyrics }];

  const out: { chords: string; lyrics: string }[] = [];
  for (let i = 0; i < barCount; i += barsPerLine) {
    const endBar = Math.min(i + barsPerLine, barCount);
    const isLastChunk = endBar === barCount;
    const startCol = boundaries[i];
    const endCol = boundaries[endBar];
    // Trailing-pipe extension: if the char AT endCol is `|`, include
    // it so this sub-line shows a clean closing barline. The pipe
    // also appears as the leading `|` of the next sub-line (the
    // chord-chart convention is that consecutive bars share a barline).
    const chordEnd = chords[endCol] === "|" ? endCol + 1 : endCol;
    // Lyric ownership: intermediate chunks cut at endCol (so the col
    // shared as the next chunk's opening barline isn't duplicated).
    // The LAST chunk extends to the full lyric length — anything past
    // the last bar boundary (e.g., a trailing syllable) belongs there.
    const lyricEnd = isLastChunk ? lyrics.length : endCol;
    out.push({
      chords: chords.slice(startCol, chordEnd),
      lyrics: lyrics.slice(startCol, Math.min(lyricEnd, lyrics.length)),
    });
  }
  return out;
}

function findWrapOffset(
  chords: string,
  lyrics: string,
  maxChars: number,
): number {
  // 1) Rightmost `|` in chords at column 1..maxChars. Split AT the bar
  //    marker (so the next sub-row begins with `|`, matching how bar
  //    inventories read the chord chart).
  let bestBar = -1;
  const barLimit = Math.min(chords.length, maxChars + 1);
  for (let i = 1; i < barLimit; i++) {
    if (chords[i] === "|") bestBar = i;
  }
  if (bestBar > 0) return bestBar;

  // 2) Rightmost whitespace in either chord or lyric at column 1..maxChars.
  //    Walking right-to-left so we naturally find the rightmost match.
  const scanMax = Math.min(maxChars - 1, Math.max(chords.length, lyrics.length) - 1);
  for (let i = scanMax; i >= 1; i--) {
    const c = chords[i];
    const l = lyrics[i];
    if ((c !== undefined && /\s/.test(c)) || (l !== undefined && /\s/.test(l))) {
      // Split AT the whitespace position — the whitespace becomes the
      // first char of the next sub-row. Keeps the column alignment
      // invariant intact (no characters dropped or duplicated).
      return i;
    }
  }

  // 3) Hard cut.
  return maxChars;
}
