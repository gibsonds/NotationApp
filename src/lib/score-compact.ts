import { Score } from "./schema";

/**
 * Create a compact representation of the score for AI context.
 * Strips verbose note arrays and replaces with summaries to keep
 * the revision prompt within token limits.
 *
 * For structural edits (key, tempo, clef, title, etc.) the AI
 * doesn't need every note. For note-level edits, we include only
 * the relevant measures.
 */
export function compactScoreForAI(
  score: Score,
  options?: { focusMeasures?: number[] }
): object {
  const focusSet = options?.focusMeasures
    ? new Set(options.focusMeasures)
    : null;

  return {
    id: score.id,
    title: score.title,
    composer: score.composer,
    tempo: score.tempo,
    timeSignature: score.timeSignature,
    keySignature: score.keySignature,
    measures: score.measures,
    chordSymbols: score.chordSymbols,
    rehearsalMarks: score.rehearsalMarks,
    repeats: score.repeats,
    staves: score.staves.map((staff) => ({
      id: staff.id,
      name: staff.name,
      clef: staff.clef,
      lyricsMode: staff.lyricsMode,
      voices: staff.voices.map((voice) => {
        const notes = voice.notes;

        // If we have focus measures, include only those notes in full
        if (focusSet) {
          const focusNotes = notes.filter((n) => focusSet.has(n.measure));
          const otherMeasures = [
            ...new Set(
              notes
                .filter((n) => !focusSet.has(n.measure))
                .map((n) => n.measure)
            ),
          ].sort((a, b) => a - b);

          return {
            id: voice.id,
            role: voice.role,
            noteCount: notes.length,
            focusNotes,
            otherMeasures:
              otherMeasures.length > 0
                ? `[measures ${otherMeasures[0]}-${otherMeasures[otherMeasures.length - 1]} omitted, ${notes.length - focusNotes.length} notes]`
                : undefined,
          };
        }

        // No focus — provide a summary
        const measureGroups = new Map<number, { pitches: string[]; lyrics: string[] }>();
        for (const n of notes) {
          if (!measureGroups.has(n.measure)) {
            measureGroups.set(n.measure, { pitches: [], lyrics: [] });
          }
          const g = measureGroups.get(n.measure)!;
          if (n.pitch !== "rest") g.pitches.push(n.pitch);
          if (n.lyric) g.lyrics.push(n.lyric);
        }

        const summary = Array.from(measureGroups.entries()).map(
          ([m, g]) => ({
            measure: m,
            pitches: [...new Set(g.pitches)].join(" "),
            lyrics: g.lyrics.length > 0 ? g.lyrics.join(" ") : undefined,
          })
        );

        return {
          id: voice.id,
          role: voice.role,
          noteCount: notes.length,
          measureSummary: summary,
        };
      }),
    })),
  };
}

/**
 * Estimate token count for a string (rough: 1 token per 4 chars)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
