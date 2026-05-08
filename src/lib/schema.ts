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

export const StemDirection = z.enum(["auto", "up", "down"]);
export type StemDirection = z.infer<typeof StemDirection>;

export const NoteSchema = z.object({
  pitch: z.string().describe('Scientific pitch notation, e.g. "G4", or "rest"'),
  duration: NoteDuration,
  dots: z.number().int().min(0).max(2).default(0),
  accidental: z.enum(["sharp", "flat", "natural", "none"]).default("none"),
  tieStart: z.boolean().default(false),
  tieEnd: z.boolean().default(false),
  /** Note begins a slur (curved phrase mark) that ends on the next note
   *  with slurEnd=true. Distinct from a tie: a slur connects different
   *  pitches into a phrase, a tie joins identical pitches into one. */
  slurStart: z.boolean().optional(),
  slurEnd: z.boolean().optional(),
  lyric: z.string().optional(),
  dynamic: DynamicMarking.optional(),
  articulations: z.array(Articulation).optional(),
  stemDirection: StemDirection.optional().describe('Override automatic stem direction'),
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
  /** When true, the staff is silent during playback. Doesn't affect
   *  rendering — the notes still appear on screen. */
  muted: z.boolean().default(false).optional(),
  /** When true, the staff is omitted from the rendered score (and from
   *  print/export). The staff still exists in the data model so its
   *  notes are preserved; toggle off to bring it back. */
  hidden: z.boolean().default(false).optional(),
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
  /** Whole-line performance markings (legacy). When true, the entire
   *  line is highlighted/underlined. Per-word markers below take
   *  precedence in the UI but `highlight: true` still renders correctly
   *  for older saved scores. */
  highlight: z.boolean().optional(),
  underline: z.boolean().optional(),
  /** Per-word highlight ranges as [startCol, endColExclusive] pairs into
   *  the lyric string. e.g. [[5, 10], [16, 21]] highlights two words. */
  highlightRanges: z.array(z.tuple([z.number().int(), z.number().int()])).optional(),
  underlineRanges: z.array(z.tuple([z.number().int(), z.number().int()])).optional(),
});
export type ChordChartLine = z.infer<typeof ChordChartLineSchema>;

/** Navigation marks attached to a chord-chart section. Common songbook
 *  signals like "go back to start" (D.C.) or "end here" (Fine). Rendered
 *  next to the section label in the editor and perform view. */
export const ChordChartNavMark = z.enum([
  "segno",         // 𝄋 — target marker for D.S.
  "coda",          // 𝄌 — target marker for Coda jump
  "to-coda",       // jump to Coda from end of this section
  "fine",          // end the song here on a D.C./D.S.
  "d.c.",          // Da Capo — go to start
  "d.s.",          // Dal Segno — go to Segno
  "d.c. al fine",
  "d.s. al fine",
  "d.c. al coda",
  "d.s. al coda",
]);
export type ChordChartNavMark = z.infer<typeof ChordChartNavMark>;

export const ChordChartSectionSchema = z.object({
  id: z.string(),                                  // unique ID, e.g. "V" or "verse-1"
  label: z.string(),                               // human label, e.g. "Verse 1"
  lines: z.array(ChordChartLineSchema).default([]),
  /** Open repeat (𝄆) at the start of this section. */
  repeatStart: z.boolean().optional(),
  /** Close repeat (𝄇) at the end of this section. */
  repeatEnd: z.boolean().optional(),
  /** Volta number for first/second-ending brackets. Optional 1..4. */
  endingNumber: z.number().int().min(1).max(4).optional(),
  /** Navigation mark attached to this section. */
  navMark: ChordChartNavMark.optional(),
});
export type ChordChartSection = z.infer<typeof ChordChartSectionSchema>;

// ── Annotation ─────────────────────────────────────────────────────────────

export const AnnotationSchema = z.object({
  id: z.string(),
  anchorX: z.number().min(0).max(1),
  anchorY: z.number().min(0).max(1),
  text: z.string(),
  color: z.enum(["yellow", "blue", "pink", "green"]).default("yellow"),
  visibility: z.enum(["shared", "personal"]).default("shared"),
  label: z.string().default(""),
  createdAt: z.number(),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

// ── Mid-score changes ─────────────────────────────────────────────────────
//
// At a given measure, override the score's tempo / time signature / key
// signature. Multiple changes at the same measure stack into one (later
// fields win). Renderer reads these as MusicXML <sound tempo>, <time>,
// and <key> elements emitted at the measure boundary. Playback honors
// the tempo override starting at that measure.

export const MeasureChangeSchema = z.object({
  /** 1-indexed bar number where the change takes effect. */
  measure: z.number().int().min(1),
  tempo: z.number().int().min(20).max(300).optional(),
  timeSignature: z.string().regex(/^\d+\/\d+$/).optional(),
  keySignature: KeySignature.optional(),
});
export type MeasureChange = z.infer<typeof MeasureChangeSchema>;

// ── Score (top-level) ──────────────────────────────────────────────────────

export const ScoreSchema = z.object({
  id: z.string(),
  title: z.string().default("Untitled Score"),
  composer: z.string().default(""),
  tempo: z.number().int().min(20).max(300).default(120),
  timeSignature: z.string().regex(/^\d+\/\d+$/).default("4/4"),
  keySignature: KeySignature.default("C"),
  measures: z.number().int().min(1).max(200).default(8),
  /** When true, the first measure is treated as a pickup (anacrusis) —
   *  bar numbering shifts so the first full bar is labeled 1 (the pickup
   *  becomes 0). The pickup itself can hold fewer beats than the time
   *  signature would otherwise require. */
  anacrusis: z.boolean().default(false),
  // Allow zero staves for chord-chart-only songs (the chord chart view doesn't
  // need a staff). Notation views guard against empty staves.
  staves: z.array(StaffSchema).default([]),
  chordSymbols: z.array(ChordSymbolSchema).default([]),
  rehearsalMarks: z.array(RehearsalMarkSchema).default([]),
  repeats: z.array(RepeatSchema).default([]),
  /** Mid-score overrides for tempo / time signature / key signature.
   *  Each entry takes effect at its `measure` and stays until the next
   *  override of the same field (or the end of the score). */
  measureChanges: z.array(MeasureChangeSchema).default([]),
  // Songbook / chord-chart structure. When `form` is non-empty, the app
  // renders a chord chart instead of staff notation. `form` is the ordered
  // sequence of section IDs that play (e.g. ["intro","V","V","C","V","C","B","V","C","C"]);
  // each ID must reference a section in `sections`.
  sections: z.array(ChordChartSectionSchema).default([]),
  form: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.string()).default({}),
  annotations: z.array(AnnotationSchema).default([]),
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
    op: z.literal("set_anacrusis"),
    value: z.boolean(),
  }),
  /** Insert or update the mid-score change at `measure`. Fields that are
   *  undefined are cleared (so passing only `tempo` produces a
   *  tempo-only change at that measure). */
  z.object({
    op: z.literal("set_measure_change"),
    measure: z.number().int().min(1),
    tempo: z.number().int().min(20).max(300).optional(),
    timeSignature: z.string().regex(/^\d+\/\d+$/).optional(),
    keySignature: KeySignature.optional(),
  }),
  /** Remove every change at the given measure. */
  z.object({
    op: z.literal("remove_measure_change"),
    measure: z.number().int().min(1),
  }),
  z.object({
    op: z.literal("update_staff"),
    staffId: z.string(),
    name: z.string().optional(),
    clef: Clef.optional(),
    lyricsMode: z.enum(["attached", "none"]).optional(),
    muted: z.boolean().optional(),
    hidden: z.boolean().optional(),
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
      slurStart: z.boolean().optional(),
      slurEnd: z.boolean().optional(),
      dots: z.number().int().min(0).max(2).optional(),
      accidental: z.enum(["sharp", "flat", "natural", "none"]).optional(),
      duration: NoteDuration.optional(),
      lyric: z.string().optional(),
      articulations: z.array(Articulation).optional(),
      beam: BeamState.optional(),
      dynamic: DynamicMarking.optional(),
      stemDirection: StemDirection.optional(),
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
  // Chord-chart (songbook) patches. Each op is fine-grained so callers (LLM,
  // GUI, CLI) can target a specific section/line without round-tripping the
  // whole score through `replace_score`.
  z.object({
    op: z.literal("set_section_label"),
    sectionId: z.string(),
    label: z.string(),
  }),
  z.object({
    op: z.literal("update_section"),
    sectionId: z.string(),
    /** null clears the field; absent leaves it unchanged. */
    repeatStart: z.boolean().nullable().optional(),
    repeatEnd: z.boolean().nullable().optional(),
    endingNumber: z.number().int().min(1).max(4).nullable().optional(),
    navMark: ChordChartNavMark.nullable().optional(),
  }),
  z.object({
    op: z.literal("add_section"),
    section: ChordChartSectionSchema,
    /** 0-based insertion index. Omit/undefined to append. */
    index: z.number().int().min(0).optional(),
  }),
  z.object({
    op: z.literal("remove_section"),
    sectionId: z.string(),
  }),
  z.object({
    op: z.literal("update_section_line"),
    sectionId: z.string(),
    lineIdx: z.number().int().min(0),
    chords: z.string().optional(),
    lyrics: z.string().optional(),
    highlight: z.boolean().nullable().optional(),
    underline: z.boolean().nullable().optional(),
    highlightRanges: z.array(z.tuple([z.number().int(), z.number().int()])).nullable().optional(),
    underlineRanges: z.array(z.tuple([z.number().int(), z.number().int()])).nullable().optional(),
  }),
  z.object({
    op: z.literal("add_section_line"),
    sectionId: z.string(),
    /** 0-based insertion index in section.lines. Omit to append. */
    index: z.number().int().min(0).optional(),
    line: ChordChartLineSchema,
  }),
  z.object({
    op: z.literal("remove_section_line"),
    sectionId: z.string(),
    lineIdx: z.number().int().min(0),
  }),
  z.object({
    op: z.literal("set_form"),
    form: z.array(z.string()),
  }),
  /**
   * Split a section into two at a line index. Lines from `atLineIdx` (inclusive)
   * move into a brand-new section inserted immediately after; the original
   * section keeps the lines before that. Used when the user realizes some
   * lines they've been editing are conceptually a separate section.
   */
  z.object({
    op: z.literal("split_section"),
    sectionId: z.string(),
    atLineIdx: z.number().int().min(0),
    newSection: z.object({
      id: z.string(),
      label: z.string(),
    }),
  }),
  z.object({
    op: z.literal("replace_score"),
    score: z.lazy(() => ScoreIntentSchema),
  }),
  z.object({
    op: z.literal("add_annotation"),
    annotation: AnnotationSchema,
  }),
  z.object({
    op: z.literal("update_annotation"),
    id: z.string(),
    updates: z.object({
      text: z.string().optional(),
      color: z.enum(["yellow", "blue", "pink", "green"]).optional(),
      visibility: z.enum(["shared", "personal"]).optional(),
      label: z.string().optional(),
    }),
  }),
  z.object({
    op: z.literal("remove_annotation"),
    id: z.string(),
  }),
]);
export type ScorePatch = z.infer<typeof ScorePatchSchema>;
