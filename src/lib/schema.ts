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
  "thirty-second",
  "sixty-fourth",
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

export const BeamState = z.enum(["begin", "continue", "end", "none"]);
export type BeamState = z.infer<typeof BeamState>;

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
  beam: BeamState.optional().describe('Override auto-beaming: begin/continue/end a beam group, or "none" to prevent beaming'),
  tuplet: z.object({
    actualNotes: z.number().int().min(2),
    normalNotes: z.number().int().min(1),
  }).optional().describe('Tuplet grouping, e.g. {actualNotes:3, normalNotes:2} for triplet'),
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

// ── Chord Chart (songbook) ─────────────────────────────────────────────────

/**
 * One visible line of a chord chart: a `chords` overlay (free-form, may contain
 * chord names like "D", "Am7" and bar markers "|", separated by spaces) and a
 * `lyrics` line below it. They're rendered in monospace so column N of the
 * chord line visually appears above column N of the lyric line — that's how
 * the user positions chord changes over specific syllables.
 *
 * Either field may be empty:
 *   - chords-only line (e.g. an instrumental bar pattern: "|D    |D    |")
 *   - lyrics-only line (e.g. a lyric phrase with no chord changes on it)
 *   - both empty = blank line (visual spacing)
 */
export const ChordChartLineSchema = z.object({
  chords: z.string().default(""),
  lyrics: z.string().default(""),
});
export type ChordChartLine = z.infer<typeof ChordChartLineSchema>;

export const ChordChartSectionSchema = z.object({
  id: z.string(),                                  // unique ID, e.g. "V" or "verse-1"
  label: z.string(),                               // human label, e.g. "Verse 1"
  lines: z.array(ChordChartLineSchema).default([]),
});
export type ChordChartSection = z.infer<typeof ChordChartSectionSchema>;

// ── Score (top-level) ──────────────────────────────────────────────────────

export const ScoreSchema = z.object({
  id: z.string(),
  title: z.string().default("Untitled Score"),
  composer: z.string().default(""),
  tempo: z.number().int().min(20).max(300).default(120),
  timeSignature: z.string().regex(/^\d+\/\d+$/).default("4/4"),
  keySignature: KeySignature.default("C"),
  measures: z.number().int().min(1).max(200).default(8),
  // Allow zero staves for chord-chart-only songs (the chord chart view doesn't
  // need a staff). Notation views guard against empty staves.
  staves: z.array(StaffSchema).default([]),
  chordSymbols: z.array(ChordSymbolSchema).default([]),
  rehearsalMarks: z.array(RehearsalMarkSchema).default([]),
  repeats: z.array(RepeatSchema).default([]),
  // Songbook / chord-chart structure. When `form` is non-empty, the app
  // renders a chord chart instead of staff notation. `form` is the ordered
  // sequence of section IDs that play (e.g. ["intro","V","V","C","V","C","B","V","C","C"]);
  // each ID must reference a section in `sections`.
  sections: z.array(ChordChartSectionSchema).default([]),
  form: z.array(z.string()).default([]),
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
  sections: z.array(ChordChartSectionSchema).optional(),
  form: z.array(z.string()).optional(),
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
    op: z.literal("add_notes"),
    staffId: z.string(),
    voiceId: z.string(),
    notes: z.array(NoteSchema),
  }),
  z.object({
    op: z.literal("update_note"),
    staffId: z.string(),
    voiceId: z.string(),
    measure: z.number().int().min(1),
    beat: z.number().min(1),
    pitch: z.string(),
    updates: z.object({
      tieStart: z.boolean().optional(),
      tieEnd: z.boolean().optional(),
      dots: z.number().int().min(0).max(2).optional(),
      accidental: z.enum(["sharp", "flat", "natural", "none"]).optional(),
      duration: NoteDuration.optional(),
      lyric: z.string().optional(),
      articulations: z.array(Articulation).optional(),
      beam: BeamState.optional(),
    }),
  }),
  z.object({
    op: z.literal("remove_note"),
    staffId: z.string(),
    voiceId: z.string(),
    measure: z.number().int().min(1),
    beat: z.number().min(1),
    pitch: z.string(),
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
