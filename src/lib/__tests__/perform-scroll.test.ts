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
// Default trigger threshold = viewport/2 = 450.
// Default target settling position = viewport/3 = 300.

describe("computeLineScrollTarget — warmup (trigger threshold)", () => {
  it("returns 0 when the line is at the top of content", () => {
    expect(computeLineScrollTarget(0, VIEWPORT, 5000)).toBe(0);
  });

  it("returns 0 when the line is within the top half (default trigger 0.5)", () => {
    // viewport/2 = 450. Line at 200 → well under threshold → 0.
    expect(computeLineScrollTarget(200, VIEWPORT, 5000)).toBe(0);
  });

  // REGRESSION (Twig): line 2 at content-Y ≈ 200 was producing a
  // non-zero target under the old single-fraction model (trigger=
  // target=viewport/3=300) because line 2 in some chord charts sits
  // past viewport/3 due to section headers + line-height. With the
  // new trigger=viewport/2 default, scroll stays parked for line 2.
  it("REGRESSION: line 2 at content-Y 350 does NOT engage scroll", () => {
    expect(computeLineScrollTarget(350, VIEWPORT, 5000)).toBe(0);
  });

  it("returns 0 exactly at the trigger boundary (450)", () => {
    expect(computeLineScrollTarget(450, VIEWPORT, 5000)).toBe(0);
  });

  it("returns 0 just below trigger boundary (449)", () => {
    expect(computeLineScrollTarget(449, VIEWPORT, 5000)).toBe(0);
  });
});

describe("computeLineScrollTarget — engagement and settling", () => {
  it("engages scroll once the line crosses the trigger threshold", () => {
    // Line at 451 → past trigger 450, settle target = lineY - viewport/3
    //   = 451 - 300 = 151
    expect(computeLineScrollTarget(451, VIEWPORT, 5000)).toBe(151);
  });

  it("settles deeper lines at viewport/3 from top", () => {
    expect(computeLineScrollTarget(600, VIEWPORT, 5000)).toBe(300);
    expect(computeLineScrollTarget(1000, VIEWPORT, 5000)).toBe(700);
    expect(computeLineScrollTarget(2000, VIEWPORT, 5000)).toBe(1700);
  });
});

describe("computeLineScrollTarget — end-of-content clamp", () => {
  it("never exceeds maxScroll (would scroll past the bottom)", () => {
    expect(computeLineScrollTarget(10000, VIEWPORT, 5000)).toBe(5000);
  });

  it("respects the clamp exactly at the max", () => {
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

describe("computeLineScrollTarget — custom trigger / target fractions", () => {
  it("respects a deeper trigger (2/3 viewport) for slower engagement", () => {
    // Trigger at viewport*2/3 = 600. Line at 500 → still parked.
    const target = computeLineScrollTarget(500, VIEWPORT, 5000, {
      triggerFraction: 2 / 3,
    });
    expect(target).toBe(0);
  });

  it("respects a shallower trigger (1/4 viewport) for earlier engagement", () => {
    // Trigger at 225. Line at 300 → engaged.
    const target = computeLineScrollTarget(300, VIEWPORT, 5000, {
      triggerFraction: 1 / 4,
    });
    // Settle: 300 - viewport/3 = 0 (clamp to 0 since ideal isn't positive)
    expect(target).toBe(0);
    // Try a deeper line so settle is positive:
    const target2 = computeLineScrollTarget(400, VIEWPORT, 5000, {
      triggerFraction: 1 / 4,
    });
    expect(target2).toBe(100); // 400 - 300
  });

  it("targetFraction overrides the settling position", () => {
    // Trigger 0.5, target 0.25. Line at 500 → past trigger; settle
    //   at 500 - viewport*0.25 = 500 - 225 = 275.
    const target = computeLineScrollTarget(500, VIEWPORT, 5000, {
      triggerFraction: 0.5,
      targetFraction: 0.25,
    });
    expect(target).toBe(275);
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
