import { Score, Note } from "./schema";

// ── MIDI Constants ─────────────────────────────────────────────────────────

const TICKS_PER_QUARTER = 480;

const PITCH_MAP: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const DURATION_TICKS: Record<string, number> = {
  whole: TICKS_PER_QUARTER * 4,
  half: TICKS_PER_QUARTER * 2,
  quarter: TICKS_PER_QUARTER,
  eighth: TICKS_PER_QUARTER / 2,
  sixteenth: TICKS_PER_QUARTER / 4,
};

// ── Pitch to MIDI number ───────────────────────────────────────────────────

function pitchToMidi(pitch: string): number | null {
  if (pitch.toLowerCase() === "rest") return null;
  const match = pitch.match(/^([A-Ga-g])([#b]?)(\d+)$/);
  if (!match) return null;
  const step = match[1].toUpperCase();
  const alter = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const octave = parseInt(match[3], 10);
  return (octave + 1) * 12 + PITCH_MAP[step] + alter;
}

// ── Variable-length quantity encoding ──────────────────────────────────────

function writeVLQ(value: number): number[] {
  if (value < 0) value = 0;
  const bytes: number[] = [];
  bytes.push(value & 0x7f);
  value >>= 7;
  while (value > 0) {
    bytes.push((value & 0x7f) | 0x80);
    value >>= 7;
  }
  bytes.reverse();
  return bytes;
}

// ── Write helpers ──────────────────────────────────────────────────────────

function writeString(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i));
  }
  return bytes;
}

function write16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function write32(value: number): number[] {
  return [
    (value >> 24) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ];
}

// ── Build MIDI file ────────────────────────────────────────────────────────

export function scoreToMidi(score: Score): Uint8Array {
  const tracks: number[][] = [];

  // Tempo in microseconds per quarter note
  const usPerQuarter = Math.round(60000000 / (score.tempo || 120));

  // Time signature
  const [beatsStr, beatTypeStr] = score.timeSignature.split("/");
  const beats = parseInt(beatsStr, 10);
  const beatType = parseInt(beatTypeStr, 10);
  const beatTypePow = Math.log2(beatType);

  for (const staff of score.staves) {
    const trackData: number[] = [];
    let currentTick = 0;

    // Track name meta event
    const nameBytes = writeString(staff.name);
    trackData.push(...writeVLQ(0)); // delta 0
    trackData.push(0xff, 0x03); // track name
    trackData.push(...writeVLQ(nameBytes.length));
    trackData.push(...nameBytes);

    // Tempo meta event (on first track)
    if (tracks.length === 0) {
      trackData.push(...writeVLQ(0));
      trackData.push(0xff, 0x51, 0x03);
      trackData.push(
        (usPerQuarter >> 16) & 0xff,
        (usPerQuarter >> 8) & 0xff,
        usPerQuarter & 0xff
      );

      // Time signature meta event
      trackData.push(...writeVLQ(0));
      trackData.push(0xff, 0x58, 0x04);
      trackData.push(beats, beatTypePow, 24, 8);
    }

    // Collect all notes from all voices, sorted by time
    const allNotes: { note: Note; tick: number; duration: number }[] = [];

    for (const voice of staff.voices) {
      for (const note of voice.notes) {
        const measureStart = (note.measure - 1) * beats * TICKS_PER_QUARTER * (4 / beatType);
        const beatOffset = (note.beat - 1) * TICKS_PER_QUARTER * (4 / beatType);
        const tick = measureStart + beatOffset;

        let dur = DURATION_TICKS[note.duration] ?? TICKS_PER_QUARTER;
        let dotMul = dur;
        for (let d = 0; d < note.dots; d++) {
          dotMul /= 2;
          dur += dotMul;
        }

        allNotes.push({ note, tick, duration: dur });
      }
    }

    // Sort by tick
    allNotes.sort((a, b) => a.tick - b.tick);

    // Build note on/off events
    type MidiEvent = { tick: number; data: number[] };
    const events: MidiEvent[] = [];

    for (const { note, tick, duration } of allNotes) {
      const midi = pitchToMidi(note.pitch);
      if (midi === null) continue; // skip rests

      const velocity = 80;
      const channel = 0;

      events.push({
        tick,
        data: [0x90 | channel, midi, velocity], // note on
      });
      events.push({
        tick: tick + duration,
        data: [0x80 | channel, midi, 0], // note off
      });
    }

    // Sort events by tick (note-offs before note-ons at same tick)
    events.sort((a, b) => {
      if (a.tick !== b.tick) return a.tick - b.tick;
      const aIsOff = (a.data[0] & 0xf0) === 0x80 ? 0 : 1;
      const bIsOff = (b.data[0] & 0xf0) === 0x80 ? 0 : 1;
      return aIsOff - bIsOff;
    });

    // Write events with delta times
    currentTick = 0;
    for (const event of events) {
      const delta = event.tick - currentTick;
      trackData.push(...writeVLQ(Math.max(0, delta)));
      trackData.push(...event.data);
      currentTick = event.tick;
    }

    // End of track
    trackData.push(...writeVLQ(0));
    trackData.push(0xff, 0x2f, 0x00);

    tracks.push(trackData);
  }

  // Build MIDI file
  const fileData: number[] = [];

  // Header chunk
  fileData.push(...writeString("MThd"));
  fileData.push(...write32(6)); // header length
  fileData.push(...write16(1)); // format 1
  fileData.push(...write16(tracks.length));
  fileData.push(...write16(TICKS_PER_QUARTER));

  // Track chunks
  for (const track of tracks) {
    fileData.push(...writeString("MTrk"));
    fileData.push(...write32(track.length));
    fileData.push(...track);
  }

  return new Uint8Array(fileData);
}
