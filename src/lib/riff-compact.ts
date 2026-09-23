/**
 * Compact text forms for a riff, expanded to ASCII tab.
 *
 * Two shorthands the GuitarLLM / guitar-scales projects use for writing
 * fret material as text, so the same muscle memory works here:
 *
 * Fret runs (from quick_scale_input.py) — frets per string, low string
 * first, a comma moves to the next higher string:
 *
 *     *6 5 7 8, 5 7, 5 7        A minor pentatonic run, strings 6-4
 *     6*5 7 8, 5*5 7            same, older "6*" spelling
 *     *6 5 7, *3 5 7            jump straight to string 3
 *     *6 8 9 |12 12, 9 10       "|12" is a position-shift mark; ignored here
 *
 * Every fret is one note, played in order, as eighth notes.
 *
 * Chord voicings (the usual x32010 form) — one character per string from
 * low E to high e, x for a muted string, dashes optional for two-digit
 * frets:
 *
 *     x32010                    C
 *     320003 x02210 xx0232      G  Am  D   — one strummed chord each, quarters
 *     x-10-12-12-12-10          D barre at the 10th fret
 *
 * A line in either form is expanded into tab lines with a rhythm line, so
 * everything downstream (parser, preview, storage) sees ordinary tab.
 */

import { DEFAULT_TUNING } from "@/lib/schema";

/** `*6 5 7 8, 5 7` / `6*5 7 8, 5*5 7` — starts with a string marker. */
const FRET_RUN_RE = /^\s*(?:\*\d|\d\*)/;
/** `x32010` / `x-10-12-12-12-10` — six string cells, at least one fret. */
const VOICING_TOKEN_RE = /^(?:[xX]|\d{1,2})(?:-?(?:[xX]|\d{1,2})){5}$/;

export function isFretRunLine(line: string): boolean {
  return FRET_RUN_RE.test(line);
}

export function isVoicingLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/);
  return tokens.length > 0 && tokens.every((t) => VOICING_TOKEN_RE.test(t) && /\d/.test(t));
}

export interface FretRunNote {
  string: number; // 1 = highest
  fret: number;
}

/**
 * Read a fret-run line into notes in playing order. Returns null when the
 * line is malformed (a non-numeric fret, or more strings than exist).
 */
export function parseFretRun(line: string, stringCount = 6): FretRunNote[] | null {
  const notes: FretRunNote[] = [];
  let current: number | null = null;
  for (const rawPart of line.split(",")) {
    let part = rawPart.trim();
    if (!part) continue;
    // Position-shift marks: "|12" (ignored) or "|12*4" (sets the string).
    part = part.replace(/\|\d+\*(\d)/g, "*$1").replace(/\|\d+/g, "");
    const explicit = /^\*(\d)\s*(.*)$/.exec(part) ?? (/^(\d)\*\s*(.*)$/.exec(part));
    let frets: string;
    if (explicit) {
      current = parseInt(explicit[1], 10);
      frets = explicit[2];
    } else {
      if (current === null) return null;
      current -= 1;
      frets = part;
    }
    if (current < 1 || current > stringCount) return null;
    for (const tok of frets.split(/\s+/).filter(Boolean)) {
      if (!/^\d{1,2}$/.test(tok)) return null;
      notes.push({ string: current, fret: parseInt(tok, 10) });
    }
  }
  return notes.length ? notes : null;
}

/** Read one `x32010` token into notes, low string first. Returns null if
 *  it isn't a voicing. */
export function parseVoicing(token: string, stringCount = 6): FretRunNote[] | null {
  if (!VOICING_TOKEN_RE.test(token)) return null;
  const cells = token.includes("-")
    ? token.split("-")
    : token.split("").reduce<string[]>((acc, ch) => {
        // Without dashes every character is a cell; "10" can't be written
        // that way, which is why the dashed form exists.
        acc.push(ch);
        return acc;
      }, []);
  if (cells.length !== stringCount) return null;
  const notes: FretRunNote[] = [];
  cells.forEach((c, i) => {
    if (/^[xX]$/.test(c)) return;
    notes.push({ string: stringCount - i, fret: parseInt(c, 10) });
  });
  return notes.length ? notes : null;
}

const COLS_PER_EVENT = 3;

/**
 * Expand compact lines in `text` into ASCII tab. Lines that are already
 * tab, rhythm lines and anything unrecognised pass through untouched, so
 * this is safe to run on every keystroke before parseAsciiTab.
 */
export function expandCompactRiff(text: string, tuning: readonly string[] = DEFAULT_TUNING): string {
  const stringCount = tuning.length;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (isFretRunLine(line)) {
      const notes = parseFretRun(line, stringCount);
      if (notes) {
        out.push(...notesToTab(notes.map((n) => [n]), "e", tuning));
        continue;
      }
    } else if (isVoicingLine(line)) {
      const chords = line.trim().split(/\s+/).map((t) => parseVoicing(t, stringCount));
      if (chords.every((c) => c !== null)) {
        out.push(...notesToTab(chords as FretRunNote[][], "q", tuning));
        continue;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Lay events (each a set of simultaneous notes) into tab lines plus a
 *  rhythm line, `letter` per event, COLS_PER_EVENT columns each. */
function notesToTab(events: FretRunNote[][], letter: string, tuning: readonly string[]): string[] {
  const stringCount = tuning.length;
  const width = events.length * COLS_PER_EVENT + 1;
  const rows = Array.from({ length: stringCount }, () => Array.from({ length: width }, () => "-"));
  const rhythm = Array.from({ length: width }, () => " ");
  events.forEach((ev, i) => {
    const col = 1 + i * COLS_PER_EVENT;
    rhythm[col] = letter;
    for (const n of ev) {
      const row = rows[n.string - 1];
      if (!row) continue;
      const txt = String(n.fret);
      for (let k = 0; k < txt.length && col + k < width; k++) row[col + k] = txt[k];
    }
  });
  const labels = tuning.map((t) => t.replace(/-?\d+$/, ""));
  return [
    `   ${rhythm.join("")}`.replace(/\s+$/, ""),
    ...rows.map((r, i) => `${(labels[i] ?? "").padEnd(2)}|${r.join("")}|`),
  ];
}
