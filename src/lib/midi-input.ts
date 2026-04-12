"use client";

// ── Web MIDI API: real-time MIDI keyboard input ───────────────────────────
//
// Listens for MIDI note-on/note-off events from connected MIDI devices.
// Converts them into Note objects for the score.

import { Note } from "./schema";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiNumberToPitch(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

export interface MidiInputCallbacks {
  onNoteOn: (pitch: string, velocity: number, midiNumber: number) => void;
  onNoteOff: (pitch: string, midiNumber: number) => void;
  onDeviceConnected: (name: string) => void;
  onDeviceDisconnected: (name: string) => void;
  onError: (error: string) => void;
}

export class MidiKeyboardInput {
  private access: MIDIAccess | null = null;
  private callbacks: MidiInputCallbacks;
  private activeNotes = new Map<number, { pitch: string; startTime: number }>();
  private boundHandleMessage: (e: MIDIMessageEvent) => void;

  constructor(callbacks: MidiInputCallbacks) {
    this.callbacks = callbacks;
    this.boundHandleMessage = this.handleMessage.bind(this);
  }

  async connect(): Promise<string[]> {
    if (!navigator.requestMIDIAccess) {
      this.callbacks.onError("Web MIDI API not supported in this browser.");
      return [];
    }

    try {
      this.access = await navigator.requestMIDIAccess();

      // Listen for device changes
      this.access.onstatechange = (e) => {
        const port = e.port as MIDIInput;
        if (port.type !== "input") return;
        if (port.state === "connected") {
          port.onmidimessage = this.boundHandleMessage;
          this.callbacks.onDeviceConnected(port.name || "Unknown MIDI Device");
        } else {
          this.callbacks.onDeviceDisconnected(port.name || "Unknown MIDI Device");
        }
      };

      // Attach to all current inputs
      const names: string[] = [];
      this.access.inputs.forEach((input) => {
        input.onmidimessage = this.boundHandleMessage;
        names.push(input.name || "Unknown MIDI Device");
      });

      return names;
    } catch (err: any) {
      this.callbacks.onError(`MIDI access denied: ${err.message}`);
      return [];
    }
  }

  disconnect() {
    if (this.access) {
      this.access.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
      this.access.onstatechange = null;
    }
    this.activeNotes.clear();
  }

  getActiveNotes(): Map<number, { pitch: string; startTime: number }> {
    return this.activeNotes;
  }

  private handleMessage(e: MIDIMessageEvent) {
    const [status, data1, data2] = e.data!;
    const command = status & 0xf0;

    if (command === 0x90 && data2 > 0) {
      // Note On
      const pitch = midiNumberToPitch(data1);
      this.activeNotes.set(data1, { pitch, startTime: performance.now() });
      this.callbacks.onNoteOn(pitch, data2, data1);
    } else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      // Note Off
      const pitch = midiNumberToPitch(data1);
      this.activeNotes.delete(data1);
      this.callbacks.onNoteOff(pitch, data1);
    }
  }
}

// ── Duration snapping for recorded input ──────────────────────────────────

const DURATION_MS: { dur: Note["duration"]; dots: number; ms: number }[] = [
  // At 120 BPM, quarter = 500ms. These are BPM-independent ratios.
  { dur: "whole", dots: 0, ms: 4 },
  { dur: "half", dots: 1, ms: 3 },
  { dur: "half", dots: 0, ms: 2 },
  { dur: "quarter", dots: 1, ms: 1.5 },
  { dur: "quarter", dots: 0, ms: 1 },
  { dur: "eighth", dots: 1, ms: 0.75 },
  { dur: "eighth", dots: 0, ms: 0.5 },
  { dur: "sixteenth", dots: 0, ms: 0.25 },
];

/** Snap a duration (in beats) to the closest notation value */
export function snapToNoteDuration(
  durationMs: number,
  bpm: number
): { duration: Note["duration"]; dots: number } {
  const msPerBeat = 60000 / bpm;
  const beats = durationMs / msPerBeat;

  let best = DURATION_MS[DURATION_MS.length - 1];
  let bestDiff = Infinity;
  for (const entry of DURATION_MS) {
    const diff = Math.abs(beats - entry.ms);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }
  return { duration: best.dur, dots: best.dots };
}
