import { Score, ScorePatch } from "./schema";
import { expandIntentToScore } from "./validation";
import { debugLog } from "./debug-log";

const DURATION_BEATS: Record<string, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25,
  "thirty-second": 0.125, "sixty-fourth": 0.0625,
};

/** Compute how many beats a note actually occupies (duration × dots × tuplet ratio). */
function noteBeats(n: { duration: string; dots?: number; tuplet?: { actualNotes: number; normalNotes: number } }): number {
  let b = DURATION_BEATS[n.duration] || 1;
  if (n.dots) b *= 1 + (1 - Math.pow(0.5, n.dots));
  if (n.tuplet) b *= n.tuplet.normalNotes / n.tuplet.actualNotes;
  return b;
}

/** Sum the beats occupied by every note in `voiceNotes` for the given measure. */
function totalBeatsInMeasure(voiceNotes: { measure: number; duration: string; dots?: number; tuplet?: { actualNotes: number; normalNotes: number } }[], measure: number): number {
  return voiceNotes
    .filter(n => n.measure === measure)
    .reduce((sum, n) => sum + noteBeats(n), 0);
}

export function applyPatch(score: Score, patch: ScorePatch): Score {
  switch (patch.op) {
    case "set_title":
      return { ...score, title: patch.value };

    case "set_tempo":
      return { ...score, tempo: patch.value };

    case "set_time_signature":
      return { ...score, timeSignature: patch.value };

    case "set_key_signature":
      return { ...score, keySignature: patch.value };

    case "set_measures":
      return { ...score, measures: patch.value };

    case "update_staff":
      return {
        ...score,
        staves: score.staves.map((s) =>
          s.id === patch.staffId
            ? {
                ...s,
                ...(patch.name !== undefined && { name: patch.name }),
                ...(patch.clef !== undefined && { clef: patch.clef }),
                ...(patch.lyricsMode !== undefined && {
                  lyricsMode: patch.lyricsMode,
                }),
              }
            : s
        ),
      };

    case "add_staff":
      return { ...score, staves: [...score.staves, patch.staff] };

    case "remove_staff":
      return {
        ...score,
        staves: score.staves.filter((s) => s.id !== patch.staffId),
      };

    case "set_notes": {
      // Determine which measures the patch covers
      const patchMeasures = new Set(patch.notes.map((n) => n.measure));

      return {
        ...score,
        staves: score.staves.map((s) => {
          if (s.id !== patch.staffId) return s;

          const voiceExists = s.voices.some((v) => v.id === patch.voiceId);
          if (voiceExists) {
            return {
              ...s,
              voices: s.voices.map((v) => {
                if (v.id !== patch.voiceId) return v;
                // Merge: keep existing notes for measures NOT in the patch,
                // replace only the measures that the patch provides
                const kept = v.notes.filter((n) => !patchMeasures.has(n.measure));
                return { ...v, notes: [...kept, ...patch.notes] };
              }),
            };
          }

          // Auto-create the voice if it doesn't exist
          return {
            ...s,
            voices: [
              ...s.voices,
              { id: patch.voiceId, role: "general" as const, notes: patch.notes },
            ],
          };
        }),
      };
    }

    case "add_notes": {
      // Build a set of positions being added (measure+beat) to remove conflicts
      const newPositions = new Set(
        patch.notes.map((n) => `${n.measure}:${Math.round(n.beat * 1000)}`)
      );

      // Compute beats-per-measure for overflow logging
      const [bsStr, btStr] = score.timeSignature.split("/");
      const bpm = parseInt(bsStr) * (4 / parseInt(btStr));

      const next = {
        ...score,
        staves: score.staves.map((s) => {
          if (s.id !== patch.staffId) return s;
          const voiceExists = s.voices.some((v) => v.id === patch.voiceId);
          if (voiceExists) {
            return {
              ...s,
              voices: s.voices.map((v) => {
                if (v.id !== patch.voiceId) return v;
                // Remove existing notes at the same beat positions, then add new ones
                const kept = v.notes.filter(
                  (n) => !newPositions.has(`${n.measure}:${Math.round(n.beat * 1000)}`)
                );
                return { ...v, notes: [...kept, ...patch.notes] };
              }),
            };
          }
          return {
            ...s,
            voices: [
              ...s.voices,
              { id: patch.voiceId, role: "general" as const, notes: patch.notes },
            ],
          };
        }),
      };

      // After-the-fact overflow check: any measure that now has more beats than
      // the time signature allows is malformed. Log so user-reported issues like
      // "5 beats in a 4/4 measure" are traceable to the patch that produced them.
      const touchedMeasures = new Set(patch.notes.map(n => n.measure));
      const targetVoice = next.staves
        .find(s => s.id === patch.staffId)
        ?.voices.find(v => v.id === patch.voiceId);
      if (targetVoice) {
        for (const m of touchedMeasures) {
          const total = totalBeatsInMeasure(targetVoice.notes, m);
          if (total > bpm + 0.001) {
            const desc = targetVoice.notes
              .filter(n => n.measure === m)
              .sort((a, b) => a.beat - b.beat)
              .map(n => `${n.pitch}@B${n.beat}(${n.duration}${n.dots ? `.${n.dots}` : ""}=${noteBeats(n)})`)
              .join(", ");
            debugLog(`[OVERFLOW add_notes] M${m} now has ${total} beats in a ${bpm}-beat measure (staff=${patch.staffId} voice=${patch.voiceId}): ${desc}`);
          }
        }
      }

      return next;
    }

    case "update_note": {
      return {
        ...score,
        staves: score.staves.map((s) => {
          if (s.id !== patch.staffId) return s;
          return {
            ...s,
            voices: s.voices.map((v) => {
              if (v.id !== patch.voiceId) return v;
              return {
                ...v,
                notes: v.notes.map((n) => {
                  if (
                    n.measure === patch.measure &&
                    Math.abs(n.beat - patch.beat) < 0.001 &&
                    n.pitch === patch.pitch
                  ) {
                    return { ...n, ...patch.updates };
                  }
                  return n;
                }),
              };
            }),
          };
        }),
      };
    }

    case "remove_note": {
      return {
        ...score,
        staves: score.staves.map((s) => {
          if (s.id !== patch.staffId) return s;
          return {
            ...s,
            voices: s.voices.map((v) => {
              if (v.id !== patch.voiceId) return v;
              return {
                ...v,
                notes: v.notes.filter((n) =>
                  !(n.measure === patch.measure &&
                    Math.abs(n.beat - patch.beat) < 0.001 &&
                    n.pitch === patch.pitch)
                ),
              };
            }),
          };
        }),
      };
    }

    case "set_chord_symbols":
      return { ...score, chordSymbols: patch.chordSymbols };

    case "replace_score": {
      const expanded = expandIntentToScore(patch.score);
      return { ...expanded, id: score.id };
    }

    default:
      return score;
  }
}
