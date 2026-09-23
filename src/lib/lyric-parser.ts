// ── Inline chord / lyric parser ──────────────────────────────────────────────

import type { ChordChartLine } from "@/lib/schema";
import { expandTabs } from "@/lib/chord-line";

/**
 * Normalize pasted text BEFORE parsing. Paste sources (iOS, Word, Google Docs)
 * inject characters that silently break the parser's column math and chord
 * detection:
 *  - Tabs render at variable widths but count as one char, so the column
 *    offsets the above-the-line parser reads no longer match what the user
 *    sees. Expand them to spaces (tab stops of 8) first. (expandTabs also runs
 *    at patch-apply time, but that's too late for the parse-time column math.)
 *  - Smart quotes / en–em dashes / non-breaking + narrow spaces → ASCII, so
 *    word splitting and chord tokens behave and the text stays plain.
 * Pure and idempotent — safe to run on any pasted blob, or twice.
 */
export function sanitizePastedText(text: string): string {
  const normalized = text
    .replace(/\r\n?/g, "\n")                        // CRLF / CR -> LF
    .replace(/[‘’‛′]/g, "'")    // smart single quotes, prime -> '
    .replace(/[“”‟″]/g, '"')    // smart double quotes, dbl prime -> "
    .replace(/[–—−]/g, "-")          // en/em dash, minus -> -
    .replace(/[   ]/g, " ")         // nbsp / figure / narrow-nbsp -> space
    .replace(/×/g, "x");             // multiplication sign in "×2" -> x
  return expandTabs(normalized);
}

/**
 * Remove the indentation every non-blank line shares. Text copied out of a
 * notes app or a PDF often arrives with every line pushed right by the same
 * two or four spaces; the chart then renders each lyric with a visible gap on
 * the left. Stripping only the COMMON prefix keeps chord/lyric column
 * alignment intact — both lines lose the same amount.
 */
export function stripCommonIndent(text: string): string {
  const lines = text.split("\n");
  let common = Infinity;
  for (const l of lines) {
    if (l.trim() === "") continue;
    const n = l.length - l.trimStart().length;
    if (n < common) common = n;
  }
  if (!Number.isFinite(common) || common === 0) return text;
  return lines.map((l) => (l.trim() === "" ? l : l.slice(common))).join("\n");
}

/**
 * Collapse a block's blank lines: none at the start or end, and never more
 * than one in a row. Pasted charts separate every chord/lyric couplet with a
 * blank line and pile two or three between sections; one is all the chart
 * needs for visual spacing.
 */
export function collapseBlankLines(lines: ChordChartLine[]): ChordChartLine[] {
  const isBlank = (l: ChordChartLine) => !l.chords.trim() && !l.lyrics.trim();
  const out: ChordChartLine[] = [];
  for (const l of lines) {
    if (isBlank(l)) {
      if (out.length === 0 || isBlank(out[out.length - 1])) continue;
    }
    out.push(l);
  }
  while (out.length > 0 && isBlank(out[out.length - 1])) out.pop();
  return out;
}

// A final "END" / "THE END" / "FIN" line is a sheet-music sign-off, not a
// lyric. Only the LAST non-blank line qualifies.
const END_MARKER_RE = /^\s*[\(\[]?\s*(the\s+end|end|fin|fine)\s*[\)\]]?\s*$/i;

function stripTrailingEndMarker(text: string): string {
  const lines = text.split("\n");
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === "") last--;
  if (last < 0 || !END_MARKER_RE.test(lines[last])) return text;
  return lines.slice(0, last).join("\n");
}

// Repeat markers that ride along on a chord row or a section header:
// "x3", "3x", "(x3)", "[x2]", "X2". "×" is normalized to "x" in sanitize.
const REPEAT_TOKEN_RE = /^[\(\[]?(?:x\s?(\d+)|(\d+)\s?x)[\)\]]?$/i;

function repeatCountOf(token: string): number | null {
  const m = REPEAT_TOKEN_RE.exec(stripChordPunct(token));
  if (!m) return null;
  return parseInt(m[1] ?? m[2], 10);
}

// Prepare a pasted blob for parsing: normalize characters, drop the common
// indent, drop a trailing END sign-off, then trim surrounding blank lines.
function prepare(text: string): string {
  return trimBlankLines(stripTrailingEndMarker(stripCommonIndent(sanitizePastedText(text))));
}

/**
 * Drop leading and trailing BLANK lines without touching the horizontal
 * whitespace of the lines we keep.
 *
 * Use this instead of `String.trim()` on any chord-chart text. `trim()` also
 * eats the leading spaces of the FIRST line — and in an above-the-line chart
 * that indentation *is* the column data that puts a chord over its word. A
 * paste like
 *
 *       "      C              G\nDriving to your house"
 *
 * came back as "C              G", sliding the first chord line 6 columns left
 * while every later line kept its indent, so the chords no longer sat over
 * their words and the user had to re-space the line by hand.
 */
export function trimBlankLines(text: string): string {
  const lines = text.split("\n");
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end).join("\n");
}

// ── Section header detection ──────────────────────────────────────────────────

// Matches lines like "Verse 1:", "CHORUS", "Pre-Chorus:", "Bridge 2",
// "Verse Two", "[Chorus]", "(Solo)", "CHORUS x2", "Chorus (2x)".
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
};
const HEADER_KEYWORDS =
  "verse|chorus|bridge|intro|outro|pre[\\s-]?chorus|post[\\s-]?chorus|refrain|hook|" +
  "(?:guitar|piano|bass|drum|sax|keys?)?\\s*solo|instrumental|interlude|breakdown|" +
  "tag|coda|ending|vamp|turnaround|middle\\s?(?:8|eight)";
const SECTION_HEADER_RE = new RegExp(
  "^[\\(\\[]?\\s*(" + HEADER_KEYWORDS + ")" +                       // keyword
    "(?:\\s+(\\d+|" + Object.keys(NUMBER_WORDS).join("|") + "))?" + // number
    "\\s*[\\)\\]]?\\s*:?" +                                          // bracket / colon
    "(?:\\s*[\\(\\[]?\\s*(?:x\\s?(\\d+)|(\\d+)\\s?x)\\s*[\\)\\]]?)?" + // repeat
    "\\s*:?\\s*$",
  "i",
);

const SECTION_LABEL_MAP: Record<string, string> = {
  verse: "Verse",
  chorus: "Chorus",
  bridge: "Bridge",
  intro: "Intro",
  outro: "Outro",
  prechorus: "Pre-Chorus",
  "pre-chorus": "Pre-Chorus",
  "pre chorus": "Pre-Chorus",
  postchorus: "Post-Chorus",
  "post-chorus": "Post-Chorus",
  "post chorus": "Post-Chorus",
  refrain: "Refrain",
  hook: "Hook",
  solo: "Solo",
  instrumental: "Instrumental",
  interlude: "Interlude",
  breakdown: "Breakdown",
  tag: "Tag",
  coda: "Coda",
  ending: "Ending",
  vamp: "Vamp",
  turnaround: "Turnaround",
  middle8: "Middle 8",
  "middle 8": "Middle 8",
  "middle eight": "Middle 8",
};

export interface ParsedHeader {
  /** Normalized label without any repeat marker, e.g. "Verse 2". */
  label: string;
  /** Repeat count when the header carried one ("CHORUS x2" -> 2). */
  repeat?: number;
}

/**
 * Parse a section header line: a keyword, optional number (digits, words or
 * roman numerals), optional colon / brackets, optional repeat marker. Returns
 * null for anything else.
 */
export function parseSectionHeaderFull(line: string): ParsedHeader | null {
  const m = SECTION_HEADER_RE.exec(line.trim());
  if (!m) return null;
  const raw = m[1].toLowerCase().replace(/\s+/g, " ").trim();
  const base =
    SECTION_LABEL_MAP[raw] ??
    raw.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const numRaw = m[2]?.toLowerCase();
  const num = numRaw ? (/^\d+$/.test(numRaw) ? numRaw : String(NUMBER_WORDS[numRaw])) : null;
  const label = num ? `${base} ${num}` : base;
  const rep = m[3] ?? m[4];
  return rep ? { label, repeat: parseInt(rep, 10) } : { label };
}

/**
 * If `line` is a section header, return the normalized label ("Verse 1",
 * "Chorus", "Pre-Chorus", …) with any repeat marker folded in as " x2".
 * Returns null for anything else.
 */
export function parseSectionHeader(line: string): string | null {
  const h = parseSectionHeaderFull(line);
  if (!h) return null;
  return h.repeat ? `${h.label} x${h.repeat}` : h.label;
}

/**
 * A title line: the first non-blank line of a paste that has section headers,
 * when that line comes BEFORE the first header, is neither a header nor a
 * chord row, is short, and stands alone (a blank line or the first header
 * follows it). "LEBANON" at the top of a chart is the song's name, not the
 * Intro's first lyric.
 *
 * Returns the title as written plus the text with that line removed, or
 * null when the first line does not look like a title.
 */
export function detectTitleLine(text: string): { title: string; body: string } | null {
  const prepared = prepare(text);
  if (!prepared) return null;
  const lines = prepared.split("\n");
  const first = lines[0];
  const firstTrim = first.trim();
  if (!firstTrim || firstTrim.length > 60) return null;
  if (parseSectionHeaderFull(first) !== null) return null;
  if (isChordRow(firstTrim.split(/\s+/))) return null;
  if (/\[[A-G][^\]]*\]/.test(firstTrim)) return null;
  if (!lines.some((l) => parseSectionHeaderFull(l) !== null)) return null;
  const next = lines[1];
  const standsAlone = next === undefined || next.trim() === "" || parseSectionHeaderFull(next) !== null;
  if (!standsAlone) return null;
  return { title: firstTrim, body: lines.slice(1).join("\n") };
}

/** "LEBANON" -> "Lebanon"; a title that already has lowercase letters is
 *  left exactly as typed. */
export function normalizeTitleCase(title: string): string {
  if (/[a-z]/.test(title)) return title;
  return title
    .toLowerCase()
    .replace(/(^|[\s\-\(\["'])([a-z])/g, (_m, pre, ch) => pre + ch.toUpperCase());
}

export interface ParsedSection {
  /** Normalized section label, e.g. "Verse 1". Empty string = no header was detected. */
  label: string;
  lines: ChordChartLine[];
}

export interface WordChordPair {
  word: string;
  chord?: string;
}

// Matches chord names: G, Am, C#m, Bb, D7, Cmaj7, G/B, D/F#, sus4, etc.
const CHORD_RE = /^[A-G][b#]?(m|M|maj|min|dim|aug|sus[24]?|add)?\d*(\/[A-G][b#]?)?$/;

// iOS/Word autocorrect can tack a trailing period or comma onto a chord token
// ("C" + double-space -> "C.", or a comma from a list). Strip it before the
// chord test so the token is still recognized. Only trailing punctuation is
// removed — chords never contain '.' or ',' internally.
function stripChordPunct(s: string): string {
  return s.replace(/[.,]+$/, "");
}

/**
 * Is this token something that can appear on a chord line?
 *
 * Bars count. People write intros and turnarounds as bar-delimited chord rows
 * with no lyric under them — "|Am G |Fmaj7 | F |" — and a chord line is only
 * recognized when EVERY token qualifies. Rejecting "|" meant those rows were
 * filed as lyrics and rendered as words, which is how a real Intro came in as
 * a line of text.
 *
 * Bars are stripped only for the chord TEST; `parseToChordChartLines` keeps the
 * raw line, so the "|" markers survive into the chart and still drive bar
 * tracking.
 */
function isChordToken(s: string): boolean {
  const t = stripChordPunct(s);
  if (t === "") return false;
  if (/^\|+$/.test(t)) return true; // a bare bar, or "||"
  if (REPEAT_TOKEN_RE.test(t)) return true; // "x3" riding on a chord row
  const core = t.replace(/^\|+/, "").replace(/\|+$/, "");
  return core !== "" && CHORD_RE.test(core);
}

/**
 * Is this whole line a chord row? Every token must be a chord, a bar, or a
 * repeat marker — and at least one must be a chord or bar, so a lone "x3"
 * is not a chord row.
 */
function isChordRow(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  if (!tokens.every(isChordToken)) return false;
  return tokens.some((t) => repeatCountOf(t) === null);
}

/** The chord text itself, with any bar markers and autocorrect punctuation
 *  removed. Used where a chord is extracted rather than kept in place. */
function chordTextOf(s: string): string {
  return stripChordPunct(s).replace(/^\|+/, "").replace(/\|+$/, "");
}

// Clean a line already confirmed to be chord-only: overwrite each token's
// trailing autocorrect punctuation with spaces (not delete it) so every
// remaining chord keeps its original column and still aligns with the lyric
// line beneath it. On a chord-only line the only '.'/',' are that debris.
function cleanChordLine(line: string): string {
  return line.replace(/[.,]+(?=\s|$)/g, (m) => " ".repeat(m.length)).replace(/\s+$/, "");
}

/** Parse [G]Amazing [C]grace bracketed-chord format. Newlines are treated as spaces. */
function parseBracketed(text: string): WordChordPair[] {
  const pairs: WordChordPair[] = [];
  const re = /\[([^\]]+)\]|(\S+)/g;
  let pendingChord: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text.replace(/\n/g, " "))) !== null) {
    if (m[1] !== undefined) {
      pendingChord = chordTextOf(m[1].trim());
    } else {
      pairs.push({ word: m[2], chord: pendingChord });
      pendingChord = undefined;
    }
  }
  return pairs;
}

/** Parse above-the-line format: a chord-only line paired with the lyric line below it. */
function parseAboveLine(text: string): WordChordPair[] {
  const pairs: WordChordPair[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) { i++; continue; }

    const isChordLine = isChordRow(tokens);
    const nextLine = i + 1 < lines.length ? lines[i + 1] : null;
    const nextTokens = nextLine?.trim().split(/\s+/).filter(Boolean) ?? [];
    const nextIsLyric = nextTokens.length > 0 && !isChordRow(nextTokens);

    if (isChordLine && nextIsLyric) {
      const chordCols: { col: number; chord: string }[] = [];
      let cm: RegExpExecArray | null;
      const cr = /\S+/g;
      while ((cm = cr.exec(line)) !== null) {
        if (isChordToken(cm[0]) && repeatCountOf(cm[0]) === null) {
          const text = chordTextOf(cm[0]);
          if (text) chordCols.push({ col: cm.index, chord: text });
        }
      }

      const wordCols: { col: number; word: string }[] = [];
      let wm: RegExpExecArray | null;
      const wr = /\S+/g;
      while ((wm = wr.exec(nextLine!)) !== null) {
        wordCols.push({ col: wm.index, word: wm[0] });
      }

      // Greedy nearest-unassigned-word: each chord claims the closest available word
      const result: WordChordPair[] = wordCols.map(w => ({ word: w.word }));
      const usedWords = new Set<number>();
      for (const { col, chord } of chordCols) {
        let best = -1, bestDist = Infinity;
        for (let wi = 0; wi < wordCols.length; wi++) {
          if (usedWords.has(wi)) continue;
          const dist = Math.abs(wordCols[wi].col - col);
          if (dist < bestDist) { bestDist = dist; best = wi; }
        }
        if (best >= 0) { result[best].chord = chord; usedWords.add(best); }
      }
      pairs.push(...result);
      i += 2;
    } else {
      pairs.push(...tokens.map(w => ({ word: w })));
      i++;
    }
  }
  return pairs;
}

/**
 * Parse pasted text that may contain inline chord annotations.
 * Bracketed format ([G]word) is detected first; otherwise above-the-line format is tried.
 * Pure lyrics return pairs with no chord field set.
 */
export function parseLyricsWithChords(text: string): WordChordPair[] {
  const trimmed = prepare(text);
  if (!trimmed) return [];
  if (/\[[A-G][^\]]*\]/.test(trimmed)) return parseBracketed(trimmed);
  return parseAboveLine(trimmed);
}

/** Convert a list of word/chord pairs into a ChordChartLine. Chords are placed
 *  at the column offset of their associated word in the lyrics string. */
function pairsToChordChartLine(pairs: WordChordPair[]): ChordChartLine {
  const words = pairs.map(p => p.word);
  const lyrics = words.join(" ");

  // Track the start column of each word
  const wordCols: number[] = [];
  let col = 0;
  for (let i = 0; i < words.length; i++) {
    wordCols.push(col);
    col += words[i].length + 1; // +1 for space separator
  }

  // Build chords string by writing each chord at its word's column
  let chords = "";
  for (let i = 0; i < pairs.length; i++) {
    const chord = pairs[i].chord;
    if (!chord) continue;
    const targetCol = wordCols[i];
    if (targetCol >= chords.length) {
      chords = chords.padEnd(targetCol) + chord;
    } else {
      chords = chords.slice(0, targetCol) + chord + chords.slice(targetCol + chord.length);
    }
  }

  return { chords: chords.trimEnd(), lyrics };
}

/**
 * Parse pasted text into ChordChartLine[] for the chord-chart view.
 * - Bracketed format: each input line becomes one ChordChartLine.
 * - Above-the-line format: chord row + lyric row pairs are preserved as-is.
 * - Pure lyrics: each line becomes a ChordChartLine with empty chords.
 * Blank lines produce { chords: "", lyrics: "" } for visual spacing.
 */
export function parseToChordChartLines(text: string): ChordChartLine[] {
  const trimmed = prepare(text);
  if (!trimmed) return [];

  // Bracketed format: process line by line
  if (/\[[A-G][^\]]*\]/.test(trimmed)) {
    return collapseBlankLines(trimmed.split("\n").map(line => {
      if (!line.trim()) return { chords: "", lyrics: "" };
      const pairs = parseBracketed(line);
      return pairsToChordChartLine(pairs);
    }));
  }

  // Above-the-line format or pure lyrics — preserve line structure
  const lines = trimmed.split("\n");
  const result: ChordChartLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const tokens = line.trim().split(/\s+/).filter(Boolean);

    if (tokens.length === 0) {
      result.push({ chords: "", lyrics: "" });
      i++;
      continue;
    }

    const isChordLine = isChordRow(tokens);
    const nextLine = i + 1 < lines.length ? lines[i + 1] : null;
    const nextTokens = nextLine?.trim().split(/\s+/).filter(Boolean) ?? [];
    const nextIsLyric = nextTokens.length > 0 && !isChordRow(nextTokens);

    if (isChordLine && nextIsLyric) {
      result.push({ chords: cleanChordLine(line), lyrics: nextLine! });
      i += 2;
    } else if (isChordLine) {
      result.push({ chords: cleanChordLine(line), lyrics: "" });
      i++;
    } else {
      result.push({ chords: "", lyrics: line });
      i++;
    }
  }
  return collapseBlankLines(result);
}

/**
 * Parse pasted text into one or more `ParsedSection` objects.
 *
 * If no section headers are found, returns a single section with `label: ""`
 * and the same lines `parseToChordChartLines` would produce.
 *
 * If headers are found, the text is split at each header line. Content before
 * the first header is merged into the first labeled section. Empty sections
 * (header immediately followed by another header) are dropped.
 */
export function parseToSections(text: string): ParsedSection[] {
  const trimmed = prepare(text);
  if (!trimmed) return [];

  const rawLines = trimmed.split("\n");
  const hasHeaders = rawLines.some(l => parseSectionHeaderFull(l) !== null);

  if (!hasHeaders) {
    return [{ label: "", lines: parseToChordChartLines(trimmed) }];
  }

  // Collect raw line blocks keyed by label
  interface Block { label: string; raw: string[]; reference: boolean }
  const blocks: Block[] = [];
  let current: Block = { label: "", raw: [], reference: false };
  const seen = new Set<string>();

  for (const line of rawLines) {
    const header = parseSectionHeaderFull(line);
    if (header !== null) {
      blocks.push(current);
      // A header that repeats an earlier label, or carries a repeat count,
      // is usually a form directive ("CHORUS x2" after verse 2 = play the
      // chorus again) rather than a new section with its own lines. Keep
      // it as a label-only section even when nothing follows it.
      const reference = header.repeat !== undefined || seen.has(header.label);
      seen.add(header.label);
      const label = header.repeat ? `${header.label} x${header.repeat}` : header.label;
      current = { label, raw: [], reference };
    } else {
      current.raw.push(line);
    }
  }
  blocks.push(current);

  // Merge any pre-header content (label === "") into the first labeled block
  const result: ParsedSection[] = [];
  let pending: string[] = [];

  for (const block of blocks) {
    if (!block.label) {
      pending.push(...block.raw);
      continue;
    }
    const merged = [...pending, ...block.raw];
    pending = [];
    const lines = parseToChordChartLines(merged.join("\n"));
    if (lines.length > 0 || block.reference) {
      result.push({ label: block.label, lines });
    }
  }
  // Trailing pending (edge case: content after last header with no following header)
  // — unreachable in practice given the loop structure, but guard anyway.
  if (pending.some(l => l.trim()) && result.length > 0) {
    const extra = parseToChordChartLines(pending.join("\n"));
    result[result.length - 1].lines.push(...extra);
  }

  return result;
}
