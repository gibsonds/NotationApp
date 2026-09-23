// ── ASCII tab ⇄ Riff ────────────────────────────────────────────────────────
//
// ASCII tab is the lingua franca of guitar riffs: it's what's already written
// down wherever the user found the part, and it's what an LLM emits reliably
// (having seen millions of examples) where a nested fret-object grammar would
// come back malformed. So every riff-authoring path — the paste box, the AI —
// funnels through this one pure, tested parser.
//
//   e|--3--5--|--7-----|
//   B|--------|--------|
//   G|--------|--------|
//   D|--------|--------|
//   A|--------|--------|
//   E|--------|--------|
//
// The top line is string 1 (highest pitched), matching how tab is always read
// and how RiffNote.string is numbered.
//
// Rhythm, which tab itself never carries, can ride on an optional line above
// the strings — one letter per note at the note's column, the way drum and
// guitar books mark it:
//
//     q   e e q   e e
//   e|--3---5-7---|--0---3-5---|
//
//   w whole  h half  q quarter  e eighth  s sixteenth  t thirty-second
//   a "." after the letter dots it; a letter over no note is a rest.
//
// Two compact shorthands are accepted too and expanded to tab before parsing
// (see riff-compact.ts): fret runs "*6 5 7 8, 5 7, 5 7" and chord voicings
// "x32010 320003".
//
// With a rhythm line, durations are authoritative and each note's beat is the
// sum of the durations before it in the bar. Without one, rhythm is guessed
// from spacing as before. riffToAsciiTab writes the rhythm line back out, so
// a riff round-trips with its rhythm intact.

import {
  DEFAULT_TUNING,
  type NoteDuration,
  type Riff,
  type RiffBar,
  type RiffEvent,
  type RiffNote,
} from "@/lib/schema";
import { expandCompactRiff } from "@/lib/riff-compact";

export interface ParseAsciiTabResult {
  bars: RiffBar[];
  tuning: string[];
  /** Non-fatal problems. The parser never throws on user input — it returns
   *  what it could read plus an explanation of what it ignored. */
  warnings: string[];
}

/** Beats in a bar, from a "4/4"-style signature. Falls back to 4. */
export function beatsPerBarOf(timeSignature: string | undefined): number {
  const m = /^(\d+)\/(\d+)$/.exec(timeSignature ?? "");
  if (!m) return 4;
  const beats = parseInt(m[1], 10);
  return Number.isFinite(beats) && beats > 0 ? beats : 4;
}

// Beat-span → duration. Ordered longest-first; we pick the largest that fits.
const DURATION_BY_BEATS: ReadonlyArray<readonly [number, NoteDuration]> = [
  [4, "whole"],
  [2, "half"],
  [1, "quarter"],
  [0.5, "eighth"],
  [0.25, "sixteenth"],
  [0.125, "thirty-second"],
];

/** Largest note value that fits in `beats`. Never returns undefined. */
export function durationForBeats(beats: number): NoteDuration {
  for (const [span, dur] of DURATION_BY_BEATS) {
    // Small epsilon: column-derived spans are approximate by nature.
    if (beats >= span - 1e-6) return dur;
  }
  return "sixty-fourth";
}

/** A line that looks like one string of a tab stave. */
const TAB_LINE_RE = /^\s*([A-Ga-g][b#]?)?\s*\|(.*)$/;

/** True if the body of a candidate tab line is made only of tab characters. */
function looksLikeTabBody(body: string): boolean {
  return body.length > 0 && /^[-0-9|hpb/\\~xX*.\s()]+$/.test(body);
}

/** Highest fret a guitar has. A digit run that reads past it ("57") is two
 *  frets written without a dash between them, not fret fifty-seven. */
const MAX_FRET = 24;

const DURATION_BY_LETTER: Record<string, NoteDuration> = {
  w: "whole",
  h: "half",
  q: "quarter",
  e: "eighth",
  s: "sixteenth",
  t: "thirty-second",
};
const LETTER_BY_DURATION: Partial<Record<NoteDuration, string>> = {
  whole: "w",
  half: "h",
  quarter: "q",
  eighth: "e",
  sixteenth: "s",
  "thirty-second": "t",
  "sixty-fourth": "t",
};
const BEATS_BY_DURATION: Record<NoteDuration, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
  "thirty-second": 0.125,
  "sixty-fourth": 0.0625,
};

/** Beats an event occupies, dots included. */
export function eventBeats(duration: NoteDuration, dots = 0): number {
  const base = BEATS_BY_DURATION[duration] ?? 1;
  let total = base;
  let add = base;
  for (let i = 0; i < dots; i++) {
    add /= 2;
    total += add;
  }
  return total;
}

/** A rhythm line: only duration letters (optionally dotted), bars and
 *  spaces, with at least one letter and every letter separated by space —
 *  so a stray word like "sweet" is not mistaken for one. */
const RHYTHM_LINE_RE = /^\s*(?:\|\s*)*[whqest]\.?(?:(?:\s+|\s*\|\s*)[whqest]\.?)*(?:\s*\|)*\s*$/i;

export function isRhythmLine(line: string): boolean {
  return RHYTHM_LINE_RE.test(line) && /[whqest]/i.test(line);
}

interface RhythmMark {
  col: number; // absolute column in the tab body
  duration: NoteDuration;
  dots: number;
}

/** Read the rhythm marks of a rhythm line, with columns relative to the tab
 *  body. `bodyOffset` is where the body starts on a string line ("e|" -> 2)
 *  for a rhythm line written without its own "|". */
function readRhythmLine(line: string, bodyOffset: number): RhythmMark[] {
  const bar = line.indexOf("|");
  const body = bar >= 0 ? line.slice(bar + 1) : line.slice(bodyOffset);
  const marks: RhythmMark[] = [];
  const re = /([whqest])(\.?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    marks.push({
      col: m.index,
      duration: DURATION_BY_LETTER[m[1].toLowerCase()],
      dots: m[2] ? 1 : 0,
    });
  }
  return marks;
}

/**
 * Parse ASCII tab into riff bars.
 *
 * Rhythm is the one thing ASCII tab genuinely does not carry, so it's inferred
 * from horizontal spacing: an event's beat comes from its column position
 * within the bar, and its duration from the gap to the next event. That's a
 * good-enough starting point the editor can then correct — it is not a claim
 * about the true rhythm.
 */
export function parseAsciiTab(
  text: string,
  opts: { timeSignature?: string; tuning?: string[] } = {},
): ParseAsciiTabResult {
  const warnings: string[] = [];
  const beatsPerBar = beatsPerBarOf(opts.timeSignature);

  // Compact shorthands ("*6 5 7 8, 5 7", "x32010") become tab first, so one
  // parser serves every way of writing a riff.
  const expanded = expandCompactRiff(text, opts.tuning ?? DEFAULT_TUNING);
  const rawLines = expanded.split("\n").filter((l) => l.trim() !== "");
  const tabLines: { label: string | null; body: string; bodyOffset: number }[] = [];
  const rhythmLines: string[] = [];

  for (const line of rawLines) {
    if (isRhythmLine(line)) {
      rhythmLines.push(line);
      continue;
    }
    const m = TAB_LINE_RE.exec(line);
    if (m && looksLikeTabBody(m[2])) {
      tabLines.push({ label: m[1] ?? null, body: m[2], bodyOffset: line.indexOf("|") + 1 });
    } else {
      warnings.push(`Ignored line that isn't tab: "${line.trim().slice(0, 40)}"`);
    }
  }

  if (tabLines.length === 0) {
    return { bars: [], tuning: opts.tuning ?? [...DEFAULT_TUNING], warnings };
  }

  const tuning =
    opts.tuning ??
    (tabLines.every((l) => l.label)
      ? tabLines.map((l, i) => normalizeTuningLabel(l.label!, i))
      : [...DEFAULT_TUNING].slice(0, tabLines.length));

  if (tabLines.length !== tuning.length) {
    warnings.push(
      `Tab has ${tabLines.length} strings but tuning has ${tuning.length}; extra strings use standard tuning.`,
    );
  }

  // Split every string into bars on "|". All strings should agree on bar
  // count; if they don't we use the longest and pad, rather than dropping music.
  const perString = tabLines.map((l) => splitBars(l.body));
  const barCount = Math.max(...perString.map((b) => b.length));
  if (perString.some((b) => b.length !== barCount)) {
    warnings.push("Strings disagree on bar count; short strings padded with rests.");
  }

  // Rhythm marks, if a rhythm line was written. Their columns are absolute
  // within the body; each bar's absolute start comes from the first string.
  const marks = rhythmLines.length
    ? readRhythmLine(rhythmLines[0], tabLines[0].bodyOffset)
    : null;
  const barStarts: number[] = [];
  {
    let acc = leadingBarOffset(tabLines[0].body);
    for (const seg of perString[0]) {
      barStarts.push(acc);
      acc += seg.length + 1;
    }
  }

  const bars: RiffBar[] = [];
  for (let b = 0; b < barCount; b++) {
    const segments = perString.map((s) => s[b] ?? "");
    const width = Math.max(...segments.map((s) => s.length), 1);

    // column -> notes at that column
    const byCol = new Map<number, RiffNote[]>();
    for (let si = 0; si < segments.length; si++) {
      for (const hit of readFrets(segments[si])) {
        const list = byCol.get(hit.col) ?? [];
        list.push({
          string: si + 1,
          fret: hit.fret,
          ...(hit.articulation ? { articulation: hit.articulation } : {}),
        });
        byCol.set(hit.col, list);
      }
    }

    const cols = [...byCol.keys()].sort((a, b2) => a - b2);

    if (marks) {
      // Rhythm line present: durations are what it says, beats accumulate.
      // A mark over no note is a rest; a note with no mark near it takes the
      // previous duration.
      const barStart = barStarts[b] ?? 0;
      const barEnd = barStart + width;
      const barMarks = marks.filter((mk) => mk.col >= barStart && mk.col < barEnd);
      const items: { col: number; notes: RiffNote[]; mark?: RhythmMark }[] = [];
      const usedMarks = new Set<RhythmMark>();
      for (const col of cols) {
        const abs = barStart + col;
        let best: RhythmMark | undefined;
        let bestD = 2; // a mark within one column of the note is its mark
        for (const mk of barMarks) {
          if (usedMarks.has(mk)) continue;
          const d = Math.abs(mk.col - abs);
          if (d < bestD) { bestD = d; best = mk; }
        }
        if (best) usedMarks.add(best);
        items.push({ col, notes: byCol.get(col)!, mark: best });
      }
      for (const mk of barMarks) {
        if (!usedMarks.has(mk)) items.push({ col: mk.col - barStart, notes: [], mark: mk });
      }
      items.sort((x, y) => x.col - y.col);
      let beat = 1;
      let lastDur: NoteDuration = "eighth";
      let lastDots = 0;
      const events: RiffEvent[] = items.map((it) => {
        const duration = it.mark?.duration ?? lastDur;
        const dots = it.mark?.dots ?? lastDots;
        lastDur = duration;
        lastDots = dots;
        const ev: RiffEvent = { beat, duration, dots, notes: it.notes };
        beat += eventBeats(duration, dots);
        return ev;
      });
      if (beat - 1 > beatsPerBar + 1e-6) {
        warnings.push(`Bar ${b + 1}: the rhythm adds up to ${beat - 1} beats in a ${beatsPerBar}-beat bar.`);
      }
      bars.push({ events });
      continue;
    }

    // Time is measured from the FIRST note, not from the "|". Essentially all
    // tab pads a couple of dashes after the barline before the first fret;
    // treating column 0 as beat 1 charges that padding as musical time and
    // pushes every note in the bar off its beat. Riffs also nearly always
    // start on the downbeat, so anchoring there is right far more often than
    // it's wrong — and where it isn't, the editor's rhythm control fixes it.
    const firstCol = cols[0] ?? 0;
    const colsPerBeat = Math.max(1e-6, (width - firstCol) / beatsPerBar);
    const events: RiffEvent[] = cols.map((col, i) => {
      const nextCol = i + 1 < cols.length ? cols[i + 1] : width;
      const beat = 1 + (col - firstCol) / colsPerBeat;
      const spanBeats = (nextCol - col) / colsPerBeat;
      return {
        beat: Math.max(1, roundTo(beat, 1 / 4)),
        duration: durationForBeats(spanBeats),
        dots: 0,
        notes: byCol.get(col)!,
      };
    });
    if (events.some((e) => e.beat > beatsPerBar)) {
      warnings.push(
        `Bar ${b + 1}: more notes than fit ${beatsPerBar} beats — rhythm is a guess, check it in the editor.`,
      );
    }

    bars.push({ events });
  }

  return { bars, tuning, warnings };
}

/** Render a riff back to ASCII tab. Round-trips with parseAsciiTab. */
export function riffToAsciiTab(riff: Riff, opts: { colsPerBeat?: number } = {}): string {
  const beatsPerBar = beatsPerBarOf(riff.timeSignature);
  // Enough columns that the shortest note still gets three of them: two
  // digits and a dash. Adjacent digits would fuse ("5" then "7" -> "57")
  // on the way back in.
  let minBeats = 1;
  for (const bar of riff.bars) {
    for (const ev of bar.events) minBeats = Math.min(minBeats, eventBeats(ev.duration, ev.dots));
  }
  const colsPerBeat = Math.max(opts.colsPerBeat ?? 2, Math.ceil(3 / Math.max(minBeats, 0.0625)));
  const width = Math.max(1, Math.round(beatsPerBar * colsPerBeat));
  const stringCount = Math.max(riff.tuning.length, maxStringUsed(riff));
  const hasEvents = riff.bars.some((b) => b.events.length > 0);

  // rows[stringIdx][barIdx] = characters for that bar; rhythm[barIdx] likewise
  const rows: string[][] = Array.from({ length: stringCount }, () => []);
  const rhythm: string[] = [];

  for (const bar of riff.bars) {
    const cells: string[][] = Array.from({ length: stringCount }, () =>
      Array.from({ length: width }, () => "-"),
    );
    const rcells: string[] = Array.from({ length: width }, () => " ");
    for (const ev of bar.events) {
      const col = Math.min(
        width - 1,
        Math.max(0, Math.round(((ev.beat - 1) / beatsPerBar) * width)),
      );
      const letter = LETTER_BY_DURATION[ev.duration] ?? "q";
      rcells[col] = letter;
      if (ev.dots > 0 && col + 1 < width) rcells[col + 1] = ".";
      for (const n of ev.notes) {
        const si = n.string - 1;
        if (si < 0 || si >= stringCount) continue;
        const txt = String(n.fret);
        for (let k = 0; k < txt.length && col + k < width; k++) {
          cells[si][col + k] = txt[k];
        }
      }
    }
    for (let si = 0; si < stringCount; si++) rows[si].push(cells[si].join(""));
    rhythm.push(rcells.join(""));
  }

  const stringLines = rows.map((barsForString, si) => {
    const label = (riff.tuning[si] ?? "").replace(/\d+$/, "") || " ";
    return `${label.padEnd(2)}|${barsForString.join("|")}|`;
  });
  // Rhythm line above the strings, same columns, spaces where the strings
  // have bars so it reads as marks over notes rather than another string.
  const rhythmLine = `${" ".repeat(3)}${rhythm.join(" ")}`.replace(/\s+$/, "");
  return (hasEvents ? [rhythmLine, ...stringLines] : stringLines).join("\n");
}

// ── internals ───────────────────────────────────────────────────────────────

function maxStringUsed(riff: Riff): number {
  let max = 0;
  for (const bar of riff.bars) {
    for (const ev of bar.events) {
      for (const n of ev.notes) if (n.string > max) max = n.string;
    }
  }
  return max;
}

/** Split a tab body on "|", dropping the empty segments the delimiters leave
 *  at each end. */
function splitBars(body: string): string[] {
  const parts = body.split("|");
  while (parts.length && parts[0].trim() === "") parts.shift();
  while (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
  return parts;
}

interface FretHit {
  col: number;
  fret: number;
  articulation?: RiffNote["articulation"];
}

const ARTICULATION_BY_CHAR: Record<string, RiffNote["articulation"]> = {
  h: "hammer",
  p: "pull",
  b: "bend",
  "/": "slide",
  "\\": "slide",
  "~": "bend",
};

/**
 * Read fret numbers out of one bar of one string.
 * Multi-digit frets ("12") are kept together and reported at the column their
 * first digit occupies — splitting them would turn fret 12 into frets 1 and 2.
 */
function readFrets(segment: string): FretHit[] {
  const hits: FretHit[] = [];
  const re = /\d+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    const before = m.index > 0 ? segment[m.index - 1] : "";
    const articulation = ARTICULATION_BY_CHAR[before];
    let first = true;
    for (const { offset, fret } of splitFretRun(m[0])) {
      hits.push({
        col: m.index + offset,
        fret,
        ...(first && articulation ? { articulation } : {}),
      });
      first = false;
    }
  }
  return hits;
}

/** "12" is fret 12, but "57" cannot be fret 57 — it is 5 then 7 written
 *  without a dash. Read greedily: two digits when that is a real fret,
 *  otherwise one. "575" -> 5,7,5; "1012" -> 10,12; "120" -> 12,0. */
function splitFretRun(run: string): { offset: number; fret: number }[] {
  const out: { offset: number; fret: number }[] = [];
  let i = 0;
  while (i < run.length) {
    const two = i + 1 < run.length ? parseInt(run.slice(i, i + 2), 10) : NaN;
    if (Number.isFinite(two) && two <= MAX_FRET) {
      out.push({ offset: i, fret: two });
      i += 2;
    } else {
      out.push({ offset: i, fret: parseInt(run[i], 10) });
      i += 1;
    }
  }
  return out;
}

/** Columns splitBars drops before the first bar ("|--3--|" bodies that
 *  start with a bar, or blank leading segments). */
function leadingBarOffset(body: string): number {
  const parts = body.split("|");
  let off = 0;
  let i = 0;
  while (i < parts.length && parts[i].trim() === "") {
    off += parts[i].length + 1;
    i++;
  }
  return off;
}

/** "e" / "E" / "Bb" as written beside a tab line → a pitch for the tuning
 *  array. Falls back to standard tuning for that string index. */
function normalizeTuningLabel(label: string, stringIdx: number): string {
  const fallback = DEFAULT_TUNING[stringIdx] ?? "E2";
  const letter = label[0];
  if (!letter) return fallback;
  // Tab labels carry no octave. Keep the octave from standard tuning at this
  // position and just take the (possibly altered) letter.
  const octave = fallback.replace(/^[A-G][b#]?/, "");
  const accidental = label.length > 1 ? label[1] : "";
  return `${letter.toUpperCase()}${accidental}${octave}`;
}

function roundTo(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}
