import { z } from "zod";

// ── Enums ──────────────────────────────────────────────────────────────────

export const Clef = z.enum(["treble", "bass", "alto", "tenor"]);
export type Clef = z.infer<typeof Clef>;

export const NoteDuration = z.enum([
  "whole",
  "half",
  "quarter",
  "eighth",
  "sixteenth",
]);
export type NoteDuration = z.infer<typeof NoteDuration>;

export const KeySignature = z.enum([
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "Gb",
  "Db",
  "Ab",
  "Eb",
  "Bb",
  "F",
  "Am",
  "Em",
  "Bm",
  "F#m",
  "C#m",
  "G#m",
  "D#m",
  "Dm",
  "Gm",
  "Cm",
  "Fm",
  "Bbm",
  "Ebm",
]);
export type KeySignature = z.infer<typeof KeySignature>;

export const DynamicMarking = z.enum([
  "ppp",
  "pp",
  "p",
  "mp",
  "mf",
  "f",
  "ff",
  "fff",
]);
export type DynamicMarking = z.infer<typeof DynamicMarking>;

export const Articulation = z.enum([
  "accent",
  "strong-accent",
  "staccato",
  "staccatissimo",
  "tenuto",
  "detached-legato",
  "fermata",
]);
export type Articulation = z.infer<typeof Articulation>;

// ── Note ───────────────────────────────────────────────────────────────────

export const NoteSchema = z.object({
  pitch: z.string().describe('Scientific pitch notation, e.g. "G4", or "rest"'),
  duration: NoteDuration,
  dots: z.number().int().min(0).max(2).default(0),
  accidental: z.enum(["sharp", "flat", "natural", "none"]).default("none"),
  tieStart: z.boolean().default(false),
  tieEnd: z.boolean().default(false),
  lyric: z.string().optional(),
  dynamic: DynamicMarking.optional(),
  articulations: z.array(Articulation).optional(),
  measure: z.number().int().min(1),
  beat: z.number().min(1),
});
export type Note = z.infer<typeof NoteSchema>;

// ── Chord Symbol ───────────────────────────────────────────────────────────

export const ChordSymbolSchema = z.object({
  measure: z.number().int().min(1),
  beat: z.number().min(1),
  symbol: z.string().describe('e.g. "G", "Am7", "Cmaj7"'),
});
export type ChordSymbol = z.infer<typeof ChordSymbolSchema>;

// ── Voice ──────────────────────────────────────────────────────────────────

export const VoiceSchema = z.object({
  id: z.string(),
  role: z
    .enum(["melody", "harmony", "bass", "accompaniment", "general"])
    .default("general"),
  notes: z.array(NoteSchema).default([]),
});
export type Voice = z.infer<typeof VoiceSchema>;

// ── Staff ──────────────────────────────────────────────────────────────────

export const StaffSchema = z.object({
  id: z.string(),
  name: z.string(),
  clef: Clef,
  transposition: z.number().int().optional(),
  lyricsMode: z.enum(["attached", "none"]).default("attached"),
  voices: z.array(VoiceSchema).default([]),
});
export type Staff = z.infer<typeof StaffSchema>;

// ── Rehearsal Mark ─────────────────────────────────────────────────────────

export const RehearsalMarkSchema = z.object({
  measure: z.number().int().min(1),
  label: z.string(),
});
export type RehearsalMark = z.infer<typeof RehearsalMarkSchema>;

// ── Repeat ─────────────────────────────────────────────────────────────────

export const RepeatSchema = z.object({
  startMeasure: z.number().int().min(1),
  endMeasure: z.number().int().min(1),
  endings: z.array(z.number().int().min(1)).optional(),
});
export type Repeat = z.infer<typeof RepeatSchema>;

// ── Score (top-level) ──────────────────────────────────────────────────────

export const ScoreSchema = z.object({
  id: z.string(),
  title: z.string().default("Untitled Score"),
  composer: z.string().default(""),
  tempo: z.number().int().min(20).max(300).default(120),
  timeSignature: z.string().regex(/^\d+\/\d+$/).default("4/4"),
  keySignature: KeySignature.default("C"),
  measures: z.number().int().min(1).max(200).default(8),
  staves: z.array(StaffSchema).min(1),
  chordSymbols: z.array(ChordSymbolSchema).default([]),
  rehearsalMarks: z.array(RehearsalMarkSchema).default([]),
  repeats: z.array(RepeatSchema).default([]),
  metadata: z.record(z.string(), z.string()).default({}),
});
export type Score = z.infer<typeof ScoreSchema>;

// ── Score Intent (what the LLM outputs before expansion) ───────────────────

export const ScoreIntentSchema = z.object({
  title: z.string().optional(),
  composer: z.string().optional(),
  tempo: z.number().int().optional(),
  timeSignature: z.string().optional(),
  keySignature: KeySignature.optional(),
  measures: z.number().int().optional(),
  staves: z
    .array(
      z.object({
        name: z.string(),
        clef: Clef,
        lyricsMode: z.enum(["attached", "none"]).optional(),
        voices: z
          .array(
            z.object({
              role: z
                .enum([
                  "melody",
                  "harmony",
                  "bass",
                  "accompaniment",
                  "general",
                ])
                .optional(),
              notes: z.array(NoteSchema).optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
  chordSymbols: z.array(ChordSymbolSchema).optional(),
  rehearsalMarks: z.array(RehearsalMarkSchema).optional(),
  repeats: z.array(RepeatSchema).optional(),
});
export type ScoreIntent = z.infer<typeof ScoreIntentSchema>;

// ── Score Patch (for revisions) ────────────────────────────────────────────

export const ScorePatchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set_title"),
    value: z.string(),
  }),
  z.object({
    op: z.literal("set_tempo"),
    value: z.number().int(),
  }),
  z.object({
    op: z.literal("set_time_signature"),
    value: z.string(),
  }),
  z.object({
    op: z.literal("set_key_signature"),
    value: KeySignature,
  }),
  z.object({
    op: z.literal("set_measures"),
    value: z.number().int(),
  }),
  z.object({
    op: z.literal("update_staff"),
    staffId: z.string(),
    name: z.string().optional(),
    clef: Clef.optional(),
    lyricsMode: z.enum(["attached", "none"]).optional(),
  }),
  z.object({
    op: z.literal("add_staff"),
    staff: StaffSchema,
  }),
  z.object({
    op: z.literal("remove_staff"),
    staffId: z.string(),
  }),
  z.object({
    op: z.literal("set_notes"),
    staffId: z.string(),
    voiceId: z.string(),
    notes: z.array(NoteSchema),
  }),
  z.object({
    op: z.literal("set_chord_symbols"),
    chordSymbols: z.array(ChordSymbolSchema),
  }),
  z.object({
    op: z.literal("replace_score"),
    score: z.lazy(() => ScoreIntentSchema),
  }),
]);
export type ScorePatch = z.infer<typeof ScorePatchSchema>;
