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
