import { describe, expect, it } from "vitest";
import {
  fretToPitch,
  midiToPitch,
  notesToRiffBars,
  pitchToFingering,
  pitchToMidi,
  riffToNotes,
} from "../riff-convert";
import { DEFAULT_TUNING, type Riff } from "../schema";

const TUNING = [...DEFAULT_TUNING];

function riff(over: Partial<Riff> = {}): Riff {
  return {
    id: "r1",
    label: "Riff",
    kind: "tab",
    tuning: TUNING,
    anchor: { sectionId: "v1", lineIdx: 0 },
    bars: [
      {
        events: [
          { beat: 1, duration: "quarter", dots: 0, notes: [{ string: 6, fret: 0 }] },
          { beat: 2, duration: "quarter", dots: 0, notes: [{ string: 6, fret: 3 }] },
        ],
      },
      {
        events: [
          { beat: 1, duration: "half", dots: 0, notes: [{ string: 5, fret: 2 }] },
        ],
      },
    ],
    visibility: "shared",
    source: "ascii",
    createdAt: 1,
    ...over,
  };
}

describe("pitch helpers", () => {
  it("round-trips pitch ⇄ midi", () => {
    for (const p of ["E2", "A2", "C4", "G#3", "B5"]) {
      expect(midiToPitch(pitchToMidi(p)!)).toBe(p);
    }
  });

  it("rejects unparseable pitches instead of guessing", () => {
    expect(pitchToMidi("H4")).toBeNull();
    expect(pitchToMidi("rest")).toBeNull();
  });

  it("frets a string up from its open pitch", () => {
    // Low E (string 6) open is E2; 3rd fret is G2.
    expect(fretToPitch({ string: 6, fret: 0 }, TUNING)).toBe("E2");
    expect(fretToPitch({ string: 6, fret: 3 }, TUNING)).toBe("G2");
    // String 1 open is E4.
    expect(fretToPitch({ string: 1, fret: 0 }, TUNING)).toBe("E4");
  });

  it("applies a capo to every string", () => {
    expect(fretToPitch({ string: 6, fret: 0 }, TUNING, 2)).toBe("F#2");
  });
});

describe("pitchToFingering", () => {
  it("picks the lowest fret that can reach the pitch", () => {
    // G2 is reachable at fret 3 on the low E string.
    expect(pitchToFingering("G2", TUNING)).toEqual({ string: 6, fret: 3 });
    // Open strings come back as fret 0.
    expect(pitchToFingering("A2", TUNING)).toEqual({ string: 5, fret: 0 });
  });

  it("returns null for a pitch below the instrument", () => {
    expect(pitchToFingering("C1", TUNING)).toBeNull();
  });

  it("returns null for an unparseable pitch rather than a wrong fret", () => {
    expect(pitchToFingering("banana", TUNING)).toBeNull();
  });
});

// This round-trip is the contract that lets issue #31's full tab staff absorb
// riffs instead of duplicating them. If it breaks, that absorption stops being
// cheap — which is the whole reason the riff model was shaped this way.
describe("riffToNotes / notesToRiffBars — the #31 bridge", () => {
  it("flattens bars to notes with measure = bar index + 1", () => {
    const notes = riffToNotes(riff());
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatchObject({ pitch: "E2", measure: 1, beat: 1, duration: "quarter" });
    expect(notes[1]).toMatchObject({ pitch: "G2", measure: 1, beat: 2 });
    expect(notes[2]).toMatchObject({ pitch: "B2", measure: 2, beat: 1, duration: "half" });
  });

  it("round-trips bars → notes → bars", () => {
    const original = riff();
    const back = notesToRiffBars(riffToNotes(original), TUNING);
    expect(back).toHaveLength(original.bars.length);
    const fingering = (bars: typeof back) =>
      bars.map((b) => b.events.map((e) => e.notes.map((n) => `${n.string}:${n.fret}`)));
    expect(fingering(back)).toEqual(fingering(original.bars));
  });

  it("prefers an explicit pitch over fret arithmetic", () => {
    // A lifted or MIDI-entered note may know its real spelling better than
    // string+fret does.
    const r = riff({
      bars: [{ events: [{ beat: 1, duration: "quarter", dots: 0, notes: [{ string: 6, fret: 3, pitch: "Ab2" }] }] }],
    });
    expect(riffToNotes(r)[0].pitch).toBe("Ab2");
  });

  it("emits a rest for an empty event", () => {
    const r = riff({ bars: [{ events: [{ beat: 1, duration: "quarter", dots: 0, notes: [] }] }] });
    expect(riffToNotes(r)[0]).toMatchObject({ pitch: "rest", measure: 1 });
  });

  it("groups notes sharing a beat into one chord event", () => {
    const bars = notesToRiffBars(
      [
        { pitch: "E2", duration: "quarter", dots: 0, accidental: "none", tieStart: false, tieEnd: false, measure: 1, beat: 1 },
        { pitch: "B2", duration: "quarter", dots: 0, accidental: "none", tieStart: false, tieEnd: false, measure: 1, beat: 1 },
      ],
      TUNING,
    );
    expect(bars[0].events).toHaveLength(1);
    expect(bars[0].events[0].notes).toHaveLength(2);
  });

  it("drops unfrettable notes rather than clamping them to a wrong fret", () => {
    const bars = notesToRiffBars(
      [{ pitch: "C1", duration: "quarter", dots: 0, accidental: "none", tieStart: false, tieEnd: false, measure: 1, beat: 1 }],
      TUNING,
    );
    expect(bars[0].events[0].notes).toEqual([]);
  });
});
