import { describe, it, expect } from "vitest";
import {
  sanitizePastedText,
  parseToChordChartLines,
  parseToSections,
} from "../lyric-parser";

describe("sanitizePastedText", () => {
  it("normalizes smart quotes to ASCII", () => {
    // ‘’ single, “” double
    const out = sanitizePastedText("‘don’t’ “stop”");
    expect(out).toBe("'don't' \"stop\"");
  });

  it("normalizes en/em dash and minus to hyphen", () => {
    expect(sanitizePastedText("Pre–Chorus—end−now")).toBe(
      "Pre-Chorus-end-now",
    );
  });

  it("normalizes non-breaking and narrow spaces to a regular space", () => {
    expect(sanitizePastedText("C   G")).toBe("C   G");
  });

  it("expands tabs to spaces (tab stop 8) so column math holds", () => {
    // "C" then a tab lands at column 8.
    expect(sanitizePastedText("C\tG")).toBe("C       G");
  });

  it("normalizes CRLF/CR to LF", () => {
    expect(sanitizePastedText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("is idempotent", () => {
    const once = sanitizePastedText("‘C’\tG");
    expect(sanitizePastedText(once)).toBe(once);
  });
});

describe("parseToChordChartLines — iOS autocorrect chord periods", () => {
  it("recognizes a chord line whose tokens carry trailing periods", () => {
    // "C." / "G." are what iOS double-space autocorrect produces.
    const lines = parseToChordChartLines("C.      G.\nAmazing grace");
    expect(lines).toHaveLength(1);
    // Periods stripped, columns preserved so the chords still sit over the words.
    expect(lines[0].lyrics).toBe("Amazing grace");
    expect(lines[0].chords.startsWith("C ")).toBe(true);
    expect(lines[0].chords).not.toContain(".");
  });

  it("keeps a chord-only line (with periods) as chords, not lyrics", () => {
    const lines = parseToChordChartLines("C. G. Am.");
    expect(lines).toHaveLength(1);
    expect(lines[0].lyrics).toBe("");
    expect(lines[0].chords).not.toContain(".");
    // Periods become spaces (columns preserved), so tokens survive intact.
    expect(lines[0].chords.trim().split(/\s+/)).toEqual(["C", "G", "Am"]);
  });

  it("does NOT strip periods from a real lyric line", () => {
    const lines = parseToChordChartLines("I walked alone.");
    expect(lines[0].chords).toBe("");
    expect(lines[0].lyrics).toBe("I walked alone.");
  });
});

describe("parseToSections — tabbed above-line paste aligns", () => {
  it("uses expanded-tab columns to place chords over the right words", () => {
    // Chord line uses a tab; without pre-parse expansion the G column would be
    // wrong. After sanitize, "G" sits at column 8, nearest to "grace".
    const sections = parseToSections("Verse 1\nC\tG\nAmazing grace here");
    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe("Verse 1");
    const line = sections[0].lines[0];
    expect(line.lyrics).toBe("Amazing grace here");
    expect(line.chords).not.toContain("\t");
  });
});
