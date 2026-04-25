/**
 * Simple Web Audio API synthesizer for MIDI keyboard playback.
 * Single triangle oscillator per note, clean start/stop.
 */

import { debugLog } from "./debug-log";

let audioCtx: AudioContext | null = null;
const activeNotes = new Map<number, { osc: OscillatorNode; gain: GainNode }>();

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function midiToFrequency(midiNumber: number): number {
  return 440 * Math.pow(2, (midiNumber - 69) / 12);
}

export function noteOn(midiNumber: number, velocity: number = 100): void {
  const wasActive = activeNotes.has(midiNumber);
  debugLog(`[AUDIO noteOn] midi=${midiNumber} vel=${velocity} wasActive=${wasActive} totalActive=${activeNotes.size}`);

  // Stop any existing sound for this note first
  noteOff(midiNumber);

  const ctx = getAudioContext();
  const freq = midiToFrequency(midiNumber);
  // Cap volume to avoid loud blasts
  const vol = Math.min((velocity / 127) * 0.15, 0.15);
  const now = ctx.currentTime;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, now);
  gain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, now);
  osc.connect(gain);
  osc.start(now);

  // Auto-disconnect when stopped
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };

  activeNotes.set(midiNumber, { osc, gain });
  debugLog(`[AUDIO noteOn] started freq=${freq.toFixed(1)}Hz vol=${vol.toFixed(3)} totalActive=${activeNotes.size}`);
}

export function noteOff(midiNumber: number): void {
  const entry = activeNotes.get(midiNumber);
  if (!entry) {
    debugLog(`[AUDIO noteOff] midi=${midiNumber} — not active, skip`);
    return;
  }
  activeNotes.delete(midiNumber);
  debugLog(`[AUDIO noteOff] midi=${midiNumber} stopping, remaining=${activeNotes.size}`);

  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // Immediate ramp to zero then stop
  entry.gain.gain.cancelScheduledValues(now);
  entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
  entry.gain.gain.linearRampToValueAtTime(0, now + 0.02);
  entry.osc.stop(now + 0.03);
}

export function allNotesOff(): void {
  for (const midiNumber of [...activeNotes.keys()]) {
    noteOff(midiNumber);
  }
}
