/**
 * Annotation set-union helpers (#89).
 *
 * Annotations are conflict-free by construction: every annotation has a
 * UUID, so adds from any side are non-conflicting. Removes are detected
 * via a 3-way diff against the common ancestor (present in base, absent
 * from both sides). Updates to the same annotation by both sides resolve
 * by `createdAt` — newer wins, since the field is updated on edit.
 *
 * Lives separately from score-merge.ts so it can be reused by the live
 * collaborative path (Tier 3 / Yjs) and by the chord-chart-only sync
 * path that doesn't need full score merging.
 */

import type { Annotation, Riff } from "./schema";

export interface AnnotationMergeStats {
  added: number;
  removed: number;
  updated: number;
}

export interface AnnotationMergeResult {
  annotations: Annotation[];
  stats: AnnotationMergeStats;
}

export interface MergeByIdResult<T> {
  items: T[];
  stats: AnnotationMergeStats;
}

/**
 * Generic 3-way set-union over id-keyed items. Annotations and riffs are both
 * conflict-free by construction — every item carries a UUID, so adds from
 * either side compose, and a delete is only honoured when BOTH sides dropped
 * something the base had (keep wins over delete). Concurrent edits to the same
 * id resolve by `timestampOf`, newest wins, ties to mine.
 *
 * One algorithm, two callers: writing this a third time for riffs is how the
 * two copies drift apart.
 */
export function mergeById<T extends { id: string }>(
  base: readonly T[],
  mine: readonly T[],
  theirs: readonly T[],
  timestampOf: (item: T) => number,
): MergeByIdResult<T> {
  const stats: AnnotationMergeStats = { added: 0, removed: 0, updated: 0 };

  const baseById = new Map<string, T>();
  for (const a of base) baseById.set(a.id, a);
  const mineById = new Map<string, T>();
  for (const a of mine) mineById.set(a.id, a);
  const theirsById = new Map<string, T>();
  for (const a of theirs) theirsById.set(a.id, a);

  const result = new Map<string, T>();

  // Pass 1: walk every id present in any side.
  const allIds = new Set<string>([
    ...baseById.keys(),
    ...mineById.keys(),
    ...theirsById.keys(),
  ]);

  for (const id of allIds) {
    const b = baseById.get(id);
    const m = mineById.get(id);
    const t = theirsById.get(id);

    // Both sides removed it: drop, count as removal.
    if (!m && !t) {
      if (b) stats.removed++;
      continue;
    }

    // Only one side has it.
    if (!m) {
      // mine deleted, theirs has it — restore (keep wins over delete).
      if (b) {
        // mine deleted what was in base; theirs kept. Resurrected.
        result.set(id, t!);
      } else {
        // theirs added.
        result.set(id, t!);
        stats.added++;
      }
      continue;
    }
    if (!t) {
      // theirs deleted, mine has it.
      if (b) {
        result.set(id, m);
      } else {
        result.set(id, m);
        stats.added++;
      }
      continue;
    }

    // Both sides have it — newest wins, ties to mine.
    if (timestampOf(m) === timestampOf(t) && jsonEqual(m, t)) {
      result.set(id, m);
      continue;
    }
    const winner = timestampOf(m) >= timestampOf(t) ? m : t;
    result.set(id, winner);
    if (!b || !jsonEqual(b, winner)) stats.updated++;
  }

  return { items: Array.from(result.values()), stats };
}

export function mergeAnnotations(
  base: readonly Annotation[],
  mine: readonly Annotation[],
  theirs: readonly Annotation[],
): AnnotationMergeResult {
  // Annotation has no updatedAt, so createdAt stands in as last-modified.
  const { items, stats } = mergeById(base, mine, theirs, (a) => a.createdAt);
  return { annotations: items, stats };
}

/** Riffs carry a real `updatedAt`; fall back to createdAt for older entries. */
export function mergeRiffs(
  base: readonly Riff[],
  mine: readonly Riff[],
  theirs: readonly Riff[],
): { riffs: Riff[]; stats: AnnotationMergeStats } {
  const { items, stats } = mergeById(base, mine, theirs, (r) => r.updatedAt ?? r.createdAt);
  return { riffs: items, stats };
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Highlight / underline range set-union ──────────────────────────────

/**
 * Union two arrays of [start, end] ranges, deduping exact matches and
 * sorting by start. Used for per-line highlight and underline ranges in
 * chord-chart lines so two players marking different phrases of the same
 * line both have their marks survive a sync.
 */
export function unionRanges(
  a?: ReadonlyArray<readonly [number, number]>,
  b?: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (const r of [...(a ?? []), ...(b ?? [])]) {
    const key = `${r[0]},${r[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([r[0], r[1]]);
  }
  out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return out;
}
