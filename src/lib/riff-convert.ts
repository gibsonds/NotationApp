// ── Riff ⇄ Note conversion ──────────────────────────────────────────────────
//
// This module is the contract that stops riffs becoming a dead-end format.
//
// A riff stores `bars[].events[].notes[]` where an event carries `beat` and
// `duration` on exactly the conventions `Note` uses, and the bar index stands
// in for `Note.measure`. So a riff is a `Note[]` with measure factored out,
// plus string/fret. When the full tab staff lands (#31) — which adds
// `string`/`fret` to NoteSchema and `"tab"` to the Clef enum — migrating a
// riff onto a real staff is `riffToNotes`, with no data reshaping and no
// migration script. If this round-trip ever breaks, that absorption stops
// being cheap, which is why it's tested directly.

import type { Note, Riff, RiffBar, RiffNote } from "@/lib/schema";
import { DEFAULT_TUNING } from "@/lib/schema";

const SEMITONES: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** "G#3" → MIDI number. Returns null for anything unparseable. */
export function pitchToMidi(pitch: string): number | null {
  const m = /^([A-G][b#]?)(-?\d+)$/.exec(pitch.trim());
  if (!m) return null;
  const semi = SEMITONES[m[1]];
  if (semi === undefined) return null;
  return (parseInt(m[2], 10) + 1) * 12 + semi;
}

/** MIDI number → "G#3". */
export function midiToPitch(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${SHARP_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}

/**
 * Sounding pitch of a fretted note. `capo` raises every open string.
 * Returns null when the string isn't in the tuning.
 */
export function fretToPitch(
  note: Pick<RiffNote, "string" | "fret">,
  tuning: string[],
  capo = 0,
): string | null {
  const open = tuning[note.string - 1] ?? DEFAULT_TUNING[note.string - 1];
  if (!open) return null;
  const base = pitchToMidi(open);
  if (base === null) return null;
  return midiToPitch(base + note.fret + capo);
}

/**
 * Flatten a riff into staff notes. `measure` is the 1-based bar index, so the
 * result drops straight into a Voice.
 *
 * An explicit `note.pitch` wins over the tuning-derived one — a lifted or
 * MIDI-entered riff may know its real pitch (including enharmonic spelling)
 * better than fret arithmetic does.
 */
export function riffToNotes(riff: Riff): Note[] {
  const out: Note[] = [];
  const tuning = riff.tuning.length ? riff.tuning : [...DEFAULT_TUNING];
  riff.bars.forEach((bar, barIdx) => {
    for (const ev of bar.events) {
      if (ev.notes.length === 0) {
        out.push({
          pitch: "rest",
          duration: ev.duration,
          dots: ev.dots,
          accidental: "none",
          tieStart: false,
          tieEnd: false,
          measure: barIdx + 1,
          beat: ev.beat,
        });
        continue;
      }
      for (const n of ev.notes) {
        const pitch = n.pitch ?? fretToPitch(n, tuning, riff.capo ?? 0);
        if (!pitch) continue;
        out.push({
          pitch,
          duration: ev.duration,
          dots: ev.dots,
          accidental: "none",
          tieStart: n.tieStart ?? false,
          tieEnd: n.tieEnd ?? false,
          measure: barIdx + 1,
          beat: ev.beat,
        });
      }
    }
  });
  return out;
}

/**
 * Inverse of riffToNotes: group notes back into bars/events and assign each a
 * string+fret against `tuning`.
 *
 * Notes that can't be fretted on this tuning are dropped rather than clamped —
 * a wrong fret is worse than a missing one, and the caller (the editor) can
 * surface the count.
 */
export function notesToRiffBars(notes: Note[], tuning: string[] = [...DEFAULT_TUNING]): RiffBar[] {
  const byMeasure = new Map<number, Note[]>();
  for (const n of notes) {
    const list = byMeasure.get(n.measure) ?? [];
    list.push(n);
    byMeasure.set(n.measure, list);
  }
  if (byMeasure.size === 0) return [];

  const lastMeasure = Math.max(...byMeasure.keys());
  const bars: RiffBar[] = [];
  for (let m = 1; m <= lastMeasure; m++) {
    const inBar = (byMeasure.get(m) ?? []).slice().sort((a, b) => a.beat - b.beat);
    // Notes sharing a beat are one chord event.
    const byBeat = new Map<number, Note[]>();
    for (const n of inBar) {
      const list = byBeat.get(n.beat) ?? [];
      list.push(n);
      byBeat.set(n.beat, list);
    }
    const events = [...byBeat.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([beat, group]) => ({
        beat,
        duration: group[0].duration,
        dots: group[0].dots ?? 0,
        notes: group
          .filter((n) => n.pitch !== "rest")
          .map((n): RiffNote | null => {
            const f = pitchToFingering(n.pitch, tuning);
            return f ? { ...f, pitch: n.pitch } : null;
          })
          .filter((n): n is RiffNote => n !== null),
      }));
    bars.push({ events });
  }
  return bars;
}

/**
 * Choose a string+fret for a pitch. Greedy lowest playable position: prefer
 * the highest-numbered (lowest-pitched) string that can reach it without going
 * past `maxFret`, which is what a player's hand actually does for a riff in
 * first position.
 */
export function pitchToFingering(
  pitch: string,
  tuning: string[] = [...DEFAULT_TUNING],
  maxFret = 24,
): { string: number; fret: number } | null {
  const target = pitchToMidi(pitch);
  if (target === null) return null;
  let best: { string: number; fret: number } | null = null;
  for (let i = tuning.length - 1; i >= 0; i--) {
    const open = pitchToMidi(tuning[i]);
    if (open === null) continue;
    const fret = target - open;
    if (fret < 0 || fret > maxFret) continue;
    // Lower fret wins; ties go to the lower-pitched string (already favoured
    // by iterating from the bottom string upward).
    if (!best || fret < best.fret) best = { string: i + 1, fret };
  }
  return best;
}
