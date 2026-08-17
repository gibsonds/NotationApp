import { describe, expect, it } from "vitest";
import { applyPatch } from "@/lib/patches";
import type { Riff, Score } from "@/lib/schema";

function fixtureScore(over: Partial<Score> = {}): Score {
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
    sections: [
      {
        id: "v",
        label: "Verse",
        lines: [
          { chords: "| Am |", lyrics: "line zero" },
          { chords: "| F |", lyrics: "line one" },
          { chords: "| C |", lyrics: "line two" },
        ],
      },
    ],
    form: [],
    metadata: {},
    annotations: [],
    ...over,
  };
}

function riff(over: Partial<Riff> = {}): Riff {
  return {
    id: "r1",
    label: "Intro riff",
    kind: "tab",
    tuning: ["E4", "B3", "G3", "D3", "A2", "E2"],
    anchor: { sectionId: "v", lineIdx: 1 },
    bars: [{ events: [{ beat: 1, duration: "quarter", dots: 0, notes: [{ string: 6, fret: 3 }] }] }],
    visibility: "shared",
    source: "ascii",
    createdAt: 100,
    ...over,
  };
}

describe("applyPatch — riff CRUD", () => {
  it("adds a riff", () => {
    const out = applyPatch(fixtureScore(), { op: "add_riff", riff: riff() });
    expect(out.riffs).toHaveLength(1);
    expect(out.riffs![0].label).toBe("Intro riff");
  });

  it("updates a riff and stamps the caller's updatedAt", () => {
    const score = fixtureScore({ riffs: [riff()] });
    const out = applyPatch(score, {
      op: "update_riff",
      id: "r1",
      updates: { label: "Solo lick" },
      updatedAt: 999,
    });
    expect(out.riffs![0].label).toBe("Solo lick");
    expect(out.riffs![0].updatedAt).toBe(999);
  });

  it("keeps applyPatch pure — no updatedAt invented when the caller omits it", () => {
    // applyPatch is replayed by undo/redo, so a Date.now() inside it would
    // make replay non-deterministic.
    const score = fixtureScore({ riffs: [riff({ updatedAt: 5 })] });
    const out = applyPatch(score, { op: "update_riff", id: "r1", updates: { label: "x" } });
    expect(out.riffs![0].updatedAt).toBe(5);
  });

  it("removes a riff", () => {
    const score = fixtureScore({ riffs: [riff(), riff({ id: "r2" })] });
    const out = applyPatch(score, { op: "remove_riff", id: "r1" });
    expect(out.riffs!.map((r) => r.id)).toEqual(["r2"]);
  });

  it("is a no-op for an unknown id", () => {
    const score = fixtureScore({ riffs: [riff()] });
    expect(applyPatch(score, { op: "remove_riff", id: "nope" }).riffs).toHaveLength(1);
    expect(
      applyPatch(score, { op: "update_riff", id: "nope", updates: { label: "x" } }).riffs![0].label,
    ).toBe("Intro riff");
  });

  it("leaves the rest of the score alone", () => {
    const out = applyPatch(fixtureScore(), { op: "add_riff", riff: riff() });
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].lines).toHaveLength(3);
    expect(out.title).toBe("Test");
  });
});

describe("applyPatch — add_riff_from_ascii", () => {
  const ascii = ["e|--3--5--|", "B|--------|"].join("\n");

  it("parses tab into a riff through the shared parser", () => {
    const out = applyPatch(fixtureScore(), {
      op: "add_riff_from_ascii",
      riff: { id: "r9", label: "Lick", anchor: { sectionId: "v", lineIdx: 0 }, createdAt: 7 },
      ascii,
    });
    expect(out.riffs).toHaveLength(1);
    const r = out.riffs![0];
    expect(r.id).toBe("r9");
    expect(r.source).toBe("ascii");
    expect(r.createdAt).toBe(7);
    expect(r.bars[0].events.flatMap((e) => e.notes.map((n) => n.fret))).toEqual([3, 5]);
  });

  it("is deterministic — same input, same riff", () => {
    const patch = {
      op: "add_riff_from_ascii" as const,
      riff: { id: "r9", label: "Lick", anchor: { sectionId: "v", lineIdx: 0 }, createdAt: 7 },
      ascii,
    };
    const a = applyPatch(fixtureScore(), patch);
    const b = applyPatch(fixtureScore(), patch);
    expect(JSON.stringify(a.riffs)).toBe(JSON.stringify(b.riffs));
  });

  it("no-ops when the text contains no readable tab", () => {
    const out = applyPatch(fixtureScore(), {
      op: "add_riff_from_ascii",
      riff: { id: "r9", label: "Lick", anchor: { sectionId: "v", lineIdx: 0 } },
      ascii: "how does that go again",
    });
    expect(out.riffs ?? []).toHaveLength(0);
  });
});

// A riff anchors on { sectionId, lineIdx }. That survives reflowed text and
// font changes, but NOT inserting/deleting lines — so every structural op has
// to move the anchors with the lines.
describe("riff anchors survive structural edits", () => {
  const anchoredAt = (lineIdx: number, sectionId = "v") =>
    fixtureScore({ riffs: [riff({ anchor: { sectionId, lineIdx } })] });

  it("shifts down when a line is inserted above", () => {
    const out = applyPatch(anchoredAt(1), {
      op: "add_section_line",
      sectionId: "v",
      index: 0,
      line: { chords: "", lyrics: "new" },
    });
    expect(out.riffs![0].anchor.lineIdx).toBe(2);
  });

  it("stays put when a line is inserted below", () => {
    const out = applyPatch(anchoredAt(1), {
      op: "add_section_line",
      sectionId: "v",
      index: 2,
      line: { chords: "", lyrics: "new" },
    });
    expect(out.riffs![0].anchor.lineIdx).toBe(1);
  });

  it("shifts up when a line above is removed", () => {
    const out = applyPatch(anchoredAt(2), {
      op: "remove_section_line",
      sectionId: "v",
      lineIdx: 0,
    });
    expect(out.riffs![0].anchor.lineIdx).toBe(1);
  });

  it("clamps rather than pointing off the end when its own line is removed", () => {
    const out = applyPatch(anchoredAt(2), {
      op: "remove_section_line",
      sectionId: "v",
      lineIdx: 2,
    });
    // Two lines remain, so the last valid index is 1.
    expect(out.riffs![0].anchor.lineIdx).toBe(1);
  });

  it("follows its lines into the new section on a split", () => {
    const out = applyPatch(anchoredAt(2), {
      op: "split_section",
      sectionId: "v",
      atLineIdx: 1,
      newSection: { id: "v2", label: "Verse 2" },
    });
    expect(out.riffs![0].anchor.sectionId).toBe("v2");
    expect(out.riffs![0].anchor.lineIdx).toBe(1); // 2 - 1
  });

  it("stays in the original section when it sits above the split", () => {
    const out = applyPatch(anchoredAt(0), {
      op: "split_section",
      sectionId: "v",
      atLineIdx: 1,
      newSection: { id: "v2", label: "Verse 2" },
    });
    expect(out.riffs![0].anchor.sectionId).toBe("v");
    expect(out.riffs![0].anchor.lineIdx).toBe(0);
  });

  it("is orphaned, not destroyed, when its section is deleted", () => {
    const out = applyPatch(anchoredAt(1), { op: "remove_section", sectionId: "v" });
    expect(out.riffs).toHaveLength(1);
    expect(out.riffs![0].anchor.sectionId).toBeNull();
  });

  it("lands on the first row of its line after a reflow splits it", () => {
    const score = fixtureScore({
      sections: [
        {
          id: "v",
          label: "Verse",
          lines: [
            { chords: "| Em | Bm | C | D |", lyrics: "" },
            { chords: "| F | G |", lyrics: "" },
          ],
        },
      ],
      riffs: [riff({ anchor: { sectionId: "v", lineIdx: 1 } })],
    });
    const out = applyPatch(score, { op: "reflow_section", sectionId: "v", barsPerLine: 2 });
    // Line 0 became two rows, so line 1 now starts at row 2.
    expect(out.sections[0].lines.length).toBeGreaterThan(2);
    expect(out.riffs![0].anchor.lineIdx).toBe(2);
  });

  it("ignores riffs anchored to a different section", () => {
    const out = applyPatch(anchoredAt(1, "other"), {
      op: "remove_section_line",
      sectionId: "v",
      lineIdx: 0,
    });
    expect(out.riffs![0].anchor.lineIdx).toBe(1);
  });
});

describe("replace_score preserves riffs", () => {
  it("carries riffs across an AI rewrite", () => {
    // expandIntentToScore builds a fresh score with no riff field, so without
    // explicit preservation an AI "rewrite the song" would destroy them — the
    // way it already destroys annotations.
    const score = fixtureScore({ riffs: [riff()] });
    const out = applyPatch(score, {
      op: "replace_score",
      score: { title: "Rewritten", sections: [{ id: "a", label: "A", lines: [] }] },
    });
    expect(out.title).toBe("Rewritten");
    expect(out.riffs).toHaveLength(1);
    expect(out.riffs![0].id).toBe("r1");
  });
});
