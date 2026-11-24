import { describe, expect, it } from "vitest";
import { scoreToMusicXML } from "../musicxml";
import { ScoreSchema, type Note, type Score } from "../schema";

function note(pitch: string, measure: number, beat = 1, duration: Note["duration"] = "whole"): Partial<Note> {
  return { pitch, measure, beat, duration };
}

function score(staves: unknown[], measures = 3): Score {
  return ScoreSchema.parse({ id: "measure-groups", measures, staves });
}

function measuresFor(xml: string, partId: string): Element[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const part = document.querySelector(`part[id="${partId}"]`);
  expect(part).not.toBeNull();
  return Array.from(part!.querySelectorAll("measure"));
}

function pitchesIn(measure: Element): string[] {
  return Array.from(measure.querySelectorAll("note")).map((element) => {
    if (element.querySelector("rest")) return "rest";
    return `${element.querySelector("step")!.textContent}${element.querySelector("octave")!.textContent}`;
  });
}

describe("MusicXML measure grouping", () => {
  it("keeps single-voice notes in their measures, sorted by beat, without changing the score", () => {
    const input = score([{
      id: "melody", name: "Melody", clef: "treble",
      voices: [{ id: "lead", notes: [
        note("G4", 3), note("E4", 1, 3, "half"), note("C4", 1, 1, "half"),
      ] }],
    }]);
    const before = structuredClone(input);

    const measures = measuresFor(scoreToMusicXML(input), "melody");

    expect(measures.map(pitchesIn)).toEqual([["C4", "E4"], ["rest"], ["G4"]]);
    expect(measures[1].querySelector('rest[measure="yes"]')).not.toBeNull();
    expect(measures[1].querySelector("note > duration")!.textContent).toBe("64");
    expect(measures.every((measure) => measure.querySelector("voice") === null)).toBe(true);
    expect(input).toEqual(before);
  });

  it("isolates both voices and staves when their notes share measure numbers", () => {
    const input = score([
      { id: "upper", name: "Upper", clef: "treble", voices: [
        { id: "upper-lead", notes: [note("D5", 2), note("C5", 1)] },
        { id: "upper-harmony", notes: [note("G3", 2)] },
      ] },
      { id: "lower", name: "Lower", clef: "bass", voices: [
        { id: "lower-bass", notes: [note("A2", 3), note("F2", 1)] },
      ] },
    ]);
    const before = structuredClone(input);
    const xml = scoreToMusicXML(input);

    const upper = measuresFor(xml, "upper");
    const lower = measuresFor(xml, "lower");

    expect(upper.map(pitchesIn)).toEqual([["C5", "rest"], ["D5", "G3"], ["rest", "rest"]]);
    expect(upper.map((measure) => Array.from(measure.querySelectorAll("note > voice"), (voice) => voice.textContent)))
      .toEqual([["1", "2"], ["1", "2"], ["1", "2"]]);
    expect(upper.every((measure) => measure.querySelectorAll("backup").length === 1)).toBe(true);
    expect(lower.map(pitchesIn)).toEqual([["F2"], ["rest"], ["A2"]]);
    expect(lower.every((measure) => measure.querySelector("voice, backup") === null)).toBe(true);
    expect(input).toEqual(before);
  });

  it("retains a note at the last supported measure without filling earlier empty groups with it", () => {
    const input = score([{
      id: "ending", name: "Ending", clef: "treble",
      voices: [{ id: "ending-lead", notes: [note("B4", 200)] }],
    }], 200);

    const measures = measuresFor(scoreToMusicXML(input), "ending");

    expect(measures).toHaveLength(200);
    expect(measures.slice(0, 199).every((measure) => pitchesIn(measure).join() === "rest")).toBe(true);
    expect(pitchesIn(measures[199])).toEqual(["B4"]);
  });
});
