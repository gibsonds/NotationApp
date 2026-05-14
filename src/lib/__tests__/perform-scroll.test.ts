import { describe, expect, it } from "vitest";
import type { Score } from "@/lib/schema";
import {
  computeLineScrollTarget,
  isLineTransition,
  scrollTriggerSequence,
} from "@/lib/perform-scroll";
import { computeBarInventory } from "@/lib/chord-bar-inventory";

// A typical iPad-ish viewport in portrait.
const VIEWPORT = 900;
const ONE_THIRD = VIEWPORT / 3; // 300

describe("computeLineScrollTarget — warmup behaviour", () => {
  it("returns 0 when the line is at the top of content (warmup)", () => {
    // Line at content-Y 0 → ideal = -300 → clamp to 0.
    expect(computeLineScrollTarget(0, VIEWPORT, 5000)).toBe(0);
  });

  it("returns 0 when the line is within the top 1/3 of the viewport", () => {
    // Line at content-Y 200, viewport/3 = 300 → ideal = -100 → 0.
    expect(computeLineScrollTarget(200, VIEWPORT, 5000)).toBe(0);
  });

  it("returns 0 exactly at the 1/3 boundary", () => {
    expect(computeLineScrollTarget(ONE_THIRD, VIEWPORT, 5000)).toBe(0);
  });
});

describe("computeLineScrollTarget — normal scroll", () => {
  it("places the line at viewport/3 once it crosses that mark", () => {
    // Line at 400 → ideal = 400 - 300 = 100.
    expect(computeLineScrollTarget(400, VIEWPORT, 5000)).toBe(100);
  });

  it("scales linearly as the line moves further down", () => {
    expect(computeLineScrollTarget(1000, VIEWPORT, 5000)).toBe(700);
    expect(computeLineScrollTarget(2000, VIEWPORT, 5000)).toBe(1700);
  });
});

describe("computeLineScrollTarget — end-of-content clamp", () => {
  it("never exceeds maxScroll (would scroll past the bottom)", () => {
    // Line content-Y 10000, viewport 900, maxScroll 5000.
    // Ideal would be 9700 — but scrollable range is only 5000.
    expect(computeLineScrollTarget(10000, VIEWPORT, 5000)).toBe(5000);
  });

  it("respects the clamp exactly at the max", () => {
    // Ideal = 5000 → target = 5000.
    expect(computeLineScrollTarget(5300, VIEWPORT, 5000)).toBe(5000);
  });
});

describe("computeLineScrollTarget — defensive zero / negative input", () => {
  it("returns 0 when viewport size is zero (defensive)", () => {
    expect(computeLineScrollTarget(500, 0, 5000)).toBe(0);
  });

  it("returns 0 when maxScroll is zero (content fits in viewport)", () => {
    expect(computeLineScrollTarget(500, VIEWPORT, 0)).toBe(0);
  });
});

describe("isLineTransition", () => {
  const barA0 = { globalIdx: 0, sectionIdx: 0, sectionId: "v", lineIdx: 0, startCol: 0, endCol: 4 };
  const barA1 = { globalIdx: 1, sectionIdx: 0, sectionId: "v", lineIdx: 0, startCol: 4, endCol: 8 };
  const barB0 = { globalIdx: 2, sectionIdx: 0, sectionId: "v", lineIdx: 1, startCol: 0, endCol: 4 };
  const barC0 = { globalIdx: 3, sectionIdx: 1, sectionId: "c", lineIdx: 0, startCol: 0, endCol: 4 };

  it("first bar (prev=null) is a transition (starts the session)", () => {
    expect(isLineTransition(null, barA0)).toBe(true);
  });

  it("two bars on the same (sectionId, lineIdx) are NOT a transition", () => {
    expect(isLineTransition(barA0, barA1)).toBe(false);
  });

  it("changing lineIdx within the same section is a transition", () => {
    expect(isLineTransition(barA1, barB0)).toBe(true);
  });

  it("changing sectionId is a transition (even with same lineIdx=0)", () => {
    expect(isLineTransition(barB0, barC0)).toBe(true);
  });

  it("end-of-song (next=null) is NOT a transition (caller stops anyway)", () => {
    expect(isLineTransition(barC0, null)).toBe(false);
  });
});

describe("scrollTriggerSequence — regression: one trigger per LINE", () => {
  // The user's headline complaint each time scroll has regressed:
  // either too many scrolls (per bar) so the chord chart races, OR
  // too few/never-resetting so it goes off the page. This locks in
  // the rule: exactly ONE scroll trigger per line in the inventory.

  it("4-bar single line emits ONE trigger (the first bar)", () => {
    // "| C | F | G | Am |"
    const s = {
      sections: [{ id: "v", lines: [{ chords: "| C | F | G | Am |" }] }],
    } as unknown as Score;
    const inv = computeBarInventory(s);
    const triggers = scrollTriggerSequence(inv).filter((t) => t.trigger);
    expect(inv).toHaveLength(4);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].barIdx).toBe(0);
  });

  it("multi-line song fires exactly one trigger per line, in order", () => {
    // Section v: 4 bars on line 0, 4 bars on line 1, 2 bars on line 2.
    // Section c: 4 bars on line 0.
    const s = {
      sections: [
        {
          id: "v",
          lines: [
            { chords: "| Em | Bm | C | D |" },
            { chords: "| Em | Bm | C | D |" },
            { chords: "| Am | C |" },
          ],
        },
        { id: "c", lines: [{ chords: "| F | G | Am | F |" }] },
      ],
    } as unknown as Score;
    const inv = computeBarInventory(s);
    expect(inv).toHaveLength(14); // 4+4+2+4
    const triggers = scrollTriggerSequence(inv).filter((t) => t.trigger);
    expect(triggers.map((t) => t.lineKey)).toEqual(["v-0", "v-1", "v-2", "c-0"]);
    expect(triggers.map((t) => t.barIdx)).toEqual([0, 4, 8, 10]);
  });

  it("a long solo line (16 bars, 1 line) still fires only one trigger", () => {
    // Worst case for the "scrolls off the page" bug: many bars in
    // one line. Triggers must NOT fire on each bar within the line.
    const longLine = "| " + Array.from({ length: 16 }, (_, i) => `C${i} | `).join("");
    const s = {
      sections: [{ id: "v", lines: [{ chords: longLine }] }],
    } as unknown as Score;
    const inv = computeBarInventory(s);
    expect(inv.length).toBeGreaterThan(10);
    const triggers = scrollTriggerSequence(inv).filter((t) => t.trigger);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].barIdx).toBe(0);
  });
});

describe("scrollTriggerSequence — combined with target computation", () => {
  // End-to-end check: simulate a playback sequence and compute the
  // scroll targets the caller would set. Each line transition gets a
  // distinct target; within-line bars keep the previous target.

  it("simulates a 3-line song and yields three distinct scroll targets", () => {
    const inv = [
      { globalIdx: 0, sectionIdx: 0, sectionId: "v", lineIdx: 0, startCol: 0, endCol: 4 },
      { globalIdx: 1, sectionIdx: 0, sectionId: "v", lineIdx: 0, startCol: 4, endCol: 8 },
      { globalIdx: 2, sectionIdx: 0, sectionId: "v", lineIdx: 1, startCol: 0, endCol: 4 },
      { globalIdx: 3, sectionIdx: 0, sectionId: "v", lineIdx: 1, startCol: 4, endCol: 8 },
      { globalIdx: 4, sectionIdx: 0, sectionId: "v", lineIdx: 2, startCol: 0, endCol: 4 },
    ];
    // Pretend the chord chart has three lines at content-Y 100, 600, 1100.
    const linePositions = new Map<string, number>([
      ["v-0", 100],
      ["v-1", 600],
      ["v-2", 1100],
    ]);
    const targetForBar = (idx: number): number => {
      const lineKey = `${inv[idx].sectionId}-${inv[idx].lineIdx}`;
      return computeLineScrollTarget(linePositions.get(lineKey)!, VIEWPORT, 5000);
    };
    expect(targetForBar(0)).toBe(0);    // line at 100, in warmup zone
    expect(targetForBar(1)).toBe(0);    // same line, same target
    expect(targetForBar(2)).toBe(300);  // line at 600 — 300 = 300
    expect(targetForBar(3)).toBe(300);  // same line as bar 2
    expect(targetForBar(4)).toBe(800);  // line at 1100 — 300 = 800
  });

  it("never overshoots the bottom: long song clamps to maxScroll", () => {
    // Last line is far below max scroll — should clamp.
    const linePositions = new Map<string, number>([["v-0", 9999]]);
    const t = computeLineScrollTarget(linePositions.get("v-0")!, VIEWPORT, 5000);
    expect(t).toBe(5000);
  });
});
