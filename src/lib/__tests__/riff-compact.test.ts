import { describe, expect, it } from "vitest";
import { expandCompactRiff, isVoicingLine, parseFretRun, parseVoicing } from "../riff-compact";
import { parseAsciiTab } from "../riff-ascii";

describe("parseFretRun", () => {
  it("reads frets per string, comma moving to the next higher string", () => {
    expect(parseFretRun("*6 5 7 8, 5 7, 5 7")).toEqual([
      { string: 6, fret: 5 }, { string: 6, fret: 7 }, { string: 6, fret: 8 },
      { string: 5, fret: 5 }, { string: 5, fret: 7 },
      { string: 4, fret: 5 }, { string: 4, fret: 7 },
    ]);
  });

  it("accepts the older 6* spelling and explicit string jumps", () => {
    expect(parseFretRun("6*5 7, 3*5 7")).toEqual([
      { string: 6, fret: 5 }, { string: 6, fret: 7 }, { string: 3, fret: 5 }, { string: 3, fret: 7 },
    ]);
  });

  it("ignores position-shift marks and honours |n*s", () => {
    expect(parseFretRun("*6 8 9 |12 12, 9 10")).toEqual([
      { string: 6, fret: 8 }, { string: 6, fret: 9 }, { string: 6, fret: 12 },
      { string: 5, fret: 9 }, { string: 5, fret: 10 },
    ]);
    expect(parseFretRun("*6 8, |12*4 12 13")?.map((n) => n.string)).toEqual([6, 4, 4]);
  });

  it("rejects a run with no starting string, a bad fret, or too many strings", () => {
    expect(parseFretRun("5 7 8, 5 7")).toBeNull();
    expect(parseFretRun("*6 5 x")).toBeNull();
    expect(parseFretRun("*2 5, 5, 5")).toBeNull();
  });
});

describe("parseVoicing", () => {
  it("reads x32010 low string first", () => {
    expect(parseVoicing("x32010")).toEqual([
      { string: 5, fret: 3 }, { string: 4, fret: 2 }, { string: 3, fret: 0 }, { string: 2, fret: 1 }, { string: 1, fret: 0 },
    ]);
  });

  it("reads the dashed form for two-digit frets", () => {
    expect(parseVoicing("x-10-12-12-12-10")?.map((n) => n.fret)).toEqual([10, 12, 12, 12, 10]);
  });

  it("is not fooled by a fret run or a tab line", () => {
    expect(isVoicingLine("*6 5 7 8")).toBe(false);
    expect(isVoicingLine("e|--3--5--|")).toBe(false);
    expect(isVoicingLine("x32010 320003")).toBe(true);
  });
});

describe("expandCompactRiff → parseAsciiTab", () => {
  it("turns a fret run into eighth notes in order", () => {
    const { bars, warnings } = parseAsciiTab("*6 5 7 8, 5 7");
    expect(warnings).toEqual([]);
    const ev = bars.flatMap((b) => b.events);
    expect(ev.map((e) => [e.notes[0].string, e.notes[0].fret, e.duration])).toEqual([
      [6, 5, "eighth"], [6, 7, "eighth"], [6, 8, "eighth"], [5, 5, "eighth"], [5, 7, "eighth"],
    ]);
  });

  it("turns voicings into strummed quarter-note chords", () => {
    const { bars } = parseAsciiTab("x32010 320003");
    const ev = bars.flatMap((b) => b.events);
    expect(ev).toHaveLength(2);
    expect(ev[0].duration).toBe("quarter");
    expect(ev[0].notes.map((n) => `${n.string}:${n.fret}`).sort()).toEqual(["1:0", "2:1", "3:0", "4:2", "5:3"]);
    expect(ev[1].notes).toHaveLength(6);
  });

  it("leaves ordinary tab alone", () => {
    const tab = "e|--3--5--|\nB|--------|";
    expect(expandCompactRiff(tab)).toBe(tab);
  });
});
