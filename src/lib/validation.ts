import { Score, ScoreIntent, ScoreIntentSchema } from "./schema";
import { v4 as uuidv4 } from "uuid";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ── Schema Validation ──────────────────────────────────────────────────────

export function validateScoreIntent(data: unknown): ValidationResult {
  const result = ScoreIntentSchema.safeParse(data);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`
      ),
      warnings: [],
    };
  }
  return { valid: true, errors: [], warnings: [] };
}

// ── Musical Sanity Checks ──────────────────────────────────────────────────

export function validateMusicalSanity(score: Score): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Time signature parsing
  const [beatsStr, beatTypeStr] = score.timeSignature.split("/");
  const beats = parseInt(beatsStr, 10);
  const beatType = parseInt(beatTypeStr, 10);

  if (isNaN(beats) || isNaN(beatType) || beats < 1 || beatType < 1) {
    errors.push(`Invalid time signature: ${score.timeSignature}`);
  }
  if (![1, 2, 4, 8, 16].includes(beatType)) {
    warnings.push(
      `Unusual beat type ${beatType} in time signature ${score.timeSignature}`
    );
  }

  // Duration map (in quarter-note units)
  const durationValues: Record<string, number> = {
    whole: 4,
    half: 2,
    quarter: 1,
    eighth: 0.5,
    sixteenth: 0.25,
  };

  const measureLength = beats * (4 / beatType);

  // Check each staff/voice
  for (const staff of score.staves) {
    for (const voice of staff.voices) {
      // Group notes by measure
      const notesByMeasure: Record<number, typeof voice.notes> = {};
      for (const note of voice.notes) {
        if (!notesByMeasure[note.measure]) {
          notesByMeasure[note.measure] = [];
        }
        notesByMeasure[note.measure].push(note);
      }

      for (const [measureStr, notes] of Object.entries(notesByMeasure)) {
        const measure = parseInt(measureStr, 10);
        if (measure > score.measures) {
          errors.push(
            `Staff "${staff.name}", voice "${voice.id}": note in measure ${measure} exceeds score length (${score.measures} measures)`
          );
        }

        // Sort by beat to detect chord notes (same beat = simultaneous)
        const sorted = [...notes].sort((a, b) => a.beat - b.beat);
        let totalDuration = 0;
        let prevBeat = -1;

        for (const note of sorted) {
          // Skip chord notes — they share the beat with the previous note
          // and don't add to total duration
          if (Math.abs(note.beat - prevBeat) < 0.01) continue;
          prevBeat = note.beat;

          let dur = durationValues[note.duration] || 1;
          // Apply dots
          let dotValue = dur;
          for (let d = 0; d < note.dots; d++) {
            dotValue /= 2;
            dur += dotValue;
          }
          totalDuration += dur;
        }

        if (Math.abs(totalDuration - measureLength) > 0.01) {
          warnings.push(
            `Staff "${staff.name}", voice "${voice.id}", measure ${measure}: total duration ${totalDuration} doesn't match expected ${measureLength}`
          );
        }
      }
    }
  }

  // Check chord symbol placements
  for (const chord of score.chordSymbols) {
    if (chord.measure > score.measures) {
      errors.push(
        `Chord symbol "${chord.symbol}" in measure ${chord.measure} exceeds score length`
      );
    }
    if (chord.beat > beats) {
      warnings.push(
        `Chord symbol "${chord.symbol}" on beat ${chord.beat} in measure ${chord.measure} exceeds beats per measure (${beats})`
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Capability Validation (MVP limits) ─────────────────────────────────────

export function validateCapability(score: Score): ValidationResult {
  const warnings: string[] = [];

  if (score.staves.length > 8) {
    warnings.push("More than 8 staves may affect rendering performance");
  }
  if (score.measures > 100) {
    warnings.push("Large scores (>100 measures) may render slowly in preview");
  }

  return { valid: true, errors: [], warnings };
}

// ── Expand Intent into Full Score ──────────────────────────────────────────

export function expandIntentToScore(intent: ScoreIntent): Score {
  const id = uuidv4();
  const measures = intent.measures ?? 8;
  const timeSignature = intent.timeSignature ?? "4/4";
  const keySignature = intent.keySignature ?? "C";

  const staves = (intent.staves ?? [{ name: "Staff 1", clef: "treble" as const }]).map(
    (s, i) => ({
      id: `staff_${i + 1}`,
      name: s.name,
      clef: s.clef,
      lyricsMode: s.lyricsMode ?? ("attached" as const),
      voices: (s.voices ?? [{ role: "general" as const }]).map((v, vi) => ({
        id: `staff_${i + 1}_voice_${vi + 1}`,
        role: v.role ?? ("general" as const),
        notes: v.notes ?? [],
      })),
    })
  );

  // Ensure every staff has at least one voice
  for (const staff of staves) {
    if (staff.voices.length === 0) {
      staff.voices.push({
        id: `${staff.id}_voice_1`,
        role: "general" as const,
        notes: [],
      });
    }
  }

  return {
    id,
    title: intent.title ?? "Untitled Score",
    composer: intent.composer ?? "",
    tempo: intent.tempo ?? 120,
    timeSignature,
    keySignature,
    measures,
    staves,
    chordSymbols: intent.chordSymbols ?? [],
    rehearsalMarks: intent.rehearsalMarks ?? [],
    repeats: intent.repeats ?? [],
    metadata: {},
  };
}

// ── Full Validation Pipeline ───────────────────────────────────────────────

export function validateScore(score: Score): ValidationResult {
  const musical = validateMusicalSanity(score);
  const capability = validateCapability(score);

  return {
    valid: musical.valid && capability.valid,
    errors: [...musical.errors, ...capability.errors],
    warnings: [...musical.warnings, ...capability.warnings],
  };
}
