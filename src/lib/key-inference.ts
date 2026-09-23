/**
 * Key inference from the chords of a score.
 *
 * Nobody wants to pick the key from a dropdown when the chart already says
 * it: the chords are the evidence. Every key in the KeySignature enum is
 * scored on how many of the chart's chords are diatonic to it, with extra
 * weight on the chords that behave like a tonic — the first chord of the
 * song and the last chord — and the best score wins. Relative major and
 * minor share a diatonic set, so those tonic bonuses are what tell A minor
 * from C major.
 *
 * Pure; the chart view, the properties panel and the paste modal all use it.
 */

import type { KeySignature, Score } from "@/lib/schema";
import { tokenizeChordLine } from "@/lib/chord-line";
import { splitGluedChords } from "@/lib/lyric-parser";

type Quality = "maj" | "min" | "dim";

interface ParsedChord {
  pc: number; // pitch class 0..11
  quality: Quality;
  flat: boolean; // spelled with a flat (Bb) rather than a sharp (A#)
}

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "Fmaj7" -> F major, "Am" -> A minor, "G/B" -> G major, "Bdim" -> B dim.
 *  Returns null for anything that isn't a chord (bars, "N.C.", "x3"). */
export function parseChord(token: string): ParsedChord | null {
  const m = /^([A-G])([b#]?)(.*)$/.exec(token.replace(/^\|+|\|+$/g, ""));
  if (!m) return null;
  const rest = m[3].replace(/\/[A-G][b#]?$/, ""); // drop slash bass
  if (rest && !/^(maj|min|m|M|dim|aug|sus|add|°|-|\+|\d)/.test(rest)) return null;
  let pc = PC[m[1]];
  if (m[2] === "#") pc = (pc + 1) % 12;
  if (m[2] === "b") pc = (pc + 11) % 12;
  const quality: Quality = /^(dim|°)/.test(rest)
    ? "dim"
    : /^(min|m(?!aj)|-)/.test(rest)
      ? "min"
      : "maj";
  return { pc, quality, flat: m[2] === "b" };
}

/** Chords of the score in reading order: chord-chart lines first, then the
 *  notation chord symbols. */
export function chordsOf(score: Pick<Score, "sections" | "chordSymbols">): ParsedChord[] {
  const out: ParsedChord[] = [];
  for (const sec of score.sections ?? []) {
    for (const line of sec.lines) {
      for (const t of tokenizeChordLine(line.chords ?? "")) {
        for (const part of splitGluedChords(t.text)) {
          const c = parseChord(part);
          if (c) out.push(c);
        }
      }
    }
  }
  for (const cs of score.chordSymbols ?? []) {
    const c = parseChord(cs.symbol);
    if (c) out.push(c);
  }
  return out;
}

// Diatonic triads as [semitones above tonic, quality].
const MAJOR_DIATONIC: [number, Quality][] = [
  [0, "maj"], [2, "min"], [4, "min"], [5, "maj"], [7, "maj"], [9, "min"], [11, "dim"],
];
// Natural minor plus the harmonic-minor V.
const MINOR_DIATONIC: [number, Quality][] = [
  [0, "min"], [2, "dim"], [3, "maj"], [5, "min"], [7, "min"], [7, "maj"], [8, "maj"], [10, "maj"],
];

const MAJOR_NAMES: Record<number, KeySignature | [KeySignature, KeySignature]> = {
  0: "C", 1: "Db", 2: "D", 3: "Eb", 4: "E", 5: "F", 6: ["F#", "Gb"], 7: "G", 8: "Ab", 9: "A", 10: "Bb", 11: "B",
};
const MINOR_NAMES: Record<number, KeySignature | [KeySignature, KeySignature]> = {
  0: "Cm", 1: "C#m", 2: "Dm", 3: ["D#m", "Ebm"], 4: "Em", 5: "Fm", 6: "F#m", 7: "Gm", 8: "G#m", 9: "Am", 10: "Bbm", 11: "Bm",
};

export interface KeyGuess {
  key: KeySignature;
  /** 0..1 — how far the winner is ahead of the runner-up. Below ~0.15 the
   *  chart is genuinely ambiguous (modal, or two keys sharing its chords). */
  confidence: number;
}

/**
 * Best-fitting key for the score's chords, or null when it has no chords.
 */
export function inferKey(score: Pick<Score, "sections" | "chordSymbols">): KeyGuess | null {
  const chords = chordsOf(score);
  if (chords.length === 0) return null;
  // Enharmonic spelling follows the chart: a chart written in flats gets Gb,
  // one in sharps gets F#.
  const flats = chords.filter((c) => c.flat).length;

  const first = chords[0];
  const last = chords[chords.length - 1];
  const scores: { key: KeySignature; score: number }[] = [];

  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ["maj", "min"] as const) {
      const diatonic = mode === "maj" ? MAJOR_DIATONIC : MINOR_DIATONIC;
      const fits = (c: ParsedChord) =>
        diatonic.some(([iv, q]) => (tonic + iv) % 12 === c.pc && q === c.quality);
      const isTonic = (c: ParsedChord) => c.pc === tonic && c.quality === mode;
      let s = 0;
      for (const c of chords) s += fits(c) ? 1 : -0.6;
      for (const c of chords) if (isTonic(c)) s += 0.5;
      if (isTonic(first)) s += 2;
      if (isTonic(last)) s += 2;
      const names = mode === "maj" ? MAJOR_NAMES[tonic] : MINOR_NAMES[tonic];
      const key = Array.isArray(names) ? (flats > 0 ? names[1] : names[0]) : names;
      scores.push({ key, score: s });
    }
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  const span = Math.max(1, chords.length);
  const confidence = Math.max(0, Math.min(1, (best.score - second.score) / span));
  return { key: best.key, confidence };
}
