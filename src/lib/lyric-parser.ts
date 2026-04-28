// ── Inline chord / lyric parser ──────────────────────────────────────────────

import type { ChordChartLine } from "@/lib/schema";

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
function isChordToken(s: string): boolean { return CHORD_RE.test(s); }

/** Parse [G]Amazing [C]grace bracketed-chord format. Newlines are treated as spaces. */
function parseBracketed(text: string): WordChordPair[] {
  const pairs: WordChordPair[] = [];
  const re = /\[([^\]]+)\]|(\S+)/g;
  let pendingChord: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text.replace(/\n/g, " "))) !== null) {
    if (m[1] !== undefined) {
      pendingChord = m[1].trim();
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
        if (isChordToken(cm[0])) chordCols.push({ col: cm.index, chord: cm[0] });
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
  const trimmed = text.trim();
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
  const trimmed = text.trim();
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
      result.push({ chords: line, lyrics: nextLine! });
      i += 2;
    } else if (isChordLine) {
      result.push({ chords: line, lyrics: "" });
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
  const trimmed = text.trim();
  if (!trimmed) return [];

  const rawLines = trimmed.split("\n");
  const hasHeaders = rawLines.some(l => parseSectionHeader(l) !== null);

  if (!hasHeaders) {
    return [{ label: "", lines: parseToChordChartLines(text) }];
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
