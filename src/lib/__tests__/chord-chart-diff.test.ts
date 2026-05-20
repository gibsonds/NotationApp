import { describe, expect, it } from "vitest";
import {
  diffClassifyRows,
  chordChartLines,
  planCompareRows,
} from "@/lib/chord-chart-diff";
import type { SongBankEntry } from "@/lib/song-bank";
import type { Score } from "@/lib/schema";

function bareScore(extra: Partial<Score> = {}): Score {
  return {
    id: "s",
    title: "T",
    composer: "",
    tempo: 120,
    timeSignature: "4/4",
    keySignature: "C",
    measures: 4,
    anacrusis: false,
    staves: [],
    chordSymbols: [],
    rehearsalMarks: [],
    repeats: [],
    measureChanges: [],
    sections: [],
    form: [],
    metadata: {},
    annotations: [],
    ...extra,
  };
}

function entry(id: string, sections: Score["sections"]): SongBankEntry {
  return { id, title: "T", score: bareScore({ sections }), savedAt: 0 };
}

describe("diffClassifyRows", () => {
  it("returns [] for an empty input", () => {
    expect(diffClassifyRows([])).toEqual([]);
  });

  it("marks every position as same when entries are identical", () => {
    const rows = [
      ["a", "b", "c"],
      ["a", "b", "c"],
    ];
    expect(diffClassifyRows(rows)).toEqual(["same", "same", "same"]);
  });

  it("marks a position as diff when entries disagree there", () => {
    const rows = [
      ["a", "b", "c"],
      ["a", "X", "c"],
    ];
    expect(diffClassifyRows(rows)).toEqual(["same", "diff", "same"]);
  });

  it("marks trailing positions diff when an entry is shorter", () => {
    const rows = [
      ["a", "b", "c"],
      ["a", "b"],
    ];
    expect(diffClassifyRows(rows)).toEqual(["same", "same", "diff"]);
  });

  it("requires every entry to agree (any disagreement → diff)", () => {
    const rows = [
      ["a", "b"],
      ["a", "X"],
      ["a", "Y"],
    ];
    expect(diffClassifyRows(rows)).toEqual(["same", "diff"]);
  });
});

describe("chordChartLines", () => {
  it("returns a placeholder row for staff-notation-only scores", () => {
    const e = entry("x", []);
    expect(chordChartLines(e)).toEqual(["(no chord chart content)"]);
  });

  it("emits section headers, chord rows, lyric rows, and a between-section blank", () => {
    const e = entry("x", [
      { id: "v", label: "Verse", lines: [{ chords: "| C |", lyrics: "hi" }] },
      { id: "c", label: "Chorus", lines: [{ chords: "| G |", lyrics: "" }] },
    ]);
    expect(chordChartLines(e)).toEqual([
      "[Verse]",
      "| C |",
      "hi",
      "",
      "[Chorus]",
      "| G |",
    ]);
  });

  it("emits a blank row when a line has neither chords nor lyrics", () => {
    const e = entry("x", [
      { id: "v", label: "V", lines: [{ chords: "", lyrics: "" }] },
    ]);
    expect(chordChartLines(e)).toEqual(["[V]", ""]);
  });

  it("trims trailing blanks so entries don't share dead-tail rows", () => {
    const e = entry("x", [
      { id: "v", label: "V", lines: [{ chords: "| C |", lyrics: "" }] },
    ]);
    // After the section we'd otherwise push a "" — make sure it's trimmed.
    const out = chordChartLines(e);
    expect(out[out.length - 1]).not.toBe("");
  });
});

describe("planCompareRows", () => {
  it("returns every row index when showOnlyDiffs is false", () => {
    const plan = planCompareRows(["same", "diff", "same", "same", "diff"], false);
    expect(plan).toEqual([
      { kind: "row", index: 0 },
      { kind: "row", index: 1 },
      { kind: "row", index: 2 },
      { kind: "row", index: 3 },
      { kind: "row", index: 4 },
    ]);
  });

  it("collapses runs of same rows into a gap when showOnlyDiffs is true", () => {
    const plan = planCompareRows(
      ["same", "same", "diff", "same", "same", "same", "diff", "same"],
      true,
      // collapseThreshold default = 1 (collapse any run of consecutive same rows)
    );
    expect(plan).toEqual([
      { kind: "gap", count: 2 },
      { kind: "row", index: 2 },
      { kind: "gap", count: 3 },
      { kind: "row", index: 6 },
      { kind: "gap", count: 1 },
    ]);
  });

  it("keeps short runs of same rows inline when below the collapse threshold", () => {
    // threshold=3: runs shorter than 3 stay inline; longer runs collapse
    const plan = planCompareRows(
      ["same", "same", "diff", "same", "same", "same", "same", "diff"],
      true,
      3,
    );
    // Leading run length 2 < 3 → kept inline as two row entries.
    // Then "diff" at 2.
    // Middle run length 4 ≥ 3 → collapsed.
    // Then "diff" at 7.
    expect(plan).toEqual([
      { kind: "row", index: 0 },
      { kind: "row", index: 1 },
      { kind: "row", index: 2 },
      { kind: "gap", count: 4 },
      { kind: "row", index: 7 },
    ]);
  });

  it("emits no slots when all rows are same and showOnlyDiffs is on (threshold 1)", () => {
    const plan = planCompareRows(["same", "same", "same"], true, 1);
    expect(plan).toEqual([{ kind: "gap", count: 3 }]);
  });
});
