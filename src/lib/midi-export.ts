/**
 * MIDI export — convert a Score into a Type-1 MIDI file (#14).
 *
 * Strategy: one MIDI track per visible (non-hidden) staff. Tied notes are
 * merged into a single longer note on the starting beat. Dots and tuplets
 * scale durations; rests advance the playhead but emit no note.
 *
 * Tempo, time signature, and key signature are written into the header so
 * the imported result lines up with our internal representation.
 */

import { Midi } from "@tonejs/midi";
import { Score, Note } from "./schema";

const PITCH_TO_MIDI_BASE: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, F: 5,
  "E#": 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10,
  Bb: 10, B: 11, Cb: 11, "B#": 12,
};

const DUR_BEATS: Record<string, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25,
  "thirty-second": 0.125, "sixty-fourth": 0.0625,
};

/** Convert a scientific pitch ("C4", "F#3", "Bb5") into a MIDI number. */
function pitchToMidi(pitch: string): number | null {
  if (pitch === "rest") return null;
  const match = pitch.match(/^([A-G][b#]?)(-?\d+)$/);
  if (!match) return null;
  const [, name, octStr] = match;
  const base = PITCH_TO_MIDI_BASE[name];
  if (base === undefined) return null;
  const octave = parseInt(octStr, 10);
  return (octave + 1) * 12 + base;
}

/** Compute a note's duration in beats, accounting for dots and tuplets. */
function noteBeats(note: Note): number {
  let beats = DUR_BEATS[note.duration] ?? 1;
  if (note.dots === 1) beats *= 1.5;
  if (note.dots === 2) beats *= 1.75;
  if (note.tuplet) beats *= note.tuplet.normalNotes / note.tuplet.actualNotes;
  return beats;
}

export interface MidiExportOptions {
  /** Restrict export to a single staff id. When omitted, every visible
   *  (non-hidden) staff becomes its own MIDI track. */
  staffId?: string;
}

/** Build a Type-1 MIDI file from a Score. Returns the raw bytes ready to be
 *  saved with `new Blob([...])`. */
export function scoreToMidi(score: Score, options: MidiExportOptions = {}): Uint8Array {
  const midi = new Midi();
  const bpm = score.tempo || 120;
  midi.header.setTempo(bpm);

  const [tsNum, tsDen] = score.timeSignature.split("/").map(Number);
  // tonejs-midi expects a [num, den] tuple where den is the actual lower
  // number of the time signature (4 for 4/4, 8 for 6/8 etc).
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [tsNum, tsDen] });

  const beatsPerMeasure = tsNum * (4 / tsDen);
  const secPerBeat = 60 / bpm;

  const sourceStaves = score.staves.filter((s) => {
    if (s.hidden) return false;
    if (options.staffId && s.id !== options.staffId) return false;
    return true;
  });

  for (const staff of sourceStaves) {
    const track = midi.addTrack();
    track.name = staff.name;

    for (const voice of staff.voices) {
      // Sort notes by absolute beat position so tie chains can be resolved
      // forward — tie continuations are skipped after merging into the
      // starting note's duration.
      const sorted = [...voice.notes]
        .filter((n) => n.pitch !== "rest")
        .sort((a, b) => a.measure - b.measure || a.beat - b.beat);

      const skip = new Set<string>();
      for (const note of sorted) {
        if (note.tieEnd) {
          skip.add(`${note.measure}:${note.beat}:${note.pitch}`);
        }
      }

      for (const note of sorted) {
        const key = `${note.measure}:${note.beat}:${note.pitch}`;
        if (skip.has(key)) continue;

        const midiNum = pitchToMidi(note.pitch);
        if (midiNum == null) continue;

        // Walk the tie chain forward, accumulating duration onto the
        // starting note. Each subsequent tied note is already in `skip`
        // so it won't be emitted again.
        let beats = noteBeats(note);
        if (note.tieStart) {
          let current = note;
          while (current.tieStart) {
            const next = sorted.find((n) =>
              n.tieEnd &&
              n.pitch === current.pitch &&
              (n.measure > current.measure ||
                (n.measure === current.measure && n.beat > current.beat))
            );
            if (!next) break;
            beats += noteBeats(next);
            if (next.tieStart) current = next;
            else break;
          }
        }

        const measureOffset = (note.measure - 1) * beatsPerMeasure;
        const beatOffset = note.beat - 1;
        const timeSec = (measureOffset + beatOffset) * secPerBeat;
        const durSec = beats * secPerBeat;

        track.addNote({
          midi: midiNum,
          time: timeSec,
          duration: durSec,
          velocity: 0.78,
        });
      }
    }
  }

  return midi.toArray();
}

/** Convenience helper — bundles `scoreToMidi` with a download trigger.
 *  Pass an optional staffId to export a single staff. */
export function downloadScoreAsMidi(score: Score, options: MidiExportOptions = {}): void {
  const bytes = scoreToMidi(score, options);
  // Wrap in a fresh ArrayBuffer view so the Blob constructor accepts it
  // — the typed-array signature is fussy about SharedArrayBuffer overlap
  // even when the underlying buffer is a regular ArrayBuffer.
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buf], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const suffix = options.staffId
    ? `-${score.staves.find((s) => s.id === options.staffId)?.name || "staff"}`
    : "";
  a.href = url;
  a.download = `${score.title || "score"}${suffix}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
