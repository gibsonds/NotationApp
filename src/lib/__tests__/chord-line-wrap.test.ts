import { describe, expect, it } from "vitest";
import { wrapChordLineAtBars } from "@/lib/chord-line-wrap";

describe("wrapChordLineAtBars — short lines (no wrap)", () => {
  it("returns a single row when chord+lyric both fit", () => {
    const out = wrapChordLineAtBars("| Em | Bm |", "I miss you", 20);
    expect(out).toEqual([
      { chords: "| Em | Bm |", lyrics: "I miss you", offset: 0 },
    ]);
  });

  it("returns a single row when both strings are empty", () => {
    const out = wrapChordLineAtBars("", "", 10);
    expect(out).toEqual([{ chords: "", lyrics: "", offset: 0 }]);
  });
});

describe("wrapChordLineAtBars — bar-boundary split (preferred)", () => {
  it("splits a long chord-only line at the rightmost `|` that fits", () => {
    // "| Em | Bm | C | D |" — 19 chars. maxChars=10 → split at last `|` ≤ 10
    // i.e., position 10 ("| C "). Row 1 = "| Em | Bm ", row 2 = "| C | D |".
    const out = wrapChordLineAtBars("| Em | Bm | C | D |", "", 10);
    expect(out).toEqual([
      { chords: "| Em | Bm ", lyrics: "", offset: 0 },
      { chords: "| C | D |", lyrics: "", offset: 10 },
    ]);
  });

  it("preserves column alignment between chord and lyric across wraps", () => {
    // The character that sat at column N in the original pair must
    // stay at column (N - row.offset) within whichever sub-row covers
    // column N. Lyric char unique IDs make this verifiable without
    // hand-computing the exact split points.
    const chords = "| Em | Bm | C | D |";
    const lyrics = "ABCDEFGHIJKLMNOPQRS"; // same length as chords, unique chars
    const out = wrapChordLineAtBars(chords, lyrics, 10);
    for (const row of out) {
      for (let k = 0; k < row.chords.length; k++) {
        expect(row.chords[k]).toBe(chords[row.offset + k]);
      }
      for (let k = 0; k < row.lyrics.length; k++) {
        expect(row.lyrics[k]).toBe(lyrics[row.offset + k]);
      }
    }
  });

  it("emits 3+ sub-rows for very long bar-lines", () => {
    // 6 bars on one line. maxChars=10 → wraps to 3 rows of 2 bars each.
    const chords = "| C | C | C | C | C | C |";
    const out = wrapChordLineAtBars(chords, "", 10);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.chords)).toEqual(["| C | C ", "| C | C ", "| C | C |"]);
    expect(out.map((r) => r.offset)).toEqual([0, 8, 16]);
  });

  it("every sub-row (except possibly the first) starts on a `|`", () => {
    const chords = "| Em | Bm | C | D | Em | Bm |";
    const out = wrapChordLineAtBars(chords, "", 12);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].chords.startsWith("|")).toBe(true);
    }
  });
});

describe("wrapChordLineAtBars — whitespace fallback (no bars in window)", () => {
  it("splits on whitespace when no `|` fits inside maxChars", () => {
    // Lyric-only line — no bars to anchor to. Falls back to space split.
    const out = wrapChordLineAtBars("", "hello world goodbye friend", 12);
    // Rightmost whitespace at column ≤ 12 in "hello world goodbye friend":
    //   h e l l o   w o r l d   g o o d b y e
    //   0 1 2 3 4 5 6 7 8 9 10 11 12
    // col 11 is a space → split at 11. Row 1 = "hello world", row 2 = " goodbye friend"
    expect(out[0].lyrics).toBe("hello world");
    expect(out[1].lyrics.startsWith(" ")).toBe(true);
    expect(out.map((r) => r.lyrics).join("")).toBe("hello world goodbye friend");
  });

  it("treats whitespace in EITHER chord or lyric as a candidate break", () => {
    // Chord has no whitespace, lyric does — the lyric's space drives the wrap.
    const out = wrapChordLineAtBars("AbCdEfGhIjKl", "abc def ghi jkl", 8);
    // Last space ≤ col 8 in lyric: col 7 (between "def" and "ghi").
    expect(out[0].chords.length).toBeLessThanOrEqual(8);
    expect(out[0].lyrics.length).toBeLessThanOrEqual(8);
  });
});

describe("wrapChordLineAtBars — hard cut (no breakable boundary)", () => {
  it("hard-cuts at maxChars when there's no `|` and no whitespace", () => {
    const out = wrapChordLineAtBars("AbCdEfGhIjKlMnOp", "AbCdEfGhIjKlMnOp", 6);
    expect(out[0].chords).toBe("AbCdEf");
    expect(out[1].chords.length).toBeLessThanOrEqual(6);
  });
});

describe("wrapChordLineAtBars — invariants", () => {
  it("rejoining all sub-rows reproduces the originals exactly", () => {
    const cases: [string, string, number][] = [
      ["| Em | Bm | C | D |", "I miss you my love today", 10],
      ["| C | F | G | Am | F | G | C |", "", 8],
      ["", "hello world goodbye friend tonight", 12],
      ["short", "lyric", 50],
      ["| Em |", "ok", 3],
    ];
    for (const [chords, lyrics, maxChars] of cases) {
      const out = wrapChordLineAtBars(chords, lyrics, maxChars);
      const rejoinedC = out.map((r) => r.chords).join("");
      const rejoinedL = out.map((r) => r.lyrics).join("");
      expect(rejoinedC).toBe(chords);
      expect(rejoinedL).toBe(lyrics);
    }
  });

  it("every sub-row fits within maxChars (or contains a single unsplittable token)", () => {
    const chords = "| C | F | G | Am | F | G | C | F |";
    const out = wrapChordLineAtBars(chords, "", 10);
    for (const row of out) {
      expect(row.chords.length).toBeLessThanOrEqual(10);
    }
  });

  it("offsets are monotonically increasing and equal cumulative sub-row lengths", () => {
    const out = wrapChordLineAtBars(
      "| Em | Bm | C | D | Em | Bm |",
      "I miss you my love today friend",
      10,
    );
    let cum = 0;
    for (const row of out) {
      expect(row.offset).toBe(cum);
      cum += Math.max(row.chords.length, row.lyrics.length);
    }
  });
});

describe("wrapChordLineAtBars — defensive inputs", () => {
  it("returns input as single row when maxChars is 0 or negative", () => {
    const out = wrapChordLineAtBars("abc", "def", 0);
    expect(out).toEqual([{ chords: "abc", lyrics: "def", offset: 0 }]);
  });
});
