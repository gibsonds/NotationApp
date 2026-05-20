import { describe, expect, it } from "vitest";
import {
  findDuplicateGroups,
  entryContentScore,
  type SongBankEntry,
} from "@/lib/song-bank";
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

function entry(id: string, title: string, score: Score, savedAt = 0): SongBankEntry {
  return { id, title, score, savedAt };
}

describe("findDuplicateGroups", () => {
  it("returns empty when there are no duplicates", () => {
    const songs = [
      entry("a", "Twig", bareScore()),
      entry("b", "Foggy Night", bareScore()),
    ];
    expect(findDuplicateGroups(songs)).toEqual([]);
  });

  it("groups songs by canonical title (folds case, whitespace, smart quotes)", () => {
    const songs = [
      entry("a", "Love Seeking Missiles", bareScore()),
      entry("b", "love seeking missiles", bareScore()),
      entry("c", " Love  Seeking  Missiles ", bareScore()),
      entry("d", "Twig", bareScore()),
    ];
    const groups = findDuplicateGroups(songs);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("sorts entries within a group by content richness desc (winner first)", () => {
    const rich = bareScore({
      sections: [{ id: "v", label: "V", lines: [{ chords: "| Em | Bm | C | D |", lyrics: "a lot of lyric content here" }] }],
    });
    const sparse = bareScore({ sections: [{ id: "v", label: "V", lines: [{ chords: "", lyrics: "" }] }] });
    const songs = [
      entry("a", "Same Title", sparse, 200),
      entry("b", "Same Title", rich, 100),
    ];
    const groups = findDuplicateGroups(songs);
    expect(groups).toHaveLength(1);
    // Richer entry comes first even though it's older.
    expect(groups[0].entries[0].id).toBe("b");
  });

  it("breaks content-score ties by newer savedAt", () => {
    const score = bareScore();
    const songs = [
      entry("older", "X", score, 100),
      entry("newer", "X", score, 500),
    ];
    const groups = findDuplicateGroups(songs);
    expect(groups[0].entries[0].id).toBe("newer");
  });

  it("groups are alphabetized by canonical key (stable render order)", () => {
    const songs = [
      entry("a1", "Zebra", bareScore()),
      entry("a2", "Zebra", bareScore()),
      entry("b1", "Apple", bareScore()),
      entry("b2", "Apple", bareScore()),
    ];
    const groups = findDuplicateGroups(songs);
    expect(groups.map((g) => g.canonicalKey)).toEqual(["apple", "zebra"]);
  });

  it("ignores singleton entries (no duplicates means no group)", () => {
    const songs = [
      entry("a", "Solo Song", bareScore()),
      entry("b", "Dup Song", bareScore()),
      entry("c", "Dup Song", bareScore()),
    ];
    const groups = findDuplicateGroups(songs);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.title)).toEqual(["Dup Song", "Dup Song"]);
  });
});

describe("entryContentScore", () => {
  it("counts chord + lyric characters in chord chart sections", () => {
    const e = entry(
      "x",
      "X",
      bareScore({
        sections: [
          { id: "v", label: "V", lines: [{ chords: "| C |", lyrics: "hi" }] },
        ],
      }),
    );
    // "| C |" (5) + "hi" (2) = 7
    expect(entryContentScore(e)).toBe(7);
  });

  it("counts notes × 4 in staff-notation scores", () => {
    const e = entry(
      "x",
      "X",
      bareScore({
        staves: [
          {
            id: "s1",
            name: "Staff",
            clef: "treble",
            voices: [
              {
                id: "v1",
                notes: [
                  { pitch: "C4", duration: "quarter", measure: 1, beat: 1 },
                  { pitch: "D4", duration: "quarter", measure: 1, beat: 2 },
                  { pitch: "rest", duration: "quarter", measure: 1, beat: 3 },
                ] as Score["staves"][number]["voices"][number]["notes"],
              },
            ],
          },
        ] as Score["staves"],
      }),
    );
    expect(entryContentScore(e)).toBe(12);
  });

  it("returns 0 for an empty score", () => {
    const e = entry("x", "X", bareScore());
    expect(entryContentScore(e)).toBe(0);
  });
});
