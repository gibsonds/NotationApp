import { describe, expect, it } from "vitest";
import { beatsPerBarOf, durationForBeats, parseAsciiTab, riffToAsciiTab } from "../riff-ascii";
import type { Riff } from "../schema";

const TAB = [
  "e|--3--5--|--7-----|",
  "B|--------|--------|",
  "G|--------|--------|",
  "D|--------|--------|",
  "A|--------|--------|",
  "E|--------|--------|",
].join("\n");

function riffFrom(ascii: string, over: Partial<Riff> = {}): Riff {
  const { bars, tuning } = parseAsciiTab(ascii);
  return {
    id: "r1",
    label: "Riff",
    kind: "tab",
    tuning,
    anchor: { sectionId: "v1", lineIdx: 0 },
    bars,
    visibility: "shared",
    source: "ascii",
    createdAt: 1,
    ...over,
  };
}

describe("beatsPerBarOf / durationForBeats", () => {
  it("reads the numerator, falling back to 4", () => {
    expect(beatsPerBarOf("4/4")).toBe(4);
    expect(beatsPerBarOf("3/4")).toBe(3);
    expect(beatsPerBarOf("6/8")).toBe(6);
    expect(beatsPerBarOf(undefined)).toBe(4);
    expect(beatsPerBarOf("nonsense")).toBe(4);
  });

  it("picks the largest note value that fits", () => {
    expect(durationForBeats(4)).toBe("whole");
    expect(durationForBeats(2)).toBe("half");
    expect(durationForBeats(1)).toBe("quarter");
    expect(durationForBeats(0.5)).toBe("eighth");
    expect(durationForBeats(0.25)).toBe("sixteenth");
  });
});

describe("parseAsciiTab", () => {
  it("reads frets onto the right strings and bars", () => {
    const { bars, warnings } = parseAsciiTab(TAB);
    expect(warnings).toEqual([]);
    expect(bars).toHaveLength(2);

    const first = bars[0].events;
    expect(first).toHaveLength(2);
    // Top line is string 1 — how tab is always read.
    expect(first[0].notes).toEqual([{ string: 1, fret: 3 }]);
    expect(first[1].notes).toEqual([{ string: 1, fret: 5 }]);

    expect(bars[1].events).toHaveLength(1);
    expect(bars[1].events[0].notes).toEqual([{ string: 1, fret: 7 }]);
  });

  it("keeps multi-digit frets whole", () => {
    // The classic failure: "12" read as fret 1 then fret 2.
    const { bars } = parseAsciiTab("e|--12--0--|");
    const frets = bars[0].events.flatMap((e) => e.notes.map((n) => n.fret));
    expect(frets).toEqual([12, 0]);
  });

  it("groups simultaneous frets into one chord event", () => {
    const { bars } = parseAsciiTab(["e|--3--|", "B|--3--|", "G|--0--|"].join("\n"));
    expect(bars[0].events).toHaveLength(1);
    expect(bars[0].events[0].notes).toEqual([
      { string: 1, fret: 3 },
      { string: 2, fret: 3 },
      { string: 3, fret: 0 },
    ]);
  });

  it("derives rhythm from column spacing", () => {
    // Four evenly spaced hits across a 4/4 bar → one per beat.
    const { bars } = parseAsciiTab("e|--0---0---0---0---|");
    const beats = bars[0].events.map((e) => e.beat);
    expect(beats).toEqual([1, 2, 3, 4]);
  });

  it("reads articulations from the character before the fret", () => {
    const { bars } = parseAsciiTab("e|--5h7--9/12--|");
    const arts = bars[0].events.flatMap((e) => e.notes.map((n) => n.articulation));
    expect(arts).toContain("hammer");
    expect(arts).toContain("slide");
  });

  it("warns rather than throwing on non-tab lines", () => {
    const { bars, warnings } = parseAsciiTab("Intro riff — play twice\ne|--3--|");
    expect(bars).toHaveLength(1);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("returns empty bars for input with no tab at all", () => {
    const { bars } = parseAsciiTab("just some words");
    expect(bars).toEqual([]);
  });

  it("pads when strings disagree on bar count, rather than dropping music", () => {
    const { bars, warnings } = parseAsciiTab(["e|--3--|--5--|", "B|--3--|"].join("\n"));
    expect(bars).toHaveLength(2);
    expect(warnings.some((w) => /bar count/i.test(w))).toBe(true);
  });
});

describe("riffToAsciiTab", () => {
  it("round-trips a riff back to tab with the same frets and bar count", () => {
    const riff = riffFrom(TAB);
    const out = riffToAsciiTab(riff);
    const reparsed = parseAsciiTab(out);

    expect(reparsed.bars).toHaveLength(riff.bars.length);
    const originalFrets = riff.bars.map((b) =>
      b.events.flatMap((e) => e.notes.map((n) => `${n.string}:${n.fret}`)),
    );
    const roundTripped = reparsed.bars.map((b) =>
      b.events.flatMap((e) => e.notes.map((n) => `${n.string}:${n.fret}`)),
    );
    expect(roundTripped).toEqual(originalFrets);
  });

  it("emits one line per string", () => {
    expect(riffToAsciiTab(riffFrom(TAB)).split("\n")).toHaveLength(6);
  });
});
