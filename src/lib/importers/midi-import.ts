import { Score, Note, Staff, Voice } from "../schema";
import { v4 as uuidv4 } from "uuid";
import { Midi } from "@tonejs/midi";

// ── MIDI Import ───────────────────────────────────────────────────────────
//
// Converts a standard MIDI file (.mid) into a Score object.
// Strategy: quantize MIDI events onto a beat grid, then fill each measure
// with notes and rests that exactly account for every beat.

// ── Constants ─────────────────────────────────────────────────────────────

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Allowed durations mapped to quarter-note-beat values
const SNAP_TABLE: { dur: Note["duration"]; dots: number; beats: number }[] = [
  { dur: "whole",      dots: 0, beats: 4 },
  { dur: "half",       dots: 1, beats: 3 },
  { dur: "half",       dots: 0, beats: 2 },
  { dur: "quarter",    dots: 1, beats: 1.5 },
  { dur: "quarter",    dots: 0, beats: 1 },
  { dur: "eighth",     dots: 1, beats: 0.75 },
  { dur: "eighth",     dots: 0, beats: 0.5 },
  { dur: "sixteenth",  dots: 0, beats: 0.25 },
];

// Duration → beats lookup
const DUR_BEATS: Record<string, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25, "thirty-second": 0.125, "sixty-fourth": 0.0625,
};

// ── Helpers ───────────────────────────────────────────────────────────────

function midiNoteToPitch(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

function quantizeBeat(beat: number, grid: number): number {
  return Math.round(beat / grid) * grid;
}

/** Snap a beat-duration to the closest allowed notation value. */
function snapDuration(durationBeats: number): { dur: Note["duration"]; dots: number; beats: number } {
  let best = SNAP_TABLE[SNAP_TABLE.length - 1]; // sixteenth as fallback
  let bestDiff = Infinity;
  for (const entry of SNAP_TABLE) {
    const diff = Math.abs(durationBeats - entry.beats);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }
  return best;
}

/**
 * Fill a measure's worth of beats with rests.
 * Returns note objects that exactly cover `beats` quarter-note beats.
 */
function fillRests(measure: number, startBeat: number, beatsToFill: number): Note[] {
  const rests: Note[] = [];
  let remaining = Math.round(beatsToFill * 4) / 4; // snap to sixteenth grid
  let beat = startBeat;

  while (remaining > 0.001) {
    // Pick the largest duration that fits
    let picked = SNAP_TABLE[SNAP_TABLE.length - 1];
    for (const entry of SNAP_TABLE) {
      if (entry.beats <= remaining + 0.001) {
        picked = entry;
        break;
      }
    }
    rests.push({
      pitch: "rest",
      duration: picked.dur,
      dots: picked.dots,
      accidental: "none",
      tieStart: false,
      tieEnd: false,
      measure,
      beat: Math.round(beat * 1000) / 1000,
    });
    beat += picked.beats;
    remaining -= picked.beats;
  }
  return rests;
}

// Detect key signature from pitch class histogram
function detectKeySignature(allMidiNotes: number[]): string {
  if (allMidiNotes.length === 0) return "C";
  const classes = new Array(12).fill(0);
  for (const n of allMidiNotes) classes[n % 12]++;

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
    if (score > bestScore) { bestScore = score; bestKey = key; }
  }
  return bestKey;
}

function detectClef(midiNotes: number[]): "treble" | "bass" {
  if (midiNotes.length === 0) return "treble";
  const avg = midiNotes.reduce((a, b) => a + b, 0) / midiNotes.length;
  return avg < 55 ? "bass" : "treble";
}

// ── Main Parser ───────────────────────────────────────────────────────────

export interface MidiImportOptions {
  quantizeGrid?: number;
  trackIndices?: number[];
  maxMeasures?: number;
}

export function parseMidi(
  data: ArrayBuffer,
  options: MidiImportOptions = {}
): Score {
  const { quantizeGrid = 0.25, trackIndices, maxMeasures = 200 } = options;

  const uint8 = new Uint8Array(data);
  const midi = new Midi(uint8);

  // Tempo
  const tempo = midi.header.tempos.length > 0
    ? Math.round(midi.header.tempos[0].bpm)
    : 120;

  // Time signature
  let beats = 4;
  let beatType = 4;
  if (midi.header.timeSignatures.length > 0) {
    const ts = midi.header.timeSignatures[0].timeSignature;
    beats = ts[0];
    beatType = ts[1];
  }
  const timeSignature = `${beats}/${beatType}`;
  const beatsPerMeasure = beats * (4 / beatType);
  const secondsPerBeat = 60 / tempo;

  // Select tracks
  const tracksWithNotes = midi.tracks
    .map((track, idx) => ({ track, idx }))
    .filter(({ track }) => track.notes.length > 0);

  const selectedTracks = trackIndices
    ? tracksWithNotes.filter(({ idx }) => trackIndices.includes(idx))
    : tracksWithNotes;

  if (selectedTracks.length === 0) {
    throw new Error("No tracks with notes found in MIDI file.");
  }

  // Total duration → measure count
  let maxTime = 0;
  for (const { track } of selectedTracks) {
    for (const note of track.notes) {
      const end = note.time + note.duration;
      if (end > maxTime) maxTime = end;
    }
  }
  const totalBeats = maxTime / secondsPerBeat;
  const totalMeasures = Math.min(
    Math.max(1, Math.ceil(totalBeats / beatsPerMeasure)),
    maxMeasures
  );

  // Key detection
  const allMidiNotes: number[] = [];
  for (const { track } of selectedTracks) {
    for (const note of track.notes) allMidiNotes.push(note.midi);
  }
  const keySignature = detectKeySignature(allMidiNotes);

  // Build staves — separate overlapping notes into distinct voices/staves
  const staves: Staff[] = [];

  for (const { track, idx } of selectedTracks) {
    // Make track names unique
    const rawName = track.name || `Track ${idx + 1}`;
    const nameCount = staves.filter((s) => s.name === rawName || s.name.startsWith(rawName + " (")).length;
    const trackBaseName = nameCount > 0 ? `${rawName} (${nameCount + 1})` : rawName;

    // Step 1: Quantize all MIDI notes
    type QNote = {
      pitch: string;
      midi: number;
      measure: number;
      beat: number;
      durBeats: number;
      startBeat: number; // absolute beat position for overlap detection
    };
    const qNotes: QNote[] = [];

    for (const midiNote of track.notes) {
      const beatPos = midiNote.time / secondsPerBeat;
      const durBeats = midiNote.duration / secondsPerBeat;
      const qBeat = quantizeBeat(beatPos, quantizeGrid);
      const measure = Math.floor(qBeat / beatsPerMeasure) + 1;
      if (measure < 1 || measure > totalMeasures) continue;

      const beatInMeasure = (qBeat % beatsPerMeasure) + 1;
      const remainingInMeasure = beatsPerMeasure - (beatInMeasure - 1);
      const clampedDur = Math.min(durBeats, remainingInMeasure);
      if (clampedDur < 0.125) continue;

      qNotes.push({
        pitch: midiNoteToPitch(midiNote.midi),
        midi: midiNote.midi,
        measure,
        beat: Math.round(beatInMeasure * 4) / 4,
        durBeats: clampedDur,
        startBeat: qBeat,
      });
    }

    // Step 2: Separate into voices using greedy allocation
    // Each voice tracks when it's "free" (endBeat). When a note overlaps,
    // it goes to the next available voice. Highest pitch = voice 0 (lead).
    qNotes.sort((a, b) => a.startBeat - b.startBeat || b.midi - a.midi);

    type VoiceBucket = { notes: QNote[]; endBeat: number };
    const voiceBuckets: VoiceBucket[] = [];

    for (const qn of qNotes) {
      // Find a voice that's free at this beat
      let assigned = false;
      for (const bucket of voiceBuckets) {
        if (qn.startBeat >= bucket.endBeat - 0.01) {
          bucket.notes.push(qn);
          bucket.endBeat = qn.startBeat + qn.durBeats;
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        voiceBuckets.push({
          notes: [qn],
          endBeat: qn.startBeat + qn.durBeats,
        });
      }
    }

    // Filter out voice buckets with very few notes (likely artifacts)
    const MIN_VOICE_NOTES = 10;
    const filteredBuckets = voiceBuckets.filter(
      (b, i) => i === 0 || b.notes.length >= MIN_VOICE_NOTES
    );

    // Step 3: Create a staff per voice (if polyphonic) or single staff
    const isPolyphonic = filteredBuckets.length > 1;

    for (let vi = 0; vi < filteredBuckets.length; vi++) {
      const bucket = filteredBuckets[vi];
      const staffId = uuidv4();
      const voiceId = uuidv4();

      const voiceMidi = bucket.notes.map((n) => n.midi);
      const clef = detectClef(voiceMidi);

      let staffName: string;
      if (!isPolyphonic) {
        staffName = trackBaseName;
      } else if (vi === 0) {
        staffName = `${trackBaseName} - Lead`;
      } else {
        staffName = `${trackBaseName} - Harmony ${vi}`;
      }

      // Build notes for this voice, filling gaps with rests
      const scoreNotes: Note[] = [];

      for (let m = 1; m <= totalMeasures; m++) {
        const measureNotes = bucket.notes
          .filter((n) => n.measure === m)
          .sort((a, b) => a.beat - b.beat);

        if (measureNotes.length === 0) {
          scoreNotes.push(...fillRests(m, 1, beatsPerMeasure));
          continue;
        }

        let cursor = 1;
        for (const qn of measureNotes) {
          const gap = qn.beat - cursor;
          if (gap > 0.001) {
            scoreNotes.push(...fillRests(m, cursor, gap));
            cursor += gap;
          }
          if (qn.beat < cursor - 0.001) continue;

          const snapped = snapDuration(qn.durBeats);
          scoreNotes.push({
            pitch: qn.pitch,
            duration: snapped.dur,
            dots: snapped.dots,
            accidental: "none",
            tieStart: false,
            tieEnd: false,
            measure: m,
            beat: Math.round(cursor * 1000) / 1000,
          });
          cursor += snapped.beats;
        }

        const remaining = beatsPerMeasure - (cursor - 1);
        if (remaining > 0.001) {
          scoreNotes.push(...fillRests(m, cursor, remaining));
        }
      }

      const voice: Voice = {
        id: voiceId,
        role: vi === 0 ? "melody" : "harmony",
        notes: scoreNotes,
      };

      staves.push({
        id: staffId,
        name: staffName,
        clef,
        lyricsMode: "none",
        voices: [voice],
      });
    }
  }

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
