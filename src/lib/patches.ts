import { Score, ScorePatch } from "./schema";
import { expandIntentToScore } from "./validation";
import { debugLog } from "./debug-log";
import { expandTabs } from "./chord-line";

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

    // ── Chord-chart (songbook) patches ─────────────────────────────────────

    case "set_section_label": {
      return {
        ...score,
        sections: score.sections.map((s) =>
          s.id === patch.sectionId ? { ...s, label: patch.label } : s,
        ),
      };
    }

    case "add_section": {
      const sections = [...score.sections];
      const idx = patch.index ?? sections.length;
      sections.splice(Math.max(0, Math.min(idx, sections.length)), 0, patch.section);
      return { ...score, sections };
    }

    case "remove_section": {
      return {
        ...score,
        sections: score.sections.filter((s) => s.id !== patch.sectionId),
        // Keep `form` consistent — drop any references to the removed section.
        form: score.form.filter((id) => id !== patch.sectionId),
      };
    }

    case "update_section_line": {
      return {
        ...score,
        sections: score.sections.map((s) => {
          if (s.id !== patch.sectionId) return s;
          return {
            ...s,
            lines: s.lines.map((l, i) => {
              if (i !== patch.lineIdx) return l;
              // null in a marking field means "clear it" so the schema
              // omits it; undefined means "leave unchanged".
              const next: typeof l = {
                ...l,
                chords:
                  patch.chords !== undefined ? expandTabs(patch.chords) : l.chords,
                lyrics:
                  patch.lyrics !== undefined ? expandTabs(patch.lyrics) : l.lyrics,
              };
              if (patch.highlight !== undefined) {
                if (patch.highlight) next.highlight = true;
                else delete next.highlight;
              }
              if (patch.underline !== undefined) {
                if (patch.underline) next.underline = true;
                else delete next.underline;
              }
              return next;
            }),
          };
        }),
      };
    }

    case "add_section_line": {
      return {
        ...score,
        sections: score.sections.map((s) => {
          if (s.id !== patch.sectionId) return s;
          const lines = [...s.lines];
          const idx = patch.index ?? lines.length;
          const cleanLine = {
            ...patch.line,
            chords: expandTabs(patch.line.chords ?? ""),
            lyrics: expandTabs(patch.line.lyrics ?? ""),
          };
          lines.splice(Math.max(0, Math.min(idx, lines.length)), 0, cleanLine);
          return { ...s, lines };
        }),
      };
    }

    case "remove_section_line": {
      return {
        ...score,
        sections: score.sections.map((s) => {
          if (s.id !== patch.sectionId) return s;
          return { ...s, lines: s.lines.filter((_, i) => i !== patch.lineIdx) };
        }),
      };
    }

    case "set_form": {
      return { ...score, form: patch.form };
    }

    case "split_section": {
      const idx = score.sections.findIndex(s => s.id === patch.sectionId);
      if (idx < 0) return score;
      const target = score.sections[idx];
      const before = target.lines.slice(0, patch.atLineIdx);
      const after = target.lines.slice(patch.atLineIdx);
      // Always leave each section with at least one line so neither side
      // collapses to an empty section that the UI can't render meaningfully.
      const trimmed = {
        ...target,
        lines: before.length > 0 ? before : [{ chords: "", lyrics: "" }],
      };
      const fresh = {
        id: patch.newSection.id,
        label: patch.newSection.label,
        lines: after.length > 0 ? after : [{ chords: "", lyrics: "" }],
      };
      const sections = [...score.sections];
      sections.splice(idx, 1, trimmed, fresh);
      return { ...score, sections };
    }

    case "replace_score": {
      const expanded = expandIntentToScore(patch.score);
      return { ...expanded, id: score.id };
    }

    default:
      return score;
  }
}
