import { describe, expect, it } from "vitest";
import { chordsOf, inferKey, parseChord } from "../key-inference";

function chart(...chordLines: string[]) {
  return {
    sections: [{ id: "s", label: "Verse", lines: chordLines.map((c) => ({ chords: c, lyrics: "la" })) }],
    chordSymbols: [],
  };
}

describe("parseChord", () => {
  it("reads root, quality and spelling", () => {
    expect(parseChord("Am")).toEqual({ pc: 9, quality: "min", flat: false });
    expect(parseChord("Fmaj7")).toEqual({ pc: 5, quality: "maj", flat: false });
    expect(parseChord("Bb")).toEqual({ pc: 10, quality: "maj", flat: true });
    expect(parseChord("F#m7")).toEqual({ pc: 6, quality: "min", flat: false });
    expect(parseChord("G/B")).toEqual({ pc: 7, quality: "maj", flat: false });
    expect(parseChord("Bdim")).toEqual({ pc: 11, quality: "dim", flat: false });
    expect(parseChord("|D7")).toEqual({ pc: 2, quality: "maj", flat: false });
  });

  it("rejects things that are not chords", () => {
    expect(parseChord("|")).toBeNull();
    expect(parseChord("N.C.")).toBeNull();
    expect(parseChord("x3")).toBeNull();
    expect(parseChord("Bridge")).toBeNull();
    expect(parseChord("A#")).toEqual({ pc: 10, quality: "maj", flat: false });
  });
});

describe("inferKey", () => {
  it("returns null with no chords", () => {
    expect(inferKey(chart("", "N.C."))).toBeNull();
  });

  it("hears a I-IV-V song in its major key", () => {
    expect(inferKey(chart("G       C", "D       G"))?.key).toBe("G");
  });

  it("tells A minor from C major by the tonic chords", () => {
    expect(inferKey(chart("Am   G   F", "Am   Em  Am"))?.key).toBe("Am");
    expect(inferKey(chart("C    Am  F   G", "C"))?.key).toBe("C");
  });

  it("follows the chart's spelling for enharmonic keys", () => {
    expect(inferKey(chart("Gb   Cb  Db  Gb"))?.key).toBe("Gb");
    expect(inferKey(chart("F#   B   C#  F#"))?.key).toBe("F#");
  });

  it("copes with a harmonic-minor V and a dominant 7", () => {
    expect(inferKey(chart("Dm   Gm  A7  Dm"))?.key).toBe("Dm");
  });

  it("reports low confidence on a modal chart", () => {
    const g = inferKey(chart("|E  F#  |G  A", "|C  Bb  |Bb  C"));
    expect(g).not.toBeNull();
    expect(g!.confidence).toBeLessThan(0.3);
  });

  it("reads glued chords like GA as G and A", () => {
    expect(chordsOf(chart("|GA  A | GA  A")).map((c) => c.pc)).toEqual([7, 9, 9, 7, 9, 9]);
    expect(inferKey(chart("|GA  A", "|E  |A  |D", "|A"))?.key).toBe("A");
  });

  it("reads notation chord symbols too", () => {
    const g = inferKey({ sections: [], chordSymbols: [
      { measure: 1, beat: 1, symbol: "E" }, { measure: 2, beat: 1, symbol: "A" },
      { measure: 3, beat: 1, symbol: "B7" }, { measure: 4, beat: 1, symbol: "E" },
    ] });
    expect(g?.key).toBe("E");
  });
});
