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

import type { Annotation } from "./schema";

export interface AnnotationMergeStats {
  added: number;
  removed: number;
  updated: number;
}

export interface AnnotationMergeResult {
  annotations: Annotation[];
  stats: AnnotationMergeStats;
}

export function mergeAnnotations(
  base: readonly Annotation[],
  mine: readonly Annotation[],
  theirs: readonly Annotation[],
): AnnotationMergeResult {
  const stats: AnnotationMergeStats = { added: 0, removed: 0, updated: 0 };

  const baseById = new Map<string, Annotation>();
  for (const a of base) baseById.set(a.id, a);
  const mineById = new Map<string, Annotation>();
  for (const a of mine) mineById.set(a.id, a);
  const theirsById = new Map<string, Annotation>();
  for (const a of theirs) theirsById.set(a.id, a);

  const result = new Map<string, Annotation>();

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

    // Both sides have it — pick newer createdAt (treated as last-modified).
    if (m.createdAt === t.createdAt && jsonEqual(m, t)) {
      result.set(id, m);
      continue;
    }
    const winner = m.createdAt >= t.createdAt ? m : t;
    result.set(id, winner);
    if (!b || !jsonEqual(b, winner)) stats.updated++;
  }

  return {
    annotations: Array.from(result.values()),
    stats,
  };
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
