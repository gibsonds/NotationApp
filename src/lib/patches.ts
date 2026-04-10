import { Score, ScorePatch } from "./schema";
import { expandIntentToScore } from "./validation";

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
