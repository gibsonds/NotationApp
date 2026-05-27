import { describe, expect, it } from "vitest";
import type { Score } from "@/lib/schema";
import {
  computeBarInventory,
  beatsPerBarOf,
  activeBarFromElapsed,
} from "@/lib/chord-bar-inventory";

// Minimal Score factory — only the fields chord-bar-inventory looks at.
function score(
  sections: Array<{ id: string; label?: string; lines: Array<{ chords?: string; lyrics?: string }> }>,
): Score {
  return { sections } as unknown as Score;
}

describe("computeBarInventory", () => {
  it("returns empty for a score with no sections", () => {
    expect(computeBarInventory({} as Score)).toEqual([]);
  });

  it("counts N-1 bars for a line with N pipes", () => {
    // "| C | F | G |" → 4 pipes → 3 bars
    const s = score([
      { id: "v", lines: [{ chords: "| C | F | G |" }] },
    ]);
    const inv = computeBarInventory(s);
    expect(inv).toHaveLength(3);
    expect(inv.map((b) => [b.startCol, b.endCol])).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
    ]);
  });

  it("contributes zero bars for a line with no pipes (no bar markers)", () => {
    // Without any | the parser has no anchors — fall back to constant
    // tempo-scaled scroll. User must add | markers to enable bar
    // tracking on a chord line.
    const s = score([
      { id: "v", lines: [{ chords: "G D Em C" }] },
    ]);
    expect(computeBarInventory(s)).toEqual([]);
  });

  it("counts 'Am | C' as 2 bars (implicit leading + trailing)", () => {
    // Both sides have chord content outside the single pipe — both
    // edges become bars. Was 0 under the old strict-pipe-bracketed
    // model; now correctly 2.
    const s = score([
      { id: "v", lines: [{ chords: "Am | C" }] },
    ]);
    const inv = computeBarInventory(s);
    expect(inv).toHaveLength(2);
    expect(inv.map((b) => [b.startCol, b.endCol])).toEqual([
      [0, 3],  // Am
      [3, 6],  // | C
    ]);
  });

  it("preserves section + line ordering across the song", () => {
    const s = score([
      { id: "v", lines: [{ chords: "| C |" }] },           // 1 bar  (global 0)
      { id: "c", lines: [
        { chords: "| F | G |" },                            // 2 bars (global 1, 2)
        { chords: "| C |" },                                // 1 bar  (global 3)
      ] },
    ]);
    const inv = computeBarInventory(s);
    expect(inv.map((b) => [b.globalIdx, b.sectionIdx, b.lineIdx])).toEqual([
      [0, 0, 0],
      [1, 1, 0],
      [2, 1, 0],
      [3, 1, 1],
    ]);
  });

  it("treats || as a real bar that carries forward the previous chord", () => {
    // `||` is "same chord as the previous bar" — a real bar that
    // consumes time, just visually compact. We MUST keep it in the
    // inventory so playhead beat-counting stays correct; dropping
    // it would silently shorten the song by N×beatsPerBar beats
    // for every `||` and the highlight would lag the music.
    //
    // "| C || F |" → 4 pipes → 3 bars:
    //   bar 0: | C   (cols 0-4)
    //   bar 1: |     (cols 4-5)  the implied-C
    //   bar 2: | F   (cols 5-9)
    const s = score([{ id: "v", lines: [{ chords: "| C || F |" }] }]);
    const inv = computeBarInventory(s);
    expect(inv).toHaveLength(3);
    expect(inv.map((b) => [b.startCol, b.endCol])).toEqual([
      [0, 4],
      [4, 5],
      [5, 9],
    ]);
  });

  it("counts a leading chord without a leading | as a real bar", () => {
    // "Em | Bm | C |" — Em is a bar even though no | precedes it.
    // Previously counted as 2 bars (Bm, C); should be 3 (Em, Bm, C).
    const s = score([{ id: "v", lines: [{ chords: "Em | Bm | C |" }] }]);
    const inv = computeBarInventory(s);
    expect(inv).toHaveLength(3);
    expect(inv.map((b) => [b.startCol, b.endCol])).toEqual([
      [0, 3],   // Em (implicit start to first |)
      [3, 8],   // | Bm
      [8, 12],  // | C
    ]);
  });

  it("counts a trailing chord without a trailing | as a real bar", () => {
    // "| C | F | G" — G is a bar even though no | follows it.
    // Previously counted as 2 (C, F); should be 3 (C, F, G).
    const s = score([{ id: "v", lines: [{ chords: "| C | F | G" }] }]);
    const inv = computeBarInventory(s);
    expect(inv).toHaveLength(3);
    expect(inv.map((b) => [b.startCol, b.endCol])).toEqual([
      [0, 4],   // | C
      [4, 8],   // | F
      [8, 11],  // | G (implicit end after last non-space char)
    ]);
  });

  it("counts both leading and trailing implicit bars in the same line", () => {
    const s = score([{ id: "v", lines: [{ chords: "Em | Bm | C" }] }]);
    const inv = computeBarInventory(s);
    expect(inv).toHaveLength(3);
    expect(inv.map((b) => [b.startCol, b.endCol])).toEqual([
      [0, 3],   // Em
      [3, 8],   // | Bm
      [8, 11],  // | C
    ]);
  });

  it("ignores trailing whitespace when computing the trailing-content boundary", () => {
    // "| C | F | G   " — the `G` is a bar; trailing spaces don't extend it.
    const s = score([{ id: "v", lines: [{ chords: "| C | F | G   " }] }]);
    const inv = computeBarInventory(s);
    expect(inv).toHaveLength(3);
    expect(inv[2]).toMatchObject({ startCol: 8, endCol: 11 });
  });

  it("tolerates pipes at non-zero starting columns", () => {
    // "G   | C | F |" — the leading G is a real bar (3 bars: G, C, F).
    const s = score([
      { id: "v", lines: [{ chords: "G   | C | F |" }] },
    ]);
    const inv = computeBarInventory(s);
    expect(inv).toHaveLength(3);
    expect(inv.map((b) => [b.startCol, b.endCol])).toEqual([
      [0, 4],   // G (implicit)
      [4, 8],   // | C
      [8, 12],  // | F
    ]);
  });
});

describe("beatsPerBarOf", () => {
  it("returns the numerator of a standard time signature", () => {
    expect(beatsPerBarOf("4/4")).toBe(4);
    expect(beatsPerBarOf("3/4")).toBe(3);
    expect(beatsPerBarOf("6/8")).toBe(6);
    expect(beatsPerBarOf("12/8")).toBe(12);
  });
  it("falls back to 4 for missing / malformed values", () => {
    expect(beatsPerBarOf(undefined)).toBe(4);
    expect(beatsPerBarOf(null)).toBe(4);
    expect(beatsPerBarOf("")).toBe(4);
    expect(beatsPerBarOf("garbage")).toBe(4);
    expect(beatsPerBarOf("0/4")).toBe(4);
  });
});

describe("activeBarFromElapsed", () => {
  const inv = [
    { globalIdx: 0, sectionIdx: 0, sectionId: "v", lineIdx: 0, startCol: 0, endCol: 4 },
    { globalIdx: 1, sectionIdx: 0, sectionId: "v", lineIdx: 0, startCol: 4, endCol: 8 },
    { globalIdx: 2, sectionIdx: 0, sectionId: "v", lineIdx: 0, startCol: 8, endCol: 12 },
  ];

  it("returns 0 at t=0", () => {
    expect(activeBarFromElapsed(inv, 0, 120, 4)).toBe(0);
  });

  it("advances by one bar every beatsPerBar / (tempo/60) seconds", () => {
    // At 120 BPM, 4 beats per bar → 2 seconds per bar.
    expect(activeBarFromElapsed(inv, 1.99, 120, 4)).toBe(0);
    expect(activeBarFromElapsed(inv, 2.0, 120, 4)).toBe(1);
    expect(activeBarFromElapsed(inv, 4.0, 120, 4)).toBe(2);
  });

  it("returns null when elapsed runs past the end of the inventory", () => {
    // 3 bars × 2 s/bar = 6 s total at 120 BPM 4/4.
    expect(activeBarFromElapsed(inv, 6.0, 120, 4)).toBeNull();
    expect(activeBarFromElapsed(inv, 10.0, 120, 4)).toBeNull();
  });

  it("returns null when inventory is empty or tempo is zero", () => {
    expect(activeBarFromElapsed([], 5, 120, 4)).toBeNull();
    expect(activeBarFromElapsed(inv, 5, 0, 4)).toBeNull();
    expect(activeBarFromElapsed(inv, 5, 120, 0)).toBeNull();
  });

  it("scales with tempo (slower BPM advances slower)", () => {
    // 60 BPM, 4/4 → 4 seconds per bar.
    expect(activeBarFromElapsed(inv, 3.99, 60, 4)).toBe(0);
    expect(activeBarFromElapsed(inv, 4.0, 60, 4)).toBe(1);
  });
});

import { barCoverageFraction, hasUsableBarTracking } from "@/lib/chord-bar-inventory";

describe("barCoverageFraction", () => {
  it("returns 0 for a score with no chord-containing lines", () => {
    expect(barCoverageFraction({})).toBe(0);
    expect(
      barCoverageFraction({
        sections: [{ lines: [{ lyrics: "just lyrics" }] }],
      }),
    ).toBe(0);
  });

  it("returns 1 when every chord line has a `|`", () => {
    expect(
      barCoverageFraction({
        sections: [
          {
            lines: [
              { chords: "| Em | Bm |" },
              { chords: "| C | D |" },
            ],
          },
        ],
      }),
    ).toBe(1);
  });

  it("returns the right fraction when half the chord lines are bar-less", () => {
    // 4 chord lines, 2 have `|`.
    expect(
      barCoverageFraction({
        sections: [
          {
            lines: [
              { chords: "| Em |" },
              { chords: "Em Bm" }, // no pipe
              { chords: "| C |" },
              { chords: "G F" },   // no pipe
            ],
          },
        ],
      }),
    ).toBe(0.5);
  });

  it("ignores blank / lyric-only / section-header lines in the denominator", () => {
    // 2 chord lines (one barred, one not). 0.5 — the blank/lyric lines
    // don't drag the fraction down.
    expect(
      barCoverageFraction({
        sections: [
          {
            lines: [
              { chords: "| Em |" },           // counts (barred)
              { lyrics: "lyric only line" },  // ignored
              { chords: "" },                 // ignored
              { chords: "G F" },              // counts (not barred)
            ],
          },
        ],
      }),
    ).toBe(0.5);
  });

  it("aggregates across multiple sections", () => {
    // 3 chord lines total, 2 with bars.
    expect(
      barCoverageFraction({
        sections: [
          { lines: [{ chords: "| Em |" }] },
          { lines: [{ chords: "| Bm |" }, { chords: "C" }] },
        ],
      }),
    ).toBeCloseTo(2 / 3, 3);
  });
});

describe("hasUsableBarTracking", () => {
  it("is true when coverage clears the default threshold (0.8)", () => {
    // 5 chord lines, 4 barred = 0.8 — just meets the bar.
    expect(
      hasUsableBarTracking({
        sections: [
          {
            lines: [
              { chords: "| Em |" }, { chords: "| Bm |" }, { chords: "| C |" }, { chords: "| D |" },
              { chords: "G" }, // 1 of 5 is unbarred
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("is false when coverage drops below 0.8 (user got tired half way)", () => {
    // 5 chord lines, 3 barred = 0.6 — below threshold.
    expect(
      hasUsableBarTracking({
        sections: [
          {
            lines: [
              { chords: "| Em |" }, { chords: "| Bm |" }, { chords: "| C |" },
              { chords: "G" }, { chords: "F" }, // 2 of 5 are unbarred
            ],
          },
        ],
      }),
    ).toBe(false);
  });

  it("is false for a song with zero bars (the warp-speed case)", () => {
    expect(
      hasUsableBarTracking({
        sections: [
          { lines: [{ chords: "Em Bm" }, { chords: "C G" }] },
        ],
      }),
    ).toBe(false);
  });

  it("respects a custom threshold", () => {
    // 5 chord lines, 3 barred = 0.6. Threshold 0.5 → true.
    expect(
      hasUsableBarTracking(
        {
          sections: [
            {
              lines: [
                { chords: "| Em |" }, { chords: "| Bm |" }, { chords: "| C |" },
                { chords: "G" }, { chords: "F" },
              ],
            },
          ],
        },
        0.5,
      ),
    ).toBe(true);
  });
});
