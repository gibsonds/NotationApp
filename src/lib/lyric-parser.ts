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
    .replace(/[   ]/g, " ");         // nbsp / figure / narrow-nbsp -> space
  return expandTabs(normalized);
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

// Matches lines like "Verse 1:", "CHORUS", "Pre-Chorus:", "Bridge 2"
const SECTION_HEADER_RE =
  /^(verse|chorus|bridge|intro|outro|pre[\s-]?chorus|refrain|hook)(\s+\d+)?\s*:?\s*$/i;

const SECTION_LABEL_MAP: Record<string, string> = {
  verse: "Verse",
  chorus: "Chorus",
  bridge: "Bridge",
  intro: "Intro",
  outro: "Outro",
  prechorus: "Pre-Chorus",
  "pre-chorus": "Pre-Chorus",
  "pre chorus": "Pre-Chorus",
  refrain: "Refrain",
  hook: "Hook",
};

/**
 * If `line` is a section header (case-insensitive keyword optionally followed
 * by a number and/or colon), return the normalized label ("Verse 1", "Chorus",
 * "Pre-Chorus", …). Returns null for anything else.
 */
export function parseSectionHeader(line: string): string | null {
  const m = SECTION_HEADER_RE.exec(line.trim());
  if (!m) return null;
  // Normalize the keyword via the map; fall back to title-case
  const raw = m[1].toLowerCase().replace(/\s/g, " ").trim();
  const base = SECTION_LABEL_MAP[raw] ?? (raw.charAt(0).toUpperCase() + raw.slice(1));
  const num = m[2]?.trim();
  return num ? `${base} ${num}` : base;
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
function isChordToken(s: string): boolean { return CHORD_RE.test(stripChordPunct(s)); }

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
      pendingChord = stripChordPunct(m[1].trim());
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

    const isChordLine = tokens.every(isChordToken);
    const nextLine = i + 1 < lines.length ? lines[i + 1] : null;
    const nextTokens = nextLine?.trim().split(/\s+/).filter(Boolean) ?? [];
    const nextIsLyric = nextTokens.length > 0 && !nextTokens.every(isChordToken);

    if (isChordLine && nextIsLyric) {
      const chordCols: { col: number; chord: string }[] = [];
      let cm: RegExpExecArray | null;
      const cr = /\S+/g;
      while ((cm = cr.exec(line)) !== null) {
        if (isChordToken(cm[0])) chordCols.push({ col: cm.index, chord: stripChordPunct(cm[0]) });
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
  const trimmed = trimBlankLines(sanitizePastedText(text));
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
  const trimmed = trimBlankLines(sanitizePastedText(text));
  if (!trimmed) return [];

  // Bracketed format: process line by line
  if (/\[[A-G][^\]]*\]/.test(trimmed)) {
    return trimmed.split("\n").map(line => {
      if (!line.trim()) return { chords: "", lyrics: "" };
      const pairs = parseBracketed(line);
      return pairsToChordChartLine(pairs);
    });
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

    const isChordLine = tokens.every(isChordToken);
    const nextLine = i + 1 < lines.length ? lines[i + 1] : null;
    const nextTokens = nextLine?.trim().split(/\s+/).filter(Boolean) ?? [];
    const nextIsLyric = nextTokens.length > 0 && !nextTokens.every(isChordToken);

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
  return result;
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
  const trimmed = trimBlankLines(sanitizePastedText(text));
  if (!trimmed) return [];

  const rawLines = trimmed.split("\n");
  const hasHeaders = rawLines.some(l => parseSectionHeader(l) !== null);

  if (!hasHeaders) {
    return [{ label: "", lines: parseToChordChartLines(trimmed) }];
  }

  // Collect raw line blocks keyed by label
  interface Block { label: string; raw: string[] }
  const blocks: Block[] = [];
  let current: Block = { label: "", raw: [] };

  for (const line of rawLines) {
    const header = parseSectionHeader(line);
    if (header !== null) {
      blocks.push(current);
      current = { label: header, raw: [] };
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
    if (lines.length > 0) {
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
