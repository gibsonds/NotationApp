import { describe, expect, it } from "vitest";
import type { Score } from "@/lib/schema";
import { computeConflictDiff, describeDelta } from "../conflict-diff";

// Minimal Score factory for the conflict-diff helper. The helper only
// inspects `sections[].label` and `sections[].lines[].{chords,lyrics}`,
// so we leave the rest off — TypeScript's structural compat handles it.
function score(
  sections: Array<{ label: string; lines: Array<{ chords?: string; lyrics?: string }> }>,
): Score {
  return { sections } as unknown as Score;
}

describe("computeConflictDiff", () => {
  it("returns identical for two scores with no section differences", () => {
    const s = score([
      { label: "Verse 1", lines: [{ chords: "G | D", lyrics: "hello world" }] },
    ]);
    const out = computeConflictDiff(s, s);
    expect(out.identical).toBe(true);
    expect(out.deltas).toEqual([]);
  });

  it("flags a section that only exists in mine", () => {
    const mine = score([
      { label: "Verse 1", lines: [] },
      { label: "Bridge", lines: [{ chords: "Am", lyrics: "" }] },
    ]);
    const theirs = score([{ label: "Verse 1", lines: [] }]);
    const out = computeConflictDiff(mine, theirs);
    expect(out.deltas).toEqual([{ kind: "only-mine", label: "Bridge" }]);
  });

  it("flags a section that only exists in theirs", () => {
    const mine = score([{ label: "Verse 1", lines: [] }]);
    const theirs = score([
      { label: "Verse 1", lines: [] },
      { label: "Outro", lines: [{ chords: "G", lyrics: "fin" }] },
    ]);
    const out = computeConflictDiff(mine, theirs);
    expect(out.deltas).toEqual([{ kind: "only-theirs", label: "Outro" }]);
  });

  it("identifies per-line differences inside a matched section", () => {
    const mine = score([
      {
        label: "Verse 1",
        lines: [
          { chords: "G", lyrics: "line A" },
          { chords: "D", lyrics: "line B" },
          { chords: "Em", lyrics: "line C" },
        ],
      },
    ]);
    const theirs = score([
      {
        label: "Verse 1",
        lines: [
          { chords: "G", lyrics: "line A" },          // same
          { chords: "D7", lyrics: "line B" },         // chord differs
          { chords: "Em", lyrics: "line C changed" }, // lyric differs
        ],
      },
    ]);
    const out = computeConflictDiff(mine, theirs);
    expect(out.deltas).toEqual([
      { kind: "lines-differ", label: "Verse 1", changedLines: [1, 2] },
    ]);
  });

  it("treats extra lines in one side as a difference at that index", () => {
    const mine = score([
      { label: "Chorus", lines: [{ chords: "C", lyrics: "" }] },
    ]);
    const theirs = score([
      {
        label: "Chorus",
        lines: [
          { chords: "C", lyrics: "" },
          { chords: "G", lyrics: "" }, // extra line on their side
        ],
      },
    ]);
    const out = computeConflictDiff(mine, theirs);
    expect(out.deltas).toEqual([
      { kind: "lines-differ", label: "Chorus", changedLines: [1] },
    ]);
  });

  it("combines section adds/removes/changes in one report, in stable order", () => {
    const mine = score([
      { label: "Verse 1", lines: [{ chords: "G", lyrics: "a" }] },
      { label: "Chorus", lines: [{ chords: "C", lyrics: "b" }] },
      { label: "Bridge", lines: [] }, // only-mine
    ]);
    const theirs = score([
      { label: "Verse 1", lines: [{ chords: "G", lyrics: "a" }] }, // identical
      { label: "Chorus", lines: [{ chords: "F", lyrics: "b" }] }, // chord differs
      { label: "Outro", lines: [] }, // only-theirs
    ]);
    const out = computeConflictDiff(mine, theirs);
    expect(out.deltas).toEqual([
      { kind: "lines-differ", label: "Chorus", changedLines: [0] },
      { kind: "only-mine", label: "Bridge" },
      { kind: "only-theirs", label: "Outro" },
    ]);
  });

  it("handles empty / missing sections arrays", () => {
    const empty: Score = {} as Score;
    const populated = score([{ label: "Verse 1", lines: [] }]);
    expect(computeConflictDiff(empty, empty).identical).toBe(true);
    expect(computeConflictDiff(empty, populated).deltas).toEqual([
      { kind: "only-theirs", label: "Verse 1" },
    ]);
  });
});

describe("describeDelta", () => {
  it("renders only-mine", () => {
    expect(describeDelta({ kind: "only-mine", label: "Bridge" })).toBe(
      "Bridge — only in your version",
    );
  });
  it("renders only-theirs", () => {
    expect(describeDelta({ kind: "only-theirs", label: "Outro" })).toBe(
      "Outro — only in their version",
    );
  });
  it("renders lines-differ with singular/plural", () => {
    expect(
      describeDelta({ kind: "lines-differ", label: "V1", changedLines: [0] }),
    ).toBe("V1 — 1 line changed");
    expect(
      describeDelta({ kind: "lines-differ", label: "V1", changedLines: [0, 2, 3] }),
    ).toBe("V1 — 3 lines changed");
  });
});
