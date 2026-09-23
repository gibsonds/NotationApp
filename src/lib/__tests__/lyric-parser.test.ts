import { describe, it, expect } from "vitest";
import {
  sanitizePastedText,
  parseToChordChartLines,
  parseToSections,
  parseLyricsWithChords,
  parseSectionHeader,
  detectTitleLine,
  normalizeTitleCase,
  stripCommonIndent,
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

// The chord line's leading spaces ARE the column data that puts each chord
// over its word. A plain .trim() on the pasted blob ate them from the FIRST
// line only, sliding that line left while every later line kept its indent —
// so a pasted chart came in misaligned and had to be re-spaced by hand.
describe("paste preserves chord-line indentation", () => {
  const INDENTED = [
    "      C              G",
    "Driving to your house",
    "        Am           F",
    "Long way east then a little bit south",
  ].join("\n");

  it("keeps the first chord line's leading spaces", () => {
    const lines = parseToChordChartLines(INDENTED);
    expect(lines[0].chords).toBe("      C              G");
    expect(lines[0].lyrics).toBe("Driving to your house");
  });

  it("indents the first and later chord lines consistently", () => {
    const lines = parseToChordChartLines(INDENTED);
    // Both chord lines keep their own indent — the bug made only the first differ.
    expect(lines[0].chords.indexOf("C")).toBe(6);
    expect(lines[1].chords.indexOf("Am")).toBe(8);
  });

  it("keeps indentation through parseToSections, including after a header", () => {
    const sections = parseToSections(`Verse 1\n${INDENTED}`);
    expect(sections).toHaveLength(1);
    expect(sections[0].lines[0].chords).toBe("      C              G");
  });

  it("still drops surrounding blank lines", () => {
    const lines = parseToChordChartLines(`\n\n${INDENTED}\n\n`);
    expect(lines).toHaveLength(2);
    expect(lines[0].chords).toBe("      C              G");
  });

  it("returns [] for whitespace-only input", () => {
    expect(parseToChordChartLines("   \n\t\n  ")).toEqual([]);
    expect(parseToSections("   \n\n")).toEqual([]);
  });

  it("keeps the chord over its word — the column lands on the same character", () => {
    const lines = parseToChordChartLines(INDENTED);
    // Column 6 of the lyric line is what "C" sits above; if the chord line got
    // trimmed, C would land on column 0 ("D") instead.
    expect(lines[0].lyrics[lines[0].chords.indexOf("C")]).toBe("g");
  });
});

// Bar-delimited chord rows with no lyric under them — how intros, turnarounds
// and solo sections are actually written. A chord line is only recognized when
// EVERY token qualifies, and "|" didn't, so these were filed as lyrics and
// rendered as words.
describe("bar-delimited chord rows are chords, not lyrics", () => {
  it("recognizes a bar-delimited intro row", () => {
    const lines = parseToChordChartLines("|Am G |Fmaj7 | F |");
    expect(lines).toHaveLength(1);
    expect(lines[0].lyrics).toBe("");
    expect(lines[0].chords).toBe("|Am G |Fmaj7 | F |");
  });

  it("keeps the bar markers, so bar tracking still sees them", () => {
    const lines = parseToChordChartLines("  C | G | C | G");
    expect(lines[0].chords).toContain("|");
    expect(lines[0].lyrics).toBe("");
  });

  it("handles a whole intro block of bar rows", () => {
    const lines = parseToChordChartLines("|Am G |Fmaj7 | F |\n  C | G | C | G");
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.lyrics === "")).toBe(true);
    expect(lines.every((l) => l.chords.includes("|"))).toBe(true);
  });

  it("still pairs a bar-delimited chord line with the lyric beneath it", () => {
    const lines = parseToChordChartLines("| Am | F |\nway back then when we were young");
    expect(lines).toHaveLength(1);
    expect(lines[0].chords).toBe("| Am | F |");
    expect(lines[0].lyrics).toBe("way back then when we were young");
  });

  it("does NOT mistake an ordinary lyric line for chords", () => {
    const lines = parseToChordChartLines("I got no one to care");
    expect(lines[0].chords).toBe("");
    expect(lines[0].lyrics).toBe("I got no one to care");
  });

  it("strips bars from the chord when extracting to word pairs", () => {
    const pairs = parseLyricsWithChords("|Am    |F\nhello world");
    expect(pairs.map((p) => p.chord)).toEqual(["Am", "F"]);
  });
});

// ── Paste cleanup (Lebanon / Damnation imports) ──────────────────────────────

describe("repeat markers on chord rows", () => {
  it("reads an intro row that ends in x3 as chords, not lyrics", () => {
    const [intro, d] = parseToChordChartLines("G  D  Em  C   x3\nD");
    expect(intro).toEqual({ chords: "G  D  Em  C   x3", lyrics: "" });
    expect(d).toEqual({ chords: "D", lyrics: "" });
  });

  it("accepts (x2), 2x and ×3 forms", () => {
    expect(parseToChordChartLines("| G | C | (x2)")[0].lyrics).toBe("");
    expect(parseToChordChartLines("G C 2x")[0].lyrics).toBe("");
    expect(parseToChordChartLines("G C ×3")[0].chords).toBe("G C x3");
  });

  it("does not treat a lone repeat marker as a chord row", () => {
    expect(parseToChordChartLines("x3")[0]).toEqual({ chords: "", lyrics: "x3" });
  });

  it("skips the marker when extracting chords to words", () => {
    const pairs = parseLyricsWithChords("G     C   x2\nhello world");
    expect(pairs.map(p => p.chord)).toEqual(["G", "C"]);
  });
});

describe("section headers — wider vocabulary", () => {
  it.each([
    ["Verse Two", "Verse 2"],
    ["VERSE ONE", "Verse 1"],
    ["Verse II", "Verse 2"],
    ["[Chorus]", "Chorus"],
    ["(Bridge)", "Bridge"],
    ["Solo", "Solo"],
    ["Guitar Solo", "Guitar Solo"],
    ["Instrumental:", "Instrumental"],
    ["Interlude", "Interlude"],
    ["Breakdown", "Breakdown"],
    ["Tag", "Tag"],
    ["Coda", "Coda"],
    ["Post-Chorus", "Post-Chorus"],
    ["Middle 8", "Middle 8"],
    ["CHORUS x2", "Chorus x2"],
    ["Chorus (x2)", "Chorus x2"],
    ["Chorus 2x", "Chorus x2"],
    ["Verse 3 (x2)", "Verse 3 x2"],
  ])("%s -> %s", (line, label) => {
    expect(parseSectionHeader(line)).toBe(label);
  });

  it("still rejects ordinary lyric lines", () => {
    expect(parseSectionHeader("Tangled I was strangled")).toBeNull();
    expect(parseSectionHeader("Twice in a lifetime")).toBeNull();
    expect(parseSectionHeader("x2")).toBeNull();
  });

  it("recognizes an indented header (Damnation's 'Verse Two')", () => {
    const sections = parseToSections(
      "  Verse 1\n  Deposition, you are my imposition\n\n  Verse Two\n  Officer of the register\n",
    );
    expect(sections.map(s => s.label)).toEqual(["Verse 1", "Verse 2"]);
    expect(sections[1].lines[0].lyrics).toBe("Officer of the register");
  });
});

describe("reference headers keep their place", () => {
  it("keeps 'CHORUS x2' as a label-only section between verse and bridge", () => {
    const sections = parseToSections(
      "VERSE 2\n|G |F\nImagine no politics\n\n\nCHORUS x2\n\n\nBRIDGE\n|A\nTrapped in combat",
    );
    expect(sections.map(s => s.label)).toEqual(["Verse 2", "Chorus x2", "Bridge"]);
    expect(sections[1].lines).toEqual([]);
    expect(sections[0].lines.map(l => l.lyrics)).toEqual(["Imagine no politics"]);
  });

  it("keeps a bare repeated header ('Chorus' again) as a reference", () => {
    const sections = parseToSections("Chorus\nOpen wound\n\nBridge\nMessenger\n\nChorus\n");
    expect(sections.map(s => s.label)).toEqual(["Chorus", "Bridge", "Chorus"]);
    expect(sections[2].lines).toEqual([]);
  });

  it("still drops a brand-new header with nothing under it", () => {
    const sections = parseToSections("Verse 1\nhello\n\nVerse 2\n\nChorus\nworld");
    expect(sections.map(s => s.label)).toEqual(["Verse 1", "Chorus"]);
  });
});

describe("whitespace cleanup on paste", () => {
  it("strips the indent every line shares, keeping chord/lyric alignment", () => {
    expect(stripCommonIndent("  G   C\n  hello world\n\n    deeper")).toBe("G   C\nhello world\n\n  deeper");
    const [line] = parseToChordChartLines("    G     C\n    hello world");
    expect(line).toEqual({ chords: "G     C", lyrics: "hello world" });
  });

  it("collapses runs of blank lines to one and drops them at section edges", () => {
    const [sec] = parseToSections("Verse 1\n\n\nfirst\n\n\n\nsecond\n\n\n");
    expect(sec.lines.map(l => l.lyrics)).toEqual(["first", "", "second"]);
  });

  it("drops a trailing END sign-off", () => {
    const sections = parseToSections("Chorus\nhello\n\nEND\n");
    expect(sections[0].lines.map(l => l.lyrics)).toEqual(["hello"]);
    expect(parseToChordChartLines("hello\nThe End").map(l => l.lyrics)).toEqual(["hello"]);
  });

  it("does not drop END when it is not the last line", () => {
    expect(parseToChordChartLines("END\nhello").map(l => l.lyrics)).toEqual(["END", "hello"]);
  });
});

describe("title line detection", () => {
  const lebanon = "LEBANON\n\nINTRO\nG  D  Em  C   x3\n\nVERSE 1\nG      |F\nTangled I was strangled\n";

  it("pulls a lone first line above the first header out as the title", () => {
    const hit = detectTitleLine(lebanon);
    expect(hit?.title).toBe("LEBANON");
    expect(parseToSections(hit!.body).map(s => s.label)).toEqual(["Intro", "Verse 1"]);
    expect(parseToSections(hit!.body)[0].lines[0]).toEqual({ chords: "G  D  Em  C   x3", lyrics: "" });
  });

  it("accepts a title directly followed by the first header, and an indented one", () => {
    expect(detectTitleLine("Damnation\nVerse 1\nhello")?.title).toBe("Damnation");
    expect(detectTitleLine("  Damnation\n\n  Verse 1\n  hello")?.title).toBe("Damnation");
  });

  it("is not fooled by a header, a chord row, or a lyric couplet on line one", () => {
    expect(detectTitleLine("Verse 1\nhello\n\nChorus\nworld")).toBeNull();
    expect(detectTitleLine("G  C\nhello\n\nChorus\nworld")).toBeNull();
    expect(detectTitleLine("hello there\nhow are you\n\nChorus\nworld")).toBeNull();
  });

  it("needs section headers somewhere — plain lyrics have no title line", () => {
    expect(detectTitleLine("Lebanon\n\nhello world")).toBeNull();
  });

  it("title-cases an ALL CAPS title and leaves mixed case alone", () => {
    expect(normalizeTitleCase("LEBANON")).toBe("Lebanon");
    expect(normalizeTitleCase("LOVE SEEKING MISSILE")).toBe("Love Seeking Missile");
    expect(normalizeTitleCase("ROCK-A-BYE (LIVE)")).toBe("Rock-A-Bye (Live)");
    expect(normalizeTitleCase("Look What I Made")).toBe("Look What I Made");
    expect(normalizeTitleCase("iPad song")).toBe("iPad song");
  });
});
