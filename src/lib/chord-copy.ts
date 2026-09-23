/**
 * Copy chords across sections of a pasted chart.
 *
 * Charts are often written with chords over the first verse and the first
 * chorus only — every later verse or chorus is lyrics alone, because the
 * player is expected to know the pattern repeats. The chart here shows each
 * section on its own, so those sections would come in chordless.
 *
 * planChordCopy pairs each chordless section with an earlier section of the
 * same kind that has chords ("Verse 2" <- "Verse 1", the third "Chorus" <-
 * the first) and copies the chord rows across when the lines line up:
 * identical lyrics line by line, or the same number of lyric lines. A
 * section whose line count differs is left alone and reported, so the user
 * can place those chords by hand or ask the AI, which can read the words.
 */

import type { ChordChartLine } from "@/lib/schema";
import type { ParsedSection } from "@/lib/lyric-parser";

export interface ChordCopy {
  /** Index into the sections array. */
  target: number;
  source: number;
}

export interface ChordCopySkip {
  target: number;
  source: number;
  reason: "line-count";
}

export interface ChordCopyPlan {
  /** Sections with the copies applied. Same length and order as the input. */
  sections: ParsedSection[];
  copies: ChordCopy[];
  skipped: ChordCopySkip[];
}

/** "Verse 2" -> "verse", "Chorus x2" -> "chorus", "Pre-Chorus" -> "pre-chorus". */
export function sectionKind(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s*[\(\[]?\s*x\s?\d+\s*[\)\]]?\s*$/, "")
    .replace(/\s+\d+$/, "")
    .trim();
}

const hasChords = (lines: ChordChartLine[]) => lines.some((l) => l.chords.trim() !== "");
const lyricLines = (lines: ChordChartLine[]) =>
  lines.map((l, i) => ({ i, l })).filter(({ l }) => l.lyrics.trim() !== "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function planChordCopy(input: ParsedSection[]): ChordCopyPlan {
  const sections = input.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l })) }));
  const copies: ChordCopy[] = [];
  const skipped: ChordCopySkip[] = [];

  for (let t = 0; t < sections.length; t++) {
    const target = sections[t];
    if (target.lines.length === 0 || hasChords(target.lines)) continue;
    const kind = sectionKind(target.label);
    if (!kind) continue;

    // Nearest earlier section of the same kind that carries chords; failing
    // that, the nearest later one (a chorus written out fully the second time).
    const candidates = [
      ...sections.slice(0, t).map((s, i) => ({ s, i })).reverse(),
      ...sections.slice(t + 1).map((s, i) => ({ s, i: i + t + 1 })),
    ].filter(({ s }) => sectionKind(s.label) === kind && hasChords(s.lines));
    if (candidates.length === 0) continue;

    const tgt = lyricLines(target.lines);
    let done = false;
    for (const { s: source, i: si } of candidates) {
      const src = lyricLines(source.lines);
      if (src.length === 0) continue;
      // Same words: each target line, in order, matches a source line (the
      // source may carry extra lines — a tag, a "Not just yet" — the
      // shortened repeat drops). Failing that, the same number of lines.
      const matched = matchLyricLines(src.map(({ l }) => l.lyrics), tgt.map(({ l }) => l.lyrics));
      const byIndex = !matched && src.length === tgt.length ? tgt.map((_, k) => k) : matched;
      if (byIndex) {
        for (let k = 0; k < tgt.length; k++) {
          target.lines[tgt[k].i] = { ...target.lines[tgt[k].i], chords: src[byIndex[k]].l.chords };
        }
        copies.push({ target: t, source: si });
        done = true;
        break;
      }
    }
    if (!done) skipped.push({ target: t, source: candidates[0].i, reason: "line-count" });
  }

  return { sections, copies, skipped };
}

/** For each target lyric, the index of the source lyric with the same words,
 *  taken in order; null unless every target line finds one. */
function matchLyricLines(source: string[], target: string[]): number[] | null {
  const out: number[] = [];
  let from = 0;
  for (const t of target) {
    const want = norm(t);
    let found = -1;
    for (let k = from; k < source.length; k++) {
      if (norm(source[k]) === want) { found = k; break; }
    }
    if (found < 0) return null;
    out.push(found);
    from = found + 1;
  }
  return out.length ? out : null;
}

/** "Verse 2 ← Verse 1, Chorus (3rd) ← Chorus (1st)" for the modal. */
export function describeCopies(plan: ChordCopyPlan): string {
  const name = (i: number) => {
    const label = plan.sections[i].label || `Section ${i + 1}`;
    const same = plan.sections.filter((s) => s.label === label);
    if (same.length < 2) return label;
    const nth = plan.sections.slice(0, i + 1).filter((s) => s.label === label).length;
    return `${label} (${ordinal(nth)})`;
  };
  return plan.copies.map((c) => `${name(c.target)} ← ${name(c.source)}`).join(", ");
}

export function describeSkips(plan: ChordCopyPlan): string {
  return plan.skipped
    .map((s) => {
      const t = plan.sections[s.target].label || `Section ${s.target + 1}`;
      const src = plan.sections[s.source].label || `Section ${s.source + 1}`;
      return `${t} has a different number of lines than ${src}`;
    })
    .join("; ");
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
