/**
 * ChordPro import — parse a .cho/.crd/.pro/.txt file into a Score with
 * chord-chart sections. Handles the common subset:
 *
 *   {title: ...} {artist: ...} {key: ...} {tempo: ...}
 *   {c: Section Label}        — also {comment:}, {start_of_chorus}, etc.
 *   [C]Hello [G]world         — inline-bracket chord lines
 *
 * Inline-bracket chord text is split into our two-line representation:
 * a chords line with chord tokens at column N, and a lyrics line that
 * contains everything else with the chord position implied by alignment.
 * The format is what `scoreToChordPro` emits, so roundtrip is loss-tolerant.
 */

import { Score, ChordChartSection } from "./schema";
import { v4 as uuidv4 } from "uuid";

interface SectionInProgress {
  id: string;
  label: string;
  lines: { chords: string; lyrics: string }[];
}

function splitInlineLine(raw: string): { chords: string; lyrics: string } {
  // Walk the raw text. Each `[token]` becomes a chord placed at the
  // current column of the lyric output.
  let lyrics = "";
  let chords = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "[") {
      const end = raw.indexOf("]", i + 1);
      if (end === -1) {
        // Unterminated bracket — drop into lyrics verbatim
        lyrics += raw.slice(i);
        break;
      }
      const token = raw.slice(i + 1, end);
      // Pad chord line out to current lyric column, then write the token.
      while (chords.length < lyrics.length) chords += " ";
      chords += token;
      i = end + 1;
      continue;
    }
    lyrics += raw[i];
    i++;
  }
  // Trim trailing chord-only padding.
  return {
    chords: chords.replace(/\s+$/, ""),
    lyrics: lyrics.replace(/\s+$/, ""),
  };
}

const DIRECTIVE_RE = /^\{\s*([a-zA-Z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/;

export interface ChordProImportResult {
  score: Score;
  warnings: string[];
}

export function parseChordPro(text: string): ChordProImportResult {
  const warnings: string[] = [];
  let title = "Imported Song";
  let composer = "";
  let key: Score["keySignature"] = "C";
  let tempo = 120;
  const sections: ChordChartSection[] = [];
  let current: SectionInProgress | null = null;

  const startSection = (label: string) => {
    current = {
      id: uuidv4().slice(0, 8),
      label,
      lines: [],
    };
    sections.push(current);
  };

  const lines = text.replace(/\r\n/g, "\n").split("\n");

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;

    const dirMatch = DIRECTIVE_RE.exec(trimmed);
    if (dirMatch) {
      const [, name, value] = dirMatch;
      const v = (value ?? "").trim();
      switch (name.toLowerCase()) {
        case "title":
        case "t":
          title = v || title;
          break;
        case "artist":
        case "subtitle":
        case "st":
          composer = v || composer;
          break;
        case "key":
          if (v) {
            // Coerce to one of our supported key labels — anything else is
            // recorded as a warning but doesn't fail the import.
            const allowed = new Set([
              "C", "G", "D", "A", "E", "B", "F#", "Gb", "Db", "Ab", "Eb",
              "Bb", "F", "Am", "Em", "Bm", "F#m", "C#m", "G#m", "D#m",
              "A#m", "Bbm", "Dm", "Gm", "Cm", "Fm", "Ebm",
            ]);
            if (allowed.has(v)) {
              key = v as Score["keySignature"];
            } else {
              warnings.push(`Unknown key "${v}", defaulting to C.`);
            }
          }
          break;
        case "tempo": {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n > 0) tempo = n;
          break;
        }
        case "c":
        case "comment":
          // Comments often carry section labels in the wild. Heuristic:
          // if it's short-ish and not already in a section, start one.
          if (v && v.length <= 32) {
            startSection(v);
          } else if (v) {
            // Long comments → preserve as a one-line lyrics-only entry.
            if (!current) startSection("Verse 1");
            current!.lines.push({ chords: "", lyrics: v });
          }
          break;
        case "start_of_chorus":
        case "soc":
          startSection("Chorus");
          break;
        case "start_of_verse":
        case "sov":
          startSection(`Verse ${sections.filter(s => s.label.startsWith("Verse")).length + 1}`);
          break;
        case "start_of_bridge":
        case "sob":
          startSection("Bridge");
          break;
        case "end_of_chorus":
        case "eoc":
        case "end_of_verse":
        case "eov":
        case "end_of_bridge":
        case "eob":
          // No-op — section just ends; the next directive or lyric line
          // will start a new section if needed.
          break;
        default:
          // Unknown directive — silently drop.
          break;
      }
      continue;
    }

    // Body line — inline brackets.
    if (!current) startSection("Verse 1");
    current!.lines.push(splitInlineLine(raw));
  }

  // Fallback: empty section list means we have a truly bare file. Make
  // one section with a placeholder so the chord-chart view renders.
  if (sections.length === 0) {
    startSection("Verse 1");
    current!.lines.push({ chords: "", lyrics: "" });
  }

  const score: Score = {
    id: uuidv4(),
    title,
    composer,
    tempo,
    timeSignature: "4/4",
    keySignature: key,
    measures: 1,
    anacrusis: false,
    staves: [],
    chordSymbols: [],
    rehearsalMarks: [],
    repeats: [],
    sections,
    form: [],
    annotations: [],
    metadata: {},
  };

  return { score, warnings };
}
