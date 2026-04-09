import { Score, Note } from "./schema";

/**
 * Selection: a range of measures and optionally specific staves.
 * If staves is empty/undefined, applies to all staves.
 */
export interface NoteSelection {
  startMeasure: number;
  endMeasure: number;
  staffIds?: string[];
}

export type TransformFn = (note: Note) => Note;

// ── Enharmonic maps ────────────────────────────────────────────────────────

const SHARP_TO_FLAT: Record<string, string> = {
  "C#": "Db",
  "D#": "Eb",
  "F#": "Gb",
  "G#": "Ab",
  "A#": "Bb",
  // Double sharps
  "C##": "D",
  "D##": "E",
  "F##": "G",
  "G##": "A",
  "A##": "B",
  "B#": "C",  // octave shifts handled below
  "E#": "F",
};

const FLAT_TO_SHARP: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
  Cb: "B",  // octave shifts handled below
  Fb: "E",
  Dbb: "C",
  Ebb: "D",
  Gbb: "F",
  Abb: "G",
  Bbb: "A",
};

function parsePitchParts(pitch: string): { letter: string; accidental: string; octave: number } | null {
  if (pitch.toLowerCase() === "rest") return null;
  const match = pitch.match(/^([A-G])(#{1,2}|b{1,2})?(\d+)$/);
  if (!match) return null;
  return {
    letter: match[1],
    accidental: match[2] || "",
    octave: parseInt(match[3], 10),
  };
}

// ── Transform: Respell sharps as flats ─────────────────────────────────────

export function respellSharpsToFlats(note: Note): Note {
  const parts = parsePitchParts(note.pitch);
  if (!parts || !parts.accidental.includes("#")) return note;

  const key = parts.letter + parts.accidental;
  const enharmonic = SHARP_TO_FLAT[key];
  if (!enharmonic) return note;

  let octave = parts.octave;
  // B# -> C requires octave bump
  if (key === "B#") octave += 1;

  const newAccidental = enharmonic.includes("b") ? "flat" as const : "none" as const;
  const newPitch = `${enharmonic}${octave}`;

  return { ...note, pitch: newPitch, accidental: newAccidental };
}

// ── Transform: Respell flats as sharps ─────────────────────────────────────

export function respellFlatsToSharps(note: Note): Note {
  const parts = parsePitchParts(note.pitch);
  if (!parts || !parts.accidental.includes("b")) return note;

  const key = parts.letter + parts.accidental;
  const enharmonic = FLAT_TO_SHARP[key];
  if (!enharmonic) return note;

  let octave = parts.octave;
  // Cb -> B requires octave drop
  if (key === "Cb") octave -= 1;

  const newAccidental = enharmonic.includes("#") ? "sharp" as const : "none" as const;
  const newPitch = `${enharmonic}${octave}`;

  return { ...note, pitch: newPitch, accidental: newAccidental };
}

// ── Transform: Transpose by semitones ──────────────────────────────────────

const CHROMATIC_SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CHROMATIC_FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function pitchToSemitone(letter: string, accidental: string): number {
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let semi = base[letter] ?? 0;
  for (const ch of accidental) {
    if (ch === "#") semi++;
    if (ch === "b") semi--;
  }
  return ((semi % 12) + 12) % 12;
}

export function transposeBy(semitones: number, preferFlats = false): TransformFn {
  return (note: Note): Note => {
    const parts = parsePitchParts(note.pitch);
    if (!parts) return note; // rest

    const currentSemi = pitchToSemitone(parts.letter, parts.accidental);
    const newSemi = ((currentSemi + semitones) % 12 + 12) % 12;
    const octaveShift = Math.floor((currentSemi + semitones) / 12);
    const newOctave = parts.octave + octaveShift;

    const chromatic = preferFlats ? CHROMATIC_FLATS : CHROMATIC_SHARPS;
    const newName = chromatic[newSemi];
    const newAccidental = newName.includes("#") ? "sharp" as const
      : newName.includes("b") ? "flat" as const : "none" as const;

    return {
      ...note,
      pitch: `${newName}${newOctave}`,
      accidental: newAccidental,
    };
  };
}

// ── Apply transform to score ───────────────────────────────────────────────

export function applyTransform(
  score: Score,
  transform: TransformFn,
  selection?: NoteSelection
): Score {
  return {
    ...score,
    staves: score.staves.map((staff) => {
      if (selection?.staffIds && !selection.staffIds.includes(staff.id)) {
        return staff;
      }

      return {
        ...staff,
        voices: staff.voices.map((voice) => ({
          ...voice,
          notes: voice.notes.map((note) => {
            if (selection) {
              if (note.measure < selection.startMeasure || note.measure > selection.endMeasure) {
                return note;
              }
            }
            return transform(note);
          }),
        })),
      };
    }),
  };
}

// ── Built-in command registry ──────────────────────────────────────────────

export interface BuiltinCommand {
  name: string;
  description: string;
  execute: (score: Score, selection?: NoteSelection) => Score;
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    name: "sharps-to-flats",
    description: "Respell all sharps as enharmonic flats",
    execute: (score, sel) => applyTransform(score, respellSharpsToFlats, sel),
  },
  {
    name: "flats-to-sharps",
    description: "Respell all flats as enharmonic sharps",
    execute: (score, sel) => applyTransform(score, respellFlatsToSharps, sel),
  },
  {
    name: "transpose-up-half",
    description: "Transpose up by one semitone",
    execute: (score, sel) => applyTransform(score, transposeBy(1), sel),
  },
  {
    name: "transpose-down-half",
    description: "Transpose down by one semitone",
    execute: (score, sel) => applyTransform(score, transposeBy(-1, true), sel),
  },
  {
    name: "transpose-up-octave",
    description: "Transpose up by one octave",
    execute: (score, sel) => applyTransform(score, transposeBy(12), sel),
  },
  {
    name: "transpose-down-octave",
    description: "Transpose down by one octave",
    execute: (score, sel) => applyTransform(score, transposeBy(-12), sel),
  },
];

/**
 * Check if a user prompt matches a built-in command.
 * Returns the command if matched, null otherwise.
 */
export function matchBuiltinCommand(prompt: string): BuiltinCommand | null {
  const lower = prompt.toLowerCase().trim();

  // Sharps to flats
  if (
    lower.includes("sharp") && lower.includes("flat") &&
    (lower.includes("to") || lower.includes("as") || lower.includes("change") || lower.includes("respell"))
  ) {
    if (lower.indexOf("sharp") < lower.indexOf("flat")) {
      return BUILTIN_COMMANDS.find((c) => c.name === "sharps-to-flats")!;
    } else {
      return BUILTIN_COMMANDS.find((c) => c.name === "flats-to-sharps")!;
    }
  }

  // # to b / b to #
  if (/[#♯].*(?:to|->|→|as).*[b♭]/.test(lower) || /sharp.*(?:to|as).*flat/.test(lower)) {
    return BUILTIN_COMMANDS.find((c) => c.name === "sharps-to-flats")!;
  }
  if (/[b♭].*(?:to|->|→|as).*[#♯]/.test(lower) || /flat.*(?:to|as).*sharp/.test(lower)) {
    return BUILTIN_COMMANDS.find((c) => c.name === "flats-to-sharps")!;
  }

  // Enharmonic + flats/sharps
  if (lower.includes("enharmonic") && lower.includes("flat")) {
    return BUILTIN_COMMANDS.find((c) => c.name === "sharps-to-flats")!;
  }
  if (lower.includes("enharmonic") && lower.includes("sharp")) {
    return BUILTIN_COMMANDS.find((c) => c.name === "flats-to-sharps")!;
  }

  // Transpose
  if (lower.includes("transpose") || lower.includes("shift")) {
    if (lower.includes("octave")) {
      if (lower.includes("down")) {
        return BUILTIN_COMMANDS.find((c) => c.name === "transpose-down-octave")!;
      }
      return BUILTIN_COMMANDS.find((c) => c.name === "transpose-up-octave")!;
    }
    if (lower.includes("half") || lower.includes("semi")) {
      if (lower.includes("down")) {
        return BUILTIN_COMMANDS.find((c) => c.name === "transpose-down-half")!;
      }
      return BUILTIN_COMMANDS.find((c) => c.name === "transpose-up-half")!;
    }
  }

  return null;
}
