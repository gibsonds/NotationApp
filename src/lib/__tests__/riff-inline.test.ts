import { describe, expect, it } from "vitest";
import { isSmallRiff, showsInline } from "../riff-inline";

const bar = (n: number) => ({ events: Array.from({ length: n }, (_, i) => ({ beat: i + 1, duration: "eighth" as const, dots: 0, notes: [{ string: 1, fret: 3 }] })) });

describe("isSmallRiff", () => {
  it("accepts one or two bars with a handful of notes", () => {
    expect(isSmallRiff({ bars: [bar(4)] })).toBe(true);
    expect(isSmallRiff({ bars: [bar(8), bar(8)] })).toBe(true);
  });
  it("rejects three bars, or too many events, or nothing", () => {
    expect(isSmallRiff({ bars: [bar(2), bar(2), bar(2)] })).toBe(false);
    expect(isSmallRiff({ bars: [bar(9), bar(8)] })).toBe(false);
    expect(isSmallRiff({ bars: [] })).toBe(false);
    expect(isSmallRiff({ bars: [{ events: [] }] })).toBe(false);
  });
});

describe("showsInline", () => {
  it("is on by default and off once hidden", () => {
    const riff = { id: "r1", bars: [bar(4)] };
    expect(showsInline(riff, [])).toBe(true);
    expect(showsInline(riff, ["r1"])).toBe(false);
    expect(showsInline({ id: "r2", bars: [bar(2), bar(2), bar(2)] }, [])).toBe(false);
  });
});
