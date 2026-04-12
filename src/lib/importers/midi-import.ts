import { Score, Note, Staff, Voice } from "../schema";
import { v4 as uuidv4 } from "uuid";
import { Midi } from "@tonejs/midi";

// ── MIDI Import ───────────────────────────────────────────────────────────
//
// Converts a standard MIDI file (.mid) into a Score object.
// Key challenges:
//   - MIDI timing is continuous (ticks/seconds); notation needs discrete beats
//   - Note durations must snap to the notation grid (quantization)
//   - Each MIDI track becomes a staff with one voice

// ── Constants ─────────────────────────────────────────────────────────────

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Duration values in quarter-note beats
const DURATION_BEATS: { name: string; beats: number }[] = [
  { name: "whole", beats: 4 },
  { name: "half", beats: 3 },      // dotted half
  { name: "half", beats: 2 },
  { name: "quarter", beats: 1.5 },  // dotted quarter
  { name: "quarter", beats: 1 },
  { name: "eighth", beats: 0.75 },  // dotted eighth
  { name: "eighth", beats: 0.5 },
  { name: "sixteenth", beats: 0.25 },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function midiNoteToPitch(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

function quantizeBeat(beat: number, grid: number): number {
  return Math.round(beat / grid) * grid;
}

function snapDuration(
  durationBeats: number
): { duration: string; dots: number } {
  // Find closest matching duration
  let bestMatch = { name: "quarter", beats: 1 };
  let bestDiff = Infinity;

  for (const d of DURATION_BEATS) {
    const diff = Math.abs(durationBeats - d.beats);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestMatch = d;
    }
  }

  // Determine dots from the match
  const baseDurations: Record<string, number> = {
    whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25,
  };
  const base = baseDurations[bestMatch.name] ?? 1;
  const dots = bestMatch.beats > base ? 1 : 0;

  return { duration: bestMatch.name, dots };
}

// Detect key signature from the notes (simple heuristic)
function detectKeySignature(allMidiNotes: number[]): string {
  if (allMidiNotes.length === 0) return "C";

  // Count pitch classes
  const classes = new Array(12).fill(0);
  for (const n of allMidiNotes) classes[n % 12]++;

  // Simple major key detection: check which major scale fits best
  const majorScales: Record<string, number[]> = {
    C: [0, 2, 4, 5, 7, 9, 11],
    G: [7, 9, 11, 0, 2, 4, 6],
    D: [2, 4, 6, 7, 9, 11, 1],
    A: [9, 11, 1, 2, 4, 6, 8],
    E: [4, 6, 8, 9, 11, 1, 3],
    F: [5, 7, 9, 10, 0, 2, 4],
    Bb: [10, 0, 2, 3, 5, 7, 9],
    Eb: [3, 5, 7, 8, 10, 0, 2],
    Ab: [8, 10, 0, 1, 3, 5, 7],
  };

  let bestKey = "C";
  let bestScore = -1;

  for (const [key, scale] of Object.entries(majorScales)) {
    let score = 0;
    for (const pc of scale) score += classes[pc];
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestKey;
}

// Detect clef from pitch range
function detectClef(midiNotes: number[]): "treble" | "bass" {
  if (midiNotes.length === 0) return "treble";
  const avg = midiNotes.reduce((a, b) => a + b, 0) / midiNotes.length;
  return avg < 55 ? "bass" : "treble"; // Below G3 = bass clef
}

// ── Main Parser ───────────────────────────────────────────────────────────

export interface MidiImportOptions {
  /** Quantization grid in beats (default: 0.25 = sixteenth note) */
  quantizeGrid?: number;
  /** Only import tracks with these indices (0-based). Omit to import all non-empty tracks. */
  trackIndices?: number[];
  /** Maximum measures to import (default: 200) */
  maxMeasures?: number;
}

export function parseMidi(
  data: ArrayBuffer,
  options: MidiImportOptions = {}
): Score {
  const { quantizeGrid = 0.25, trackIndices, maxMeasures = 200 } = options;

  const midi = new Midi(data);

  // Extract tempo (use first tempo event, default 120)
  const tempo = midi.header.tempos.length > 0
    ? Math.round(midi.header.tempos[0].bpm)
    : 120;

  // Extract time signature (use first, default 4/4)
  let beats = 4;
  let beatType = 4;
  if (midi.header.timeSignatures.length > 0) {
    const ts = midi.header.timeSignatures[0].timeSignature;
    beats = ts[0];
    beatType = ts[1];
  }
  const timeSignature = `${beats}/${beatType}`;
  const beatsPerMeasure = beats * (4 / beatType); // in quarter-note beats

  // Filter tracks: only those with notes
  const tracksWithNotes = midi.tracks
    .map((track, idx) => ({ track, idx }))
    .filter(({ track }) => track.notes.length > 0);

  const selectedTracks = trackIndices
    ? tracksWithNotes.filter(({ idx }) => trackIndices.includes(idx))
    : tracksWithNotes;

  if (selectedTracks.length === 0) {
    throw new Error("No tracks with notes found in MIDI file.");
  }

  // Calculate total duration and number of measures
  let maxTime = 0;
  for (const { track } of selectedTracks) {
    for (const note of track.notes) {
      const end = note.time + note.duration;
      if (end > maxTime) maxTime = end;
    }
  }

  const secondsPerBeat = 60 / tempo;
  const totalBeats = maxTime / secondsPerBeat;
  const totalMeasures = Math.min(
    Math.max(1, Math.ceil(totalBeats / beatsPerMeasure)),
    maxMeasures
  );

  // Collect all MIDI note numbers for key detection
  const allMidiNotes: number[] = [];
  for (const { track } of selectedTracks) {
    for (const note of track.notes) allMidiNotes.push(note.midi);
  }
  const keySignature = detectKeySignature(allMidiNotes);

  // Build staves from tracks
  const staves: Staff[] = [];

  for (const { track, idx } of selectedTracks) {
    const trackMidiNotes = track.notes.map((n) => n.midi);
    const clef = detectClef(trackMidiNotes);
    const staffId = uuidv4();
    const voiceId = uuidv4();

    const trackName = track.name || `Track ${idx + 1}`;

    // Convert MIDI notes to Score notes
    const notes: Note[] = [];

    for (const midiNote of track.notes) {
      const beatPosition = midiNote.time / secondsPerBeat;
      const durationBeats = midiNote.duration / secondsPerBeat;

      // Quantize position
      const qBeat = quantizeBeat(beatPosition, quantizeGrid);
      const measure = Math.floor(qBeat / beatsPerMeasure) + 1;

      if (measure > totalMeasures) continue;

      const beatInMeasure = (qBeat % beatsPerMeasure) + 1; // 1-based

      // Snap duration
      const { duration, dots } = snapDuration(durationBeats);

      const pitch = midiNoteToPitch(midiNote.midi);

      notes.push({
        pitch,
        duration: duration as Note["duration"],
        dots,
        accidental: "none",
        tieStart: false,
        tieEnd: false,
        measure,
        beat: Math.round(beatInMeasure * 1000) / 1000, // clean float
      });
    }

    // Sort notes by measure then beat
    notes.sort((a, b) => a.measure - b.measure || a.beat - b.beat);

    // Fill empty measures with whole rests
    const measuresWithNotes = new Set(notes.map((n) => n.measure));
    for (let m = 1; m <= totalMeasures; m++) {
      if (!measuresWithNotes.has(m)) {
        notes.push({
          pitch: "rest",
          duration: beatsPerMeasure >= 4 ? "whole" : beatsPerMeasure >= 2 ? "half" : "quarter",
          dots: 0,
          accidental: "none",
          tieStart: false,
          tieEnd: false,
          measure: m,
          beat: 1,
        });
      }
    }

    // Re-sort after adding rests
    notes.sort((a, b) => a.measure - b.measure || a.beat - b.beat);

    const voice: Voice = {
      id: voiceId,
      role: clef === "bass" ? "bass" : "melody",
      notes,
    };

    staves.push({
      id: staffId,
      name: trackName,
      clef,
      lyricsMode: "attached",
      voices: [voice],
    });
  }

  // Build title from MIDI header or filename
  const title = midi.header.name || "Imported MIDI";

  return {
    id: uuidv4(),
    title,
    composer: "",
    tempo,
    timeSignature,
    keySignature: keySignature as Score["keySignature"],
    measures: totalMeasures,
    staves,
    chordSymbols: [],
    rehearsalMarks: [],
    repeats: [],
    metadata: { source: "midi-import" },
  };
}
