import { describe, expect, it } from "vitest";
import { describeCopies, describeSkips, planChordCopy, sectionKind } from "../chord-copy";
import { parseToSections } from "../lyric-parser";

describe("sectionKind", () => {
  it("strips numbers and repeat markers", () => {
    expect(sectionKind("Verse 2")).toBe("verse");
    expect(sectionKind("Chorus x2")).toBe("chorus");
    expect(sectionKind("Chorus")).toBe("chorus");
    expect(sectionKind("Pre-Chorus 1")).toBe("pre-chorus");
  });
});

describe("planChordCopy", () => {
  const chart = [
    "VERSE 1",
    "G        C",
    "Amazing grace how sweet",
    "D              G",
    "the sound that saved",
    "",
    "CHORUS",
    "C     G",
    "Sing it loud",
    "D     G",
    "sing it clear",
    "",
    "VERSE 2",
    "Twas grace that taught",
    "my heart to fear",
    "",
    "CHORUS",
    "Sing it loud",
    "sing it clear",
    "",
    "VERSE 3",
    "One line only",
    "",
    "BRIDGE",
    "No chords anywhere",
  ].join("\n");

  it("copies verse 1's chords to verse 2 and the first chorus to the second", () => {
    const plan = planChordCopy(parseToSections(chart));
    const byLabel = (i: number) => plan.sections[i];
    expect(plan.copies).toEqual([
      { target: 2, source: 0 },
      { target: 3, source: 1 },
    ]);
    expect(byLabel(2).lines.map((l) => l.chords)).toEqual(["G        C", "D              G"]);
    expect(byLabel(3).lines.map((l) => l.chords)).toEqual(["C     G", "D     G"]);
  });

  it("skips a same-kind section whose line count differs, and says so", () => {
    const plan = planChordCopy(parseToSections(chart));
    expect(plan.skipped).toEqual([{ target: 4, source: 2, reason: "line-count" }]);
    expect(describeSkips(plan)).toMatch(/Verse 3 has a different number of lines than Verse/);
    expect(plan.sections[4].lines[0].chords).toBe("");
  });

  it("leaves a kind with no chorded example alone", () => {
    const plan = planChordCopy(parseToSections(chart));
    expect(plan.sections[5].label).toBe("Bridge");
    expect(plan.sections[5].lines[0].chords).toBe("");
  });

  it("copies to a shortened repeat whose lines all appear in the source, in order", () => {
    const text = [
      "CHORUS",
      "|Bb   F     |C",
      "We're not there yet",
      "|Bb   F   |C",
      "No, not just yet",
      "Not just yet",
      "G riff (4 bars)",
      "",
      "CHORUS x2",
      "We're not there yet",
      "No, not just yet",
    ].join("\n");
    const plan = planChordCopy(parseToSections(text));
    expect(plan.copies).toEqual([{ target: 1, source: 0 }]);
    expect(plan.sections[1].lines.map((l) => l.chords)).toEqual(["|Bb   F     |C", "|Bb   F   |C"]);
  });

  it("does not touch the input", () => {
    const parsed = parseToSections(chart);
    planChordCopy(parsed);
    expect(parsed[2].lines[0].chords).toBe("");
  });

  it("copies from a later section when the earlier one has no chords", () => {
    const plan = planChordCopy(parseToSections("CHORUS\nla la\n\nCHORUS\nC   G\nla la"));
    expect(plan.copies).toEqual([{ target: 0, source: 1 }]);
    expect(plan.sections[0].lines[0].chords).toBe("C   G");
  });

  it("ignores blank spacer lines when matching line counts", () => {
    const plan = planChordCopy(parseToSections("VERSE 1\nC\none\n\nG\ntwo\n\nVERSE 2\nuno\ndos"));
    expect(plan.copies).toHaveLength(1);
    expect(plan.sections[1].lines.map((l) => l.chords)).toEqual(["C", "G"]);
  });

  it("describes the copies with ordinals for repeated labels", () => {
    const plan = planChordCopy(parseToSections(chart));
    expect(describeCopies(plan)).toBe("Verse 2 ← Verse 1, Chorus (2nd) ← Chorus (1st)");
  });
});
