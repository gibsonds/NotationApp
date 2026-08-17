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

import {
  DEFAULT_TUNING,
  type NoteDuration,
  type Riff,
  type RiffBar,
  type RiffEvent,
  type RiffNote,
} from "@/lib/schema";

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

  const rawLines = text.split("\n").filter((l) => l.trim() !== "");
  const tabLines: { label: string | null; body: string }[] = [];

  for (const line of rawLines) {
    const m = TAB_LINE_RE.exec(line);
    if (m && looksLikeTabBody(m[2])) {
      tabLines.push({ label: m[1] ?? null, body: m[2] });
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
  const colsPerBeat = opts.colsPerBeat ?? 2;
  const beatsPerBar = beatsPerBarOf(riff.timeSignature);
  const width = Math.max(1, Math.round(beatsPerBar * colsPerBeat));
  const stringCount = Math.max(riff.tuning.length, maxStringUsed(riff));

  // rows[stringIdx][barIdx] = characters for that bar
  const rows: string[][] = Array.from({ length: stringCount }, () => []);

  for (const bar of riff.bars) {
    const cells: string[][] = Array.from({ length: stringCount }, () =>
      Array.from({ length: width }, () => "-"),
    );
    for (const ev of bar.events) {
      const col = Math.min(
        width - 1,
        Math.max(0, Math.round(((ev.beat - 1) / beatsPerBar) * width)),
      );
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
  }

  return rows
    .map((barsForString, si) => {
      const label = (riff.tuning[si] ?? "").replace(/\d+$/, "") || " ";
      return `${label.padEnd(2)}|${barsForString.join("|")}|`;
    })
    .join("\n");
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
    hits.push({
      col: m.index,
      fret: parseInt(m[0], 10),
      ...(ARTICULATION_BY_CHAR[before]
        ? { articulation: ARTICULATION_BY_CHAR[before] }
        : {}),
    });
  }
  return hits;
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
