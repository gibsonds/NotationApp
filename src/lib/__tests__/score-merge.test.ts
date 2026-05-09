import { describe, it, expect } from "vitest";
import { mergeScores, chordTokens, chordSequencesEqual } from "../score-merge";
import type { Score, ChordChartSection, ChordChartLine, Annotation } from "../schema";

// ── Helpers to build test scores compactly ────────────────────────────

function emptyScore(overrides: Partial<Score> = {}): Score {
  return {
    id: "test",
    title: "Test",
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
    annotations: [],
    metadata: {},
    ...overrides,
  };
}

function section(id: string, label: string, lines: ChordChartLine[]): ChordChartSection {
  return { id, label, lines };
}

function line(chords: string, lyrics: string = ""): ChordChartLine {
  return { chords, lyrics };
}

// ── Chord-token helpers ───────────────────────────────────────────────

describe("chordTokens", () => {
  it("extracts the chord names ignoring spacing", () => {
    expect(chordTokens("D    G")).toEqual(["D", "G"]);
    expect(chordTokens("Am7  C/E  F#m")).toEqual(["Am7", "C/E", "F#m"]);
    expect(chordTokens("|D | G | A")).toEqual(["|", "D", "|", "G", "|", "A"]);
  });
});

describe("chordSequencesEqual", () => {
  it("treats different spacing as the same chord sequence", () => {
    expect(chordSequencesEqual("D    G", "D     G")).toBe(true);
    expect(chordSequencesEqual("|D| G", "|D | G")).toBe(true);
  });
  it("detects truly different chord sequences", () => {
    expect(chordSequencesEqual("D G", "D A")).toBe(false);
    expect(chordSequencesEqual("Bm Em", "D G")).toBe(false);
  });
});

// ── Section-level merge ───────────────────────────────────────────────

describe("mergeScores — disjoint section edits", () => {
  it("merges edits in different sections cleanly", () => {
    const base = emptyScore({
      sections: [
        section("v1", "Verse 1", [line("C", "hello")]),
        section("c1", "Chorus", [line("F", "world")]),
      ],
    });
    const mine = emptyScore({
      sections: [
        section("v1", "Verse 1", [line("C", "hello there")]), // edited lyric
        section("c1", "Chorus", [line("F", "world")]),
      ],
    });
    const theirs = emptyScore({
      sections: [
        section("v1", "Verse 1", [line("C", "hello")]),
        section("c1", "Chorus", [line("G", "world")]), // edited chord
      ],
    });

    const { score, conflicts } = mergeScores(base, mine, theirs);
    expect(conflicts).toHaveLength(0);
    expect(score.sections[0].lines[0].lyrics).toBe("hello there");
    expect(score.sections[1].lines[0].chords).toBe("G");
  });
});

describe("mergeScores — disjoint line edits in same section", () => {
  it("merges edits on different lines cleanly", () => {
    const base = emptyScore({
      sections: [section("v1", "Verse 1", [line("C", "a"), line("F", "b"), line("G", "c")])],
    });
    const mine = emptyScore({
      sections: [section("v1", "Verse 1", [line("C", "a-edit"), line("F", "b"), line("G", "c")])],
    });
    const theirs = emptyScore({
      sections: [section("v1", "Verse 1", [line("C", "a"), line("F", "b"), line("Am", "c")])],
    });

    const { score, conflicts } = mergeScores(base, mine, theirs);
    expect(conflicts).toHaveLength(0);
    expect(score.sections[0].lines[0].lyrics).toBe("a-edit");
    expect(score.sections[0].lines[2].chords).toBe("Am");
  });
});

describe("mergeScores — chord layout differences are NOT conflicts", () => {
  it("treats different spacing of same chords as auto-mergeable, prefers longer", () => {
    const base = emptyScore({
      sections: [section("v1", "Verse 1", [line("D G", "")])],
    });
    const mine = emptyScore({
      sections: [section("v1", "Verse 1", [line("D    G", "")])],
    });
    const theirs = emptyScore({
      sections: [section("v1", "Verse 1", [line("D     G", "")])],
    });

    const { score, conflicts } = mergeScores(base, mine, theirs);
    expect(conflicts).toHaveLength(0);
    // Longer wins
    expect(score.sections[0].lines[0].chords).toBe("D     G");
  });
});

describe("mergeScores — same-line conflicts", () => {
  it("flags real chord conflicts when sequences differ", () => {
    const base = emptyScore({
      sections: [section("v1", "Verse 1", [line("D G", "hello")])],
    });
    const mine = emptyScore({
      sections: [section("v1", "Verse 1", [line("D A", "hello")])],
    });
    const theirs = emptyScore({
      sections: [section("v1", "Verse 1", [line("Bm Em", "hello")])],
    });

    const { conflicts } = mergeScores(base, mine, theirs);
    expect(conflicts.length).toBeGreaterThan(0);
    const lineConflicts = conflicts.filter((c) => c.kind === "line");
    expect(lineConflicts).toHaveLength(1);
    if (lineConflicts[0].kind === "line") {
      expect(lineConflicts[0].field).toBe("chords");
      expect(lineConflicts[0].mine).toBe("D A");
      expect(lineConflicts[0].theirs).toBe("Bm Em");
    }
  });
});

// ── Annotations: set-union ────────────────────────────────────────────

describe("mergeScores — annotations", () => {
  it("unions annotations from both sides without conflict", () => {
    const ann = (id: string, text: string, t = 1): Annotation => ({
      id,
      anchorX: 0,
      anchorY: 0,
      text,
      color: "yellow",
      visibility: "shared",
      label: "",
      createdAt: t,
    });
    const base = emptyScore();
    const mine = emptyScore({ annotations: [ann("a", "from-me")] });
    const theirs = emptyScore({ annotations: [ann("b", "from-them")] });

    const { score, conflicts, stats } = mergeScores(base, mine, theirs);
    expect(conflicts).toHaveLength(0);
    expect(score.annotations).toHaveLength(2);
    expect(stats.annotationsAdded).toBe(2);
    const ids = score.annotations.map((a) => a.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("removes an annotation that both sides removed", () => {
    const ann = (id: string): Annotation => ({
      id,
      anchorX: 0,
      anchorY: 0,
      text: "x",
      color: "yellow",
      visibility: "shared",
      label: "",
      createdAt: 1,
    });
    const base = emptyScore({ annotations: [ann("a"), ann("b")] });
    const mine = emptyScore({ annotations: [ann("a")] });
    const theirs = emptyScore({ annotations: [ann("a")] });

    const { score, stats } = mergeScores(base, mine, theirs);
    expect(score.annotations.map((a) => a.id)).toEqual(["a"]);
    expect(stats.annotationsRemoved).toBe(1);
  });
});

// ── Score-wide fields ─────────────────────────────────────────────────

describe("mergeScores — score-wide fields", () => {
  it("auto-merges when only one side changes a field", () => {
    const base = emptyScore({ tempo: 120 });
    const mine = emptyScore({ tempo: 140 });
    const theirs = emptyScore({ tempo: 120 });

    const { score, conflicts } = mergeScores(base, mine, theirs);
    expect(conflicts).toHaveLength(0);
    expect(score.tempo).toBe(140);
  });

  it("flags a conflict when both sides change a score-wide field differently", () => {
    const base = emptyScore({ tempo: 120 });
    const mine = emptyScore({ tempo: 140 });
    const theirs = emptyScore({ tempo: 90 });

    const { conflicts } = mergeScores(base, mine, theirs);
    const fieldConflicts = conflicts.filter((c) => c.kind === "score-field");
    expect(fieldConflicts).toHaveLength(1);
    if (fieldConflicts[0].kind === "score-field") {
      expect(fieldConflicts[0].field).toBe("tempo");
    }
  });
});

// ── Section deletion ──────────────────────────────────────────────────

describe("mergeScores — section deletion", () => {
  it("flags a conflict when one side deletes and the other keeps a section", () => {
    const base = emptyScore({
      sections: [
        section("v1", "Verse 1", [line("C", "hello")]),
        section("c1", "Chorus", [line("F", "world")]),
      ],
    });
    const mine = emptyScore({
      sections: [section("v1", "Verse 1", [line("C", "hello edited")])],
      // Chorus deleted
    });
    const theirs = emptyScore({
      sections: [
        section("v1", "Verse 1", [line("C", "hello")]),
        section("c1", "Chorus", [line("F", "world")]),
      ],
    });

    const { conflicts } = mergeScores(base, mine, theirs);
    const deletions = conflicts.filter((c) => c.kind === "section-deleted");
    expect(deletions).toHaveLength(1);
    if (deletions[0].kind === "section-deleted") {
      expect(deletions[0].deletedBy).toBe("mine");
      expect(deletions[0].sectionLabel).toBe("Chorus");
    }
  });

  it("auto-resolves when both sides delete the same section", () => {
    const base = emptyScore({
      sections: [
        section("v1", "Verse 1", [line("C", "hello")]),
        section("c1", "Chorus", [line("F", "world")]),
      ],
    });
    const mine = emptyScore({
      sections: [section("v1", "Verse 1", [line("C", "hello")])],
    });
    const theirs = emptyScore({
      sections: [section("v1", "Verse 1", [line("C", "hello")])],
    });

    const { score, conflicts, stats } = mergeScores(base, mine, theirs);
    expect(conflicts).toHaveLength(0);
    expect(score.sections).toHaveLength(1);
    expect(stats.sectionsRemoved).toBe(1);
  });
});

// ── The Star to Star regression scenario ──────────────────────────────

describe("mergeScores — Star to Star regression scenario", () => {
  it("recovers chord additions from a stale tab fight (additive merge)", () => {
    // Base: 1 section, minimal chords.
    const base = emptyScore({
      sections: [section("v1", "Verse 1", [line("D G", "line one"), line("A D", "line two")])],
    });
    // Mine: added more chord layout (the user's recent work that got
    // clobbered by another tab).
    const mine = emptyScore({
      sections: [section("v1", "Verse 1", [line("D       G", "line one"), line("A     D", "line two")])],
    });
    // Theirs: stale tab pushing back an even older state.
    const theirs = base;

    const { score, conflicts } = mergeScores(base, mine, theirs);
    expect(conflicts).toHaveLength(0);
    expect(score.sections[0].lines[0].chords).toBe("D       G");
    expect(score.sections[0].lines[1].chords).toBe("A     D");
  });
});
