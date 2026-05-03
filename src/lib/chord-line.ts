/**
 * Helpers for editing the free-form `chords` overlay string of a chord-chart line.
 *
 * The chord line is plain text rendered in monospace above a lyric line. Tokens
 * are runs of non-space characters separated by spaces. Each token is one
 * "thing" — a chord name like `D`, `Am7`, a bar marker like `|`, or a combined
 * `|D`. We treat tokens atomically: clicking on column 5 finds the token whose
 * column range covers 5, then replaces or deletes it. Click on a column inside
 * a run of spaces inserts a new token there, padding with spaces as needed.
 */

const isSpace = (ch: string): boolean => ch === " " || ch === "\t";

/**
 * Find the start column of the next word (run of non-whitespace) in `lyrics`
 * after `fromCol`. Used for Tab-style advance from one chord position to the
 * next syllable/word so chord entry stays hands-on-keyboard.
 *
 * Returns `null` if there's no next word on this line.
 */
export function findNextWordStartCol(lyrics: string, fromCol: number): number | null {
  let i = fromCol;
  // If we're inside a word, skip to its end
  while (i < lyrics.length && !isSpace(lyrics[i])) i++;
  // Skip whitespace to the next word start
  while (i < lyrics.length && isSpace(lyrics[i])) i++;
  return i < lyrics.length ? i : null;
}

/**
 * Find the start column of the word immediately before `fromCol`. Used for
 * Shift+Tab. Returns `null` if there's no previous word.
 */
export function findPrevWordStartCol(lyrics: string, fromCol: number): number | null {
  // Move one char left of the cursor's column to skip past the current
  // position before searching backward.
  let i = Math.min(fromCol - 1, lyrics.length - 1);
  if (i < 0) return null;
  // Skip any whitespace going left
  while (i >= 0 && isSpace(lyrics[i])) i--;
  if (i < 0) return null;
  // Walk back to the start of this word
  while (i > 0 && !isSpace(lyrics[i - 1])) i--;
  return i;
}

export interface ChordToken {
  start: number; // 0-based column where this token begins
  len: number;   // length in characters
  text: string;  // the token text
}

export function tokenizeChordLine(chords: string): ChordToken[] {
  const tokens: ChordToken[] = [];
  let i = 0;
  while (i < chords.length) {
    const ch = chords[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    // Bar markers are their own tokens — clicking on a "|" should target the
    // bar (not a fused "|D" that includes the next chord). Allows the user to
    // move/remove a bar without affecting the chord that lives next to it.
    if (ch === "|") {
      tokens.push({ start: i, len: 1, text: "|" });
      i++;
      continue;
    }
    // Chord-name run: anything that's not whitespace and not a bar marker.
    const start = i;
    while (
      i < chords.length &&
      chords[i] !== " " &&
      chords[i] !== "\t" &&
      chords[i] !== "|"
    ) {
      i++;
    }
    tokens.push({ start, len: i - start, text: chords.slice(start, i) });
  }
  return tokens;
}

/**
 * Find the chord token that "owns" a given click column. A column is owned by
 * a token if it falls inside the token's character span OR within one column
 * to either side (so clicking the space immediately before/after a chord still
 * targets it — easier hit area).
 *
 * Bar markers ("|") deliberately get NO slack: they're 1-column-wide precise
 * markers, and a forgiving hit area would cause the empty column next to a
 * bar to "select" the bar, then editing replaces it and the bar disappears.
 */
export function findTokenAtColumn(chords: string, col: number, slack = 1): ChordToken | undefined {
  const tokens = tokenizeChordLine(chords);
  return tokens.find(t => {
    const s = t.text === "|" ? 0 : slack;
    return col >= t.start - s && col < t.start + t.len + s;
  });
}

/**
 * Write `newChord` into the chord line at `col`. If `newChord` is empty, the
 * existing chord (if any) at that column is removed. Other tokens are
 * preserved at their original columns whenever possible — replacing a chord
 * with a longer one consumes following spaces; replacing with a shorter one
 * pads with spaces. Inserting into a run of spaces consumes those spaces.
 *
 * `targetCol` is the column the user clicked on. If a token already covers
 * that column, that token is the one being edited. Otherwise a new token is
 * inserted at `targetCol`.
 */
export function setChordAtColumn(chords: string, targetCol: number, newChord: string): string {
  const existing = findTokenAtColumn(chords, targetCol);

  // Replace or delete an existing chord
  if (existing) {
    const before = chords.slice(0, existing.start);
    const after = chords.slice(existing.start + existing.len);

    if (newChord === "") {
      // Delete: replace the token's characters with spaces so column positions
      // of any later tokens are preserved exactly.
      return before + " ".repeat(existing.len) + after;
    }

    const lenDiff = newChord.length - existing.len;
    if (lenDiff === 0) {
      return before + newChord + after;
    } else if (lenDiff > 0) {
      // Longer chord — try to consume leading spaces from `after` so we don't
      // push later tokens to the right.
      let consume = lenDiff;
      let i = 0;
      while (consume > 0 && i < after.length && after[i] === " ") {
        i++;
        consume--;
      }
      // If we consumed enough spaces, drop them; otherwise the line gets longer
      // (acceptable — better than truncating other chord names).
      const trimmedAfter = consume === 0 ? after.slice(i) : after.slice(lenDiff - consume);
      return before + newChord + trimmedAfter;
    } else {
      // Shorter chord — pad with spaces to keep later tokens at their columns.
      return before + newChord + " ".repeat(-lenDiff) + after;
    }
  }

  // Insert new token at targetCol
  if (newChord === "") return chords; // nothing to do

  if (targetCol >= chords.length) {
    // Past the end: pad with spaces and append.
    const padding = " ".repeat(targetCol - chords.length);
    return chords + padding + newChord;
  }

  // Insert into a run of spaces. Try to overwrite spaces so later tokens stay put.
  const before = chords.slice(0, targetCol);
  const after = chords.slice(targetCol);
  let canOverwrite = true;
  for (let i = 0; i < newChord.length; i++) {
    if (i >= after.length || after[i] !== " ") {
      canOverwrite = false;
      break;
    }
  }
  if (canOverwrite) {
    return before + newChord + after.slice(newChord.length);
  }
  // Falls back to pushing — chord names later on the line shift right.
  return before + newChord + after;
}
