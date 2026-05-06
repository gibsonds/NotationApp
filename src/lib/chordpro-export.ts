/**
 * ChordPro export — convert a chord-chart Score into the widely-used
 * ChordPro format (.cho / .crd / .pro). Lets users pull songs into
 * OnSong, SongBook, ChordPro readers, etc.
 *
 * Format:
 *   {title: ...}
 *   {artist: ...}
 *   {key: ...}
 *   {tempo: ...}
 *
 *   {c: Verse 1}
 *   [C]Hello [Am]world how [F]are you to[G]day
 *
 * Our internal model has the chord line and the lyric line stored as two
 * separate columns-aligned strings. Reconstructing inline-bracket form means
 * walking the chord line, finding each chord token's start column, and
 * splicing "[chord]" into the lyric line at that column.
 */

import { Score } from "./schema";

/** Match a chord-or-bar token that may appear on the chords line. We treat
 *  bars as separate emissions because ChordPro carries them inline as `|`
 *  too (some readers honor them, others ignore — either way they're
 *  preserved). */
const CHORD_TOKEN_RE = /[A-G][b#♭♯]?[a-zA-Z0-9+°ø()Δ△,#♯b♭\-]*(?:\/[A-G][b#♭♯]?)?|\|/g;

interface PlacedToken {
  col: number;
  text: string;
}

function tokenizeChordLine(line: string): PlacedToken[] {
  const out: PlacedToken[] = [];
  CHORD_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHORD_TOKEN_RE.exec(line)) !== null) {
    out.push({ col: m.index, text: m[0] });
  }
  return out;
}

/** Splice "[chord]" markers into a lyric line at the columns where chords
 *  start. Tokens past the end of the lyric line are appended at the end. */
function mergeChordsIntoLyric(chordLine: string, lyricLine: string): string {
  const tokens = tokenizeChordLine(chordLine);
  if (tokens.length === 0) return lyricLine;

  // Pad lyric with spaces so any chord column past the lyric end has room.
  const lastCol = tokens[tokens.length - 1].col;
  const padded = lyricLine.padEnd(lastCol + 1, " ");

  // Splice from rightmost to leftmost so earlier insertions don't shift
  // the indices of later ones.
  let result = padded;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    const before = result.slice(0, t.col);
    const after = result.slice(t.col);
    const marker = t.text === "|" ? "|" : `[${t.text}]`;
    result = before + marker + after;
  }
  return result.trimEnd();
}

export function scoreToChordPro(score: Score): string {
  const lines: string[] = [];

  // Headers — ChordPro's standard directives.
  if (score.title) lines.push(`{title: ${score.title}}`);
  if (score.composer) lines.push(`{artist: ${score.composer}}`);
  if (score.keySignature) lines.push(`{key: ${score.keySignature}}`);
  if (score.tempo) lines.push(`{tempo: ${score.tempo}}`);
  lines.push("");

  // Optional form line as a comment so it survives roundtrip even though
  // ChordPro has no native concept of song form.
  if (score.form && score.form.length > 0) {
    lines.push(`{comment: Form — ${score.form.join(" → ")}}`);
    lines.push("");
  }

  for (const section of score.sections || []) {
    // Section label as a ChordPro `{c:}` (comment) directive — most
    // readers render this as a section heading.
    lines.push(`{c: ${section.label}}`);
    for (const line of section.lines) {
      const merged = mergeChordsIntoLyric(line.chords ?? "", line.lyrics ?? "");
      lines.push(merged);
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function downloadScoreAsChordPro(score: Score): void {
  const text = scoreToChordPro(score);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${score.title || "song"}.cho`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
