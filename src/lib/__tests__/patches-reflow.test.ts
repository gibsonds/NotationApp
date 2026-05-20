import { describe, expect, it } from "vitest";
import { applyPatch } from "@/lib/patches";
import type { Score } from "@/lib/schema";

// Minimum-fields fixture — applyPatch only reaches into score.sections
// for the reflow_section path, but the score still needs the full
// shape so type-checks line up.
function fixtureScore(sections: Score["sections"]): Score {
  return {
    id: "s1",
    title: "Test",
    composer: "",
    tempo: 120,
    timeSignature: "4/4",
    keySignature: "C",
    measures: 8,
    anacrusis: false,
    staves: [],
    chordSymbols: [],
    rehearsalMarks: [],
    repeats: [],
    measureChanges: [],
    sections,
    form: [],
    metadata: {},
    annotations: [],
  };
}

describe("applyPatch: reflow_section", () => {
  it("leaves the target section's other fields alone (only `lines` changes)", () => {
    const score = fixtureScore([
      {
        id: "v",
        label: "Verse",
        lines: [{ chords: "| Em | Bm | C | D | E | F |", lyrics: "" }],
      },
    ]);
    const out = applyPatch(score, { op: "reflow_section", sectionId: "v", barsPerLine: 2 });
    expect(out.sections[0].id).toBe("v");
    expect(out.sections[0].label).toBe("Verse");
    expect(out.sections[0].lines).toHaveLength(3);
  });

  it("only touches the named section — others pass through untouched", () => {
    const score = fixtureScore([
      {
        id: "a",
        label: "Section A",
        lines: [{ chords: "| Em | Bm | C | D | E | F |", lyrics: "" }],
      },
      {
        id: "b",
        label: "Section B",
        lines: [{ chords: "| Em | Bm | C | D | E | F |", lyrics: "" }],
      },
    ]);
    const out = applyPatch(score, { op: "reflow_section", sectionId: "a", barsPerLine: 2 });
    expect(out.sections[0].lines).toHaveLength(3); // reflowed
    expect(out.sections[1].lines).toHaveLength(1); // untouched
    expect(out.sections[1].lines[0].chords).toBe("| Em | Bm | C | D | E | F |");
  });

  it("is a no-op when no section matches the id", () => {
    const score = fixtureScore([
      { id: "v", label: "Verse", lines: [{ chords: "| Em | Bm |", lyrics: "" }] },
    ]);
    const out = applyPatch(score, { op: "reflow_section", sectionId: "missing", barsPerLine: 1 });
    expect(out.sections).toEqual(score.sections);
  });

  it("idempotent: reflowing the same section with the same barsPerLine twice equals once", () => {
    const score = fixtureScore([
      {
        id: "v",
        label: "Verse",
        lines: [{ chords: "| Em | Bm | C | D | E | F | G | A |", lyrics: "" }],
      },
    ]);
    const once = applyPatch(score, { op: "reflow_section", sectionId: "v", barsPerLine: 4 });
    const twice = applyPatch(once, { op: "reflow_section", sectionId: "v", barsPerLine: 4 });
    expect(twice.sections[0].lines).toEqual(once.sections[0].lines);
  });

  it("drops highlight/underline ranges on reflowed lines (v1 documented limitation)", () => {
    const score = fixtureScore([
      {
        id: "v",
        label: "Verse",
        lines: [
          {
            chords: "| Em | Bm | C | D | E | F |",
            lyrics: "abc def ghi jkl mno pqr stu",
            highlightRanges: [[0, 3]] as [number, number][],
            underlineRanges: [[4, 7]] as [number, number][],
          },
        ],
      },
    ]);
    const out = applyPatch(score, { op: "reflow_section", sectionId: "v", barsPerLine: 2 });
    for (const line of out.sections[0].lines) {
      expect(line.highlightRanges).toBeUndefined();
      expect(line.underlineRanges).toBeUndefined();
    }
  });

  it("leaves lyric-only / no-bar lines unchanged", () => {
    const score = fixtureScore([
      {
        id: "v",
        label: "Verse",
        lines: [
          { chords: "", lyrics: "this is a lyric-only line" },
          { chords: "Em Bm C", lyrics: "no bars here" },
          { chords: "| Em | Bm | C | D | E | F |", lyrics: "" },
        ],
      },
    ]);
    const out = applyPatch(score, { op: "reflow_section", sectionId: "v", barsPerLine: 2 });
    // First two pass through; third splits into 3.
    expect(out.sections[0].lines).toHaveLength(2 + 3);
    expect(out.sections[0].lines[0].lyrics).toBe("this is a lyric-only line");
    expect(out.sections[0].lines[1].chords).toBe("Em Bm C");
  });

  it("preserves total bar content across the split", () => {
    const score = fixtureScore([
      {
        id: "v",
        label: "Verse",
        lines: [{ chords: "| C | F | G | Am | F | G | C | F |", lyrics: "" }],
      },
    ]);
    const out = applyPatch(score, { op: "reflow_section", sectionId: "v", barsPerLine: 4 });
    // Two output lines × 4 bars each = 8 bars total (matches original).
    expect(out.sections[0].lines).toHaveLength(2);
    for (const line of out.sections[0].lines) {
      const pipeCount = (line.chords?.match(/\|/g) ?? []).length;
      // Each new 4-bar line should have 5 pipes (one per bar boundary).
      expect(pipeCount).toBe(5);
    }
  });
});
