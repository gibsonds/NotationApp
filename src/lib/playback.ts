/**
 * Simple score playback using Web Audio API.
 * Plays notes sequentially by measure/beat using triangle oscillators.
 */

import { Score } from "./schema";
import { NoteSelection } from "./transforms";

const NOTE_FREQ: Record<string, number> = {};
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_MAP: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E" };

// Build frequency table for all MIDI range
for (let midi = 21; midi <= 108; midi++) {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[midi % 12];
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  NOTE_FREQ[`${name}${octave}`] = freq;
}

function pitchToFreq(pitch: string): number | null {
  if (pitch === "rest") return null;
  // Normalize flats
  const match = pitch.match(/^([A-G][b#]?)(\d+)$/);
  if (!match) return null;
  let [, name, oct] = match;
  if (FLAT_MAP[name]) name = FLAT_MAP[name];
  return NOTE_FREQ[`${name}${oct}`] || null;
}

const DUR_BEATS: Record<string, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25,
  "thirty-second": 0.125, "sixty-fourth": 0.0625,
};

export interface PlaybackState {
  isPlaying: boolean;
  currentMeasure: number;
  currentBeat: number;
}

let audioCtx: AudioContext | null = null;
let stopRequested = false;
let currentlyPlaying = false;

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

export function stopPlayback(): void {
  stopRequested = true;
}

export function isPlaying(): boolean {
  return currentlyPlaying;
}

export async function playScore(
  score: Score,
  selection: NoteSelection | null,
  onProgress?: (measure: number, beat: number) => void,
): Promise<void> {
  if (currentlyPlaying) {
    stopPlayback();
    // Wait for previous playback to finish
    await new Promise(r => setTimeout(r, 100));
  }

  stopRequested = false;
  currentlyPlaying = true;

  const ctx = getCtx();
  const bpm = score.tempo || 120;
  const secPerBeat = 60 / bpm;
  const [tsNum, tsDen] = score.timeSignature.split("/").map(Number);
  const beatsPerMeasure = tsNum * (4 / tsDen);

  const startMeasure = selection?.startMeasure ?? 1;
  const endMeasure = selection?.endMeasure ?? score.measures;
  const staffFilter = selection?.staffIds;

  // Collect all events: { time (in seconds from start), freq, duration (seconds) }
  interface PlayEvent { time: number; freq: number; durSec: number; measure: number; beat: number }
  const events: PlayEvent[] = [];

  for (const staff of score.staves) {
    if (staffFilter && !staffFilter.includes(staff.id)) continue;
    for (const voice of staff.voices) {
      // Sort notes by position for tie resolution
      const sorted = [...voice.notes]
        .filter(n => n.measure >= startMeasure && n.measure <= endMeasure && n.pitch !== "rest")
        .sort((a, b) => a.measure - b.measure || a.beat - b.beat);

      // Build events, merging tied notes
      // Track which notes are continuations of a tie (tieEnd=true) so we skip them
      const tieEndSet = new Set<string>(); // "measure:beat:pitch" keys for notes that are tie continuations

      // First pass: identify tie chains and mark continuations
      for (const note of sorted) {
        if (note.tieStart) {
          // Find the next note with same pitch that has tieEnd
          const nextTied = sorted.find(n =>
            n.tieEnd &&
            n.pitch === note.pitch &&
            (n.measure > note.measure || (n.measure === note.measure && n.beat > note.beat))
          );
          if (nextTied) {
            tieEndSet.add(`${nextTied.measure}:${nextTied.beat}:${nextTied.pitch}`);
          }
        }
      }

      for (const note of sorted) {
        // Skip notes that are tie continuations (they'll be absorbed into the starting note's duration)
        const key = `${note.measure}:${note.beat}:${note.pitch}`;
        if (tieEndSet.has(key)) continue;

        const freq = pitchToFreq(note.pitch);
        if (!freq) continue;

        let beats = DUR_BEATS[note.duration] || 1;
        if (note.dots === 1) beats *= 1.5;
        if (note.dots === 2) beats *= 1.75;

        // If this note starts a tie, accumulate duration from tied notes
        if (note.tieStart) {
          let current = note;
          while (current.tieStart) {
            const next = sorted.find(n =>
              n.tieEnd &&
              n.pitch === current.pitch &&
              (n.measure > current.measure || (n.measure === current.measure && n.beat > current.beat))
            );
            if (!next) break;
            let nextBeats = DUR_BEATS[next.duration] || 1;
            if (next.dots === 1) nextBeats *= 1.5;
            if (next.dots === 2) nextBeats *= 1.75;
            beats += nextBeats;
            // Continue chain if this tied note also starts a tie
            if (next.tieStart) {
              current = next;
            } else {
              break;
            }
          }
        }

        const measureOffset = (note.measure - startMeasure) * beatsPerMeasure;
        const beatOffset = note.beat - 1;
        const timeSec = (measureOffset + beatOffset) * secPerBeat;

        events.push({ time: timeSec, freq, durSec: beats * secPerBeat * 0.9, measure: note.measure, beat: note.beat });
      }
    }
  }

  events.sort((a, b) => a.time - b.time);

  const totalDuration = (endMeasure - startMeasure + 1) * beatsPerMeasure * secPerBeat;
  const startTime = ctx.currentTime + 0.05;

  // Schedule all notes
  const nodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  for (const ev of events) {
    const noteStart = startTime + ev.time;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, noteStart);
    gain.gain.linearRampToValueAtTime(0, noteStart + ev.durSec);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(ev.freq, noteStart);
    osc.connect(gain);
    osc.start(noteStart);
    osc.stop(noteStart + ev.durSec + 0.01);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    nodes.push({ osc, gain });
  }

  // Progress tracking loop
  const startWall = performance.now();
  while (!stopRequested) {
    const elapsed = (performance.now() - startWall) / 1000;
    if (elapsed >= totalDuration) break;

    const beatPos = elapsed / secPerBeat;
    const measure = startMeasure + Math.floor(beatPos / beatsPerMeasure);
    const beat = 1 + (beatPos % beatsPerMeasure);
    onProgress?.(measure, Math.round(beat * 100) / 100);

    await new Promise(r => setTimeout(r, 50));
  }

  // Stop all if stopped early
  if (stopRequested) {
    const now = ctx.currentTime;
    for (const n of nodes) {
      try {
        n.gain.gain.cancelScheduledValues(now);
        n.gain.gain.setValueAtTime(0, now);
        n.osc.stop(now + 0.01);
      } catch { /* already stopped */ }
    }
  }

  currentlyPlaying = false;
  onProgress?.(0, 0);
}
