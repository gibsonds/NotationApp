/**
 * 3-way score merge (#89). Given a common ancestor `base` and two
 * divergent versions `mine` and `theirs`, produce a merged score plus a
 * list of conflicts that couldn't be auto-resolved.
 *
 * The merge is structured around the chord-chart format: sections are
 * matched by id (stable across edits), lines within a section by index.
 * Annotations and per-line highlight/underline ranges union by id —
 * they can never conflict because adds are independent.
 *
 * Real chord conflicts are detected by *chord-token equivalence*, not
 * byte equality. So `'D    G'` and `'D     G'` (same chords, different
 * spacing) are considered the same and the longer (better-aligned) form
 * wins. A real conflict is when the actual chord SEQUENCE differs.
 */

import type {
  Score,
  ChordChartSection,
  ChordChartLine,
  Annotation,
} from "./schema";

// ── Types ─────────────────────────────────────────────────────────────

export type MergeConflict =
  | {
      kind: "line";
      sectionLabel: string;
      sectionId: string;
      lineIdx: number;
      field: "chords" | "lyrics";
      base: string;
      mine: string;
      theirs: string;
    }
  | {
      kind: "score-field";
      field: "tempo" | "timeSignature" | "keySignature" | "title" | "anacrusis";
      base: unknown;
      mine: unknown;
      theirs: unknown;
    }
  | {
      kind: "section-deleted";
      sectionId: string;
      sectionLabel: string;
      // One side deleted, the other edited the section. Kept the edits;
      // surfaces here so the caller can warn the user.
      deletedBy: "mine" | "theirs";
    };

export interface MergeResult {
  /** Merged score. Always a complete valid Score; conflicts are resolved
   *  by taking one side (theirs by default for line content, mine for
   *  score-wide fields) but reported in `conflicts` so the caller can
   *  prompt the user. */
  score: Score;
  /** Empty when the merge was clean. */
  conflicts: MergeConflict[];
  /** Cheap summary for toast messages. */
  stats: {
    sectionsAdded: number;
    sectionsRemoved: number;
    linesChanged: number;
    annotationsAdded: number;
    annotationsRemoved: number;
  };
}

// ── Chord-token comparison (the smart bit) ────────────────────────────

const CHORD_TOKEN_RE = /[A-G][b#♭♯]?[a-zA-Z0-9+°ø()Δ△,#♯b♭\-]*(?:\/[A-G][b#♭♯]?)?|\|/g;

/** Extract the sequence of chord/bar tokens from a chord-line string,
 *  discarding spacing. Used to detect "same chords, different layout". */
export function chordTokens(s: string): string[] {
  CHORD_TOKEN_RE.lastIndex = 0;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = CHORD_TOKEN_RE.exec(s)) !== null) {
    out.push(m[0]);
  }
  return out;
}

/** True when two chord-line strings represent the same musical sequence,
 *  ignoring whitespace differences. */
export function chordSequencesEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = chordTokens(a);
  const tb = chordTokens(b);
  if (ta.length !== tb.length) return false;
  return ta.every((t, i) => t === tb[i]);
}

/** Word-level lyric equivalence (ignoring whitespace differences). */
function lyricsEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const wa = a.trim().split(/\s+/).filter(Boolean);
  const wb = b.trim().split(/\s+/).filter(Boolean);
  if (wa.length !== wb.length) return false;
  return wa.every((w, i) => w === wb[i]);
}

// ── Field-level merge (the per-field decision) ────────────────────────

interface FieldMerge {
  value: string;
  /** True when both sides changed the field non-equivalently. */
  conflict: boolean;
}

/** Three-way merge of a single string field. Returns the merged value plus
 *  whether it was a real conflict. Logic:
 *    - both sides equal to base → no change.
 *    - one side equal to base, the other diverged → take the diverged one.
 *    - both sides diverged but the result is equivalent (whitespace/casing
 *      different) → take the longer (more visually padded) form.
 *    - both sides diverged into truly different content → conflict;
 *      tie-broken by taking the longer content. */
function mergeStringField(
  base: string,
  mine: string,
  theirs: string,
  equivalent: (a: string, b: string) => boolean,
): FieldMerge {
  if (mine === theirs) return { value: mine, conflict: false };
  if (equivalent(mine, theirs)) {
    // Same semantic content, different layout — prefer longer.
    return { value: mine.length >= theirs.length ? mine : theirs, conflict: false };
  }
  if (equivalent(base, mine)) {
    // mine didn't really change — take theirs.
    return { value: theirs, conflict: false };
  }
  if (equivalent(base, theirs)) {
    // theirs didn't really change — take mine.
    return { value: mine, conflict: false };
  }
  // Both sides diverged from base and from each other. Real conflict.
  // Tiebreak: take whichever is non-empty over empty; otherwise the longer.
  if (!mine) return { value: theirs, conflict: true };
  if (!theirs) return { value: mine, conflict: true };
  return { value: mine.length >= theirs.length ? mine : theirs, conflict: true };
}

// ── Line-level merge ──────────────────────────────────────────────────

interface LineMerge {
  line: ChordChartLine;
  conflicts: Array<{ field: "chords" | "lyrics"; base: string; mine: string; theirs: string }>;
}

function mergeLines(
  base: ChordChartLine,
  mine: ChordChartLine,
  theirs: ChordChartLine,
): LineMerge {
  const conflicts: LineMerge["conflicts"] = [];

  const chords = mergeStringField(
    base.chords ?? "",
    mine.chords ?? "",
    theirs.chords ?? "",
    chordSequencesEqual,
  );
  if (chords.conflict) {
    conflicts.push({ field: "chords", base: base.chords ?? "", mine: mine.chords ?? "", theirs: theirs.chords ?? "" });
  }

  const lyrics = mergeStringField(
    base.lyrics ?? "",
    mine.lyrics ?? "",
    theirs.lyrics ?? "",
    lyricsEqual,
  );
  if (lyrics.conflict) {
    conflicts.push({ field: "lyrics", base: base.lyrics ?? "", mine: mine.lyrics ?? "", theirs: theirs.lyrics ?? "" });
  }

  // Boolean toggles → OR (set-union semantics).
  const highlight = (mine.highlight ?? base.highlight ?? false) || (theirs.highlight ?? false);
  const underline = (mine.underline ?? base.underline ?? false) || (theirs.underline ?? false);

  // Range arrays → set-union by [start,end] tuple.
  const highlightRanges = unionRanges(
    mine.highlightRanges,
    theirs.highlightRanges,
  );
  const underlineRanges = unionRanges(
    mine.underlineRanges,
    theirs.underlineRanges,
  );

  const merged: ChordChartLine = {
    ...mine,
    chords: chords.value,
    lyrics: lyrics.value,
    ...(highlight ? { highlight } : {}),
    ...(underline ? { underline } : {}),
    ...(highlightRanges?.length ? { highlightRanges } : {}),
    ...(underlineRanges?.length ? { underlineRanges } : {}),
  };

  return { line: merged, conflicts };
}

function unionRanges(
  a?: ReadonlyArray<readonly [number, number]>,
  b?: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> | undefined {
  if (!a?.length && !b?.length) return undefined;
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (const r of [...(a ?? []), ...(b ?? [])]) {
    const k = `${r[0]},${r[1]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([r[0], r[1]]);
  }
  out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return out;
}

// ── Section-level merge ───────────────────────────────────────────────

interface SectionMerge {
  section: ChordChartSection;
  conflicts: MergeConflict[];
  linesChanged: number;
}

function mergeSection(
  base: ChordChartSection,
  mine: ChordChartSection,
  theirs: ChordChartSection,
): SectionMerge {
  const conflicts: MergeConflict[] = [];
  const baseLines = base.lines ?? [];
  const myLines = mine.lines ?? [];
  const theirLines = theirs.lines ?? [];
  const n = Math.max(myLines.length, theirLines.length);

  const merged: ChordChartLine[] = [];
  let linesChanged = 0;

  for (let i = 0; i < n; i++) {
    const b = baseLines[i] ?? { chords: "", lyrics: "" };
    const m = myLines[i];
    const t = theirLines[i];
    if (m === undefined && t === undefined) continue;
    if (m === undefined) {
      // Only theirs has this line — added by them.
      merged.push(t!);
      linesChanged++;
      continue;
    }
    if (t === undefined) {
      // Only mine has this line — added by me.
      merged.push(m);
      linesChanged++;
      continue;
    }
    const lm = mergeLines(b, m, t);
    merged.push(lm.line);
    if (lm.conflicts.length > 0 || JSON.stringify(b) !== JSON.stringify(lm.line)) linesChanged++;
    for (const c of lm.conflicts) {
      conflicts.push({
        kind: "line",
        sectionLabel: mine.label ?? theirs.label ?? "?",
        sectionId: mine.id ?? theirs.id ?? "?",
        lineIdx: i,
        field: c.field,
        base: c.base,
        mine: c.mine,
        theirs: c.theirs,
      });
    }
  }

  // Pick label: prefer the side that diverged from base.
  const label = mine.label !== base.label ? mine.label : theirs.label ?? base.label ?? mine.label;

  const merged_section: ChordChartSection = {
    ...mine,
    label,
    lines: merged,
  };

  return { section: merged_section, conflicts, linesChanged };
}

// ── Score-level merge ─────────────────────────────────────────────────

/** Run a 3-way merge across the whole score. */
export function mergeScores(
  base: Score,
  mine: Score,
  theirs: Score,
): MergeResult {
  const conflicts: MergeConflict[] = [];
  const stats = {
    sectionsAdded: 0,
    sectionsRemoved: 0,
    linesChanged: 0,
    annotationsAdded: 0,
    annotationsRemoved: 0,
  };

  // ── Score-wide fields ───────────────────────────────────────────────
  const merged: Score = { ...mine };
  for (const field of ["title", "tempo", "timeSignature", "keySignature", "anacrusis"] as const) {
    const b = base[field];
    const m = mine[field];
    const t = theirs[field];
    if (m === t) {
      merged[field] = m as never;
      continue;
    }
    if (b === m) {
      merged[field] = t as never;
      continue;
    }
    if (b === t) {
      merged[field] = m as never;
      continue;
    }
    // Real conflict on a score-wide field. Take mine; surface conflict.
    merged[field] = m as never;
    conflicts.push({ kind: "score-field", field, base: b, mine: m, theirs: t });
  }

  // ── Sections ────────────────────────────────────────────────────────
  const baseById = new Map(base.sections.map((s) => [s.id, s]));
  const mineById = new Map(mine.sections.map((s) => [s.id, s]));
  const theirsById = new Map(theirs.sections.map((s) => [s.id, s]));

  // Walk by id-union, preserving an order that follows mine's order, then
  // appending theirs-only sections at the end.
  const seen = new Set<string>();
  const mergedSections: ChordChartSection[] = [];

  for (const m of mine.sections) {
    seen.add(m.id);
    const b = baseById.get(m.id);
    const t = theirsById.get(m.id);
    if (!t) {
      // theirs deleted, mine kept (or edited). Keep mine; flag if base had it.
      if (b) {
        conflicts.push({
          kind: "section-deleted",
          sectionId: m.id,
          sectionLabel: m.label ?? "?",
          deletedBy: "theirs",
        });
      }
      mergedSections.push(m);
      continue;
    }
    if (!b) {
      // Both added the same id (unusual but possible). Run a 2-way merge
      // treating an empty section as base.
      const empty: ChordChartSection = { id: m.id, label: m.label, lines: [] };
      const sm = mergeSection(empty, m, t);
      mergedSections.push(sm.section);
      conflicts.push(...sm.conflicts);
      stats.linesChanged += sm.linesChanged;
      continue;
    }
    const sm = mergeSection(b, m, t);
    mergedSections.push(sm.section);
    conflicts.push(...sm.conflicts);
    stats.linesChanged += sm.linesChanged;
  }

  // Sections only in theirs (mine deleted them OR theirs added them).
  for (const t of theirs.sections) {
    if (seen.has(t.id)) continue;
    const b = baseById.get(t.id);
    if (b) {
      // mine deleted, theirs kept. Restore theirs and flag.
      conflicts.push({
        kind: "section-deleted",
        sectionId: t.id,
        sectionLabel: t.label ?? "?",
        deletedBy: "mine",
      });
    } else {
      stats.sectionsAdded++;
    }
    mergedSections.push(t);
  }

  // Sections in base but missing from both → really deleted by both.
  for (const b of base.sections) {
    if (!mineById.has(b.id) && !theirsById.has(b.id)) {
      stats.sectionsRemoved++;
    }
  }

  merged.sections = mergedSections;

  // ── Annotations: union by id ────────────────────────────────────────
  const annById = new Map<string, Annotation>();
  for (const a of base.annotations ?? []) annById.set(a.id, a);
  for (const a of mine.annotations ?? []) {
    const existing = annById.get(a.id);
    if (!existing) {
      annById.set(a.id, a);
      stats.annotationsAdded++;
    } else if (a.createdAt >= existing.createdAt) {
      annById.set(a.id, a);
    }
  }
  for (const a of theirs.annotations ?? []) {
    const existing = annById.get(a.id);
    if (!existing) {
      annById.set(a.id, a);
      stats.annotationsAdded++;
    } else if (a.createdAt > existing.createdAt) {
      annById.set(a.id, a);
    }
  }
  // Removed annotations: present in base, absent from BOTH mine and theirs.
  const baseAnnIds = new Set((base.annotations ?? []).map((a) => a.id));
  const mineAnnIds = new Set((mine.annotations ?? []).map((a) => a.id));
  const theirsAnnIds = new Set((theirs.annotations ?? []).map((a) => a.id));
  for (const id of baseAnnIds) {
    if (!mineAnnIds.has(id) && !theirsAnnIds.has(id)) {
      annById.delete(id);
      stats.annotationsRemoved++;
    } else if (!mineAnnIds.has(id) || !theirsAnnIds.has(id)) {
      // One side removed, the other kept — keeping wins.
    }
  }
  merged.annotations = Array.from(annById.values());

  return { score: merged, conflicts, stats };
}
