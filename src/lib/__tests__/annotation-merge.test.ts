import { describe, it, expect } from "vitest";
import { mergeAnnotations, unionRanges } from "../annotation-merge";
import type { Annotation } from "../schema";

const ann = (
  id: string,
  text: string = "x",
  createdAt: number = 1,
): Annotation => ({
  id,
  anchorX: 0,
  anchorY: 0,
  text,
  color: "yellow",
  visibility: "shared",
  label: "",
  createdAt,
});

describe("mergeAnnotations — adds union", () => {
  it("keeps adds from both sides", () => {
    const result = mergeAnnotations(
      [],
      [ann("a"), ann("b")],
      [ann("c")],
    );
    expect(result.annotations.map((a) => a.id).sort()).toEqual(["a", "b", "c"]);
    expect(result.stats.added).toBe(3);
  });

  it("counts adds against base, not against the other side", () => {
    const result = mergeAnnotations(
      [ann("base1")],
      [ann("base1"), ann("a")], // mine added 'a'
      [ann("base1"), ann("b")], // theirs added 'b'
    );
    expect(result.annotations.map((a) => a.id).sort()).toEqual(["a", "b", "base1"]);
    expect(result.stats.added).toBe(2);
  });
});

describe("mergeAnnotations — removes", () => {
  it("removes when both sides removed", () => {
    const base = [ann("a"), ann("b")];
    const result = mergeAnnotations(base, [ann("a")], [ann("a")]);
    expect(result.annotations.map((x) => x.id)).toEqual(["a"]);
    expect(result.stats.removed).toBe(1);
  });

  it("keeps when only one side removed (resurrect-on-conflict)", () => {
    const base = [ann("a"), ann("b")];
    const result = mergeAnnotations(base, [ann("a")], base);
    expect(result.annotations.map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(result.stats.removed).toBe(0);
  });
});

describe("mergeAnnotations — concurrent edits", () => {
  it("picks newer createdAt as last-modified winner", () => {
    const result = mergeAnnotations(
      [ann("a", "old", 1)],
      [ann("a", "mine-new", 5)],
      [ann("a", "theirs-new", 10)],
    );
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].text).toBe("theirs-new");
    expect(result.stats.updated).toBe(1);
  });

  it("doesn't count as updated when winner equals base", () => {
    const result = mergeAnnotations(
      [ann("a", "x", 1)],
      [ann("a", "x", 1)],
      [ann("a", "x", 1)],
    );
    expect(result.stats.updated).toBe(0);
  });
});

describe("unionRanges", () => {
  it("dedupes exact matches", () => {
    expect(unionRanges([[0, 5], [5, 10]], [[5, 10], [10, 15]])).toEqual([
      [0, 5],
      [5, 10],
      [10, 15],
    ]);
  });

  it("sorts by start, then end", () => {
    expect(unionRanges([[5, 10]], [[0, 3], [7, 9]])).toEqual([
      [0, 3],
      [5, 10],
      [7, 9],
    ]);
  });

  it("handles empty inputs", () => {
    expect(unionRanges()).toEqual([]);
    expect(unionRanges([], [])).toEqual([]);
    expect(unionRanges([[0, 5]], undefined)).toEqual([[0, 5]]);
  });
});
