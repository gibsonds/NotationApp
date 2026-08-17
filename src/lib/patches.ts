import { Riff, Score, ScorePatch } from "./schema";
import { expandIntentToScore } from "./validation";
import { debugLog } from "./debug-log";
import { expandTabs } from "./chord-line";
import { reflowChordLine } from "./chord-line-wrap";
import { parseAsciiTab } from "./riff-ascii";

/**
 * Re-point riff anchors after a structural edit to a section's lines.
 *
 * A riff anchors on { sectionId, lineIdx }. That survives reflowed text, font
 * changes, and 2-column repagination — but NOT inserting or deleting lines,
 * which shift every index below them. So every op that moves line indices runs
 * its riffs through here.
 *
 * `map` returns the new anchor for a riff currently sitting on `lineIdx`, or
 * null to orphan it. Anchors DEGRADE, they never delete: an out-of-range index
 * clamps, and an orphaned riff gets `sectionId: null` so it surfaces in the
 * riff list instead of disappearing with the line it happened to sit on.
 */
function remapRiffAnchors(
  score: Score,
  sectionId: string,
  map: (lineIdx: number) => { sectionId?: string | null; lineIdx: number } | null,
): Riff[] | undefined {
  if (!score.riffs?.length) return score.riffs;
  return score.riffs.map((r) => {
    if (r.anchor.sectionId !== sectionId) return r;
    const next = map(r.anchor.lineIdx);
    if (!next) return { ...r, anchor: { ...r.anchor, sectionId: null } };
    return {
      ...r,
      anchor: {
        ...r.anchor,
        sectionId: next.sectionId === undefined ? r.anchor.sectionId : next.sectionId,
        lineIdx: Math.max(0, next.lineIdx),
      },
    };
  });
}

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

    case "set_anacrusis":
      return { ...score, anacrusis: patch.value };

    case "set_measure_change": {
      const existing = score.measureChanges ?? [];
      const others = existing.filter((c) => c.measure !== patch.measure);
      const change = {
        measure: patch.measure,
        ...(patch.tempo !== undefined && { tempo: patch.tempo }),
        ...(patch.timeSignature !== undefined && { timeSignature: patch.timeSignature }),
        ...(patch.keySignature !== undefined && { keySignature: patch.keySignature }),
      };
      return {
        ...score,
        measureChanges: [...others, change].sort((a, b) => a.measure - b.measure),
      };
    }

    case "remove_measure_change":
      return {
        ...score,
        measureChanges: (score.measureChanges ?? []).filter((c) => c.measure !== patch.measure),
      };

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
                ...(patch.muted !== undefined && { muted: patch.muted }),
                ...(patch.hidden !== undefined && { hidden: patch.hidden }),
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

    case "update_section": {
      return {
        ...score,
        sections: score.sections.map((s) => {
          if (s.id !== patch.sectionId) return s;
          const next = { ...s };
          // null clears, true/value sets, undefined leaves alone
          const apply = <K extends keyof typeof next>(
            key: K,
            val: typeof next[K] | null | undefined,
          ) => {
            if (val === undefined) return;
            if (val === null || val === false) delete next[key];
            else next[key] = val;
          };
          apply("repeatStart", patch.repeatStart);
          apply("repeatEnd", patch.repeatEnd);
          apply("endingNumber", patch.endingNumber);
          apply("navMark", patch.navMark);
          return next;
        }),
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
        // Riffs on the deleted section are orphaned, not destroyed.
        riffs: remapRiffAnchors(score, patch.sectionId, () => null),
      };
    }

    case "move_section": {
      const sections = [...score.sections];
      const from = sections.findIndex((s) => s.id === patch.sectionId);
      if (from === -1) return score; // unknown section → no-op
      const [moved] = sections.splice(from, 1);
      // toIndex is the desired final position; clamp into the post-removal range.
      const target = Math.max(0, Math.min(patch.toIndex, sections.length));
      sections.splice(target, 0, moved);
      return { ...score, sections };
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
              if (patch.highlightRanges !== undefined) {
                if (patch.highlightRanges && patch.highlightRanges.length > 0) {
                  next.highlightRanges = patch.highlightRanges;
                } else {
                  delete next.highlightRanges;
                }
              }
              if (patch.underlineRanges !== undefined) {
                if (patch.underlineRanges && patch.underlineRanges.length > 0) {
                  next.underlineRanges = patch.underlineRanges;
                } else {
                  delete next.underlineRanges;
                }
              }
              return next;
            }),
          };
        }),
      };
    }

    case "add_section_line": {
      const target = score.sections.find((s) => s.id === patch.sectionId);
      const insertAt = Math.max(
        0,
        Math.min(patch.index ?? (target?.lines.length ?? 0), target?.lines.length ?? 0),
      );
      return {
        ...score,
        sections: score.sections.map((s) => {
          if (s.id !== patch.sectionId) return s;
          const lines = [...s.lines];
          const cleanLine = {
            ...patch.line,
            chords: expandTabs(patch.line.chords ?? ""),
            lyrics: expandTabs(patch.line.lyrics ?? ""),
          };
          lines.splice(insertAt, 0, cleanLine);
          return { ...s, lines };
        }),
        // Everything at or below the insertion point moves down one.
        riffs: remapRiffAnchors(score, patch.sectionId, (li) => ({
          lineIdx: li >= insertAt ? li + 1 : li,
        })),
      };
    }

    case "remove_section_line": {
      const target = score.sections.find((s) => s.id === patch.sectionId);
      const remaining = Math.max(0, (target?.lines.length ?? 1) - 1);
      return {
        ...score,
        sections: score.sections.map((s) => {
          if (s.id !== patch.sectionId) return s;
          return { ...s, lines: s.lines.filter((_, i) => i !== patch.lineIdx) };
        }),
        // Below the cut everything moves up one. A riff ON the removed line
        // keeps its index (now the following line) but clamps to the last
        // remaining line, so it stays visible rather than pointing off the end.
        riffs: remapRiffAnchors(score, patch.sectionId, (li) => ({
          lineIdx: Math.min(li > patch.lineIdx ? li - 1 : li, Math.max(0, remaining - 1)),
        })),
      };
    }

    case "set_form": {
      return { ...score, form: patch.form };
    }

    case "reflow_section": {
      // Persistent reflow: walk the section's lines and split any line
      // with more than `barsPerLine` bars into multiple lines, slicing
      // chords and lyrics at the same column positions so alignment
      // stays intact. Lines without `|` markers pass through untouched.
      //
      // Highlight / underline ranges are dropped on reflow — they're
      // column-indexed and would need careful per-sub-row reshifting.
      // The user can re-apply via the existing annotation flow.
      // Each source line can expand into several, so build an old→new index
      // map as we go and move riff anchors onto the first row of their line.
      const reflowTarget = score.sections.find((s) => s.id === patch.sectionId);
      const firstRowOfLine: number[] = [];
      if (reflowTarget) {
        let cursor = 0;
        for (const line of reflowTarget.lines) {
          firstRowOfLine.push(cursor);
          cursor += Math.max(
            1,
            reflowChordLine(line.chords ?? "", line.lyrics ?? "", patch.barsPerLine).length,
          );
        }
      }
      return {
        ...score,
        sections: score.sections.map((s) => {
          if (s.id !== patch.sectionId) return s;
          const newLines: typeof s.lines = [];
          for (const line of s.lines) {
            const chords = line.chords ?? "";
            const lyrics = line.lyrics ?? "";
            const reflowed = reflowChordLine(chords, lyrics, patch.barsPerLine);
            for (const r of reflowed) {
              newLines.push({
                ...line,
                chords: r.chords,
                lyrics: r.lyrics,
                highlightRanges: undefined,
                underlineRanges: undefined,
              });
            }
          }
          return { ...s, lines: newLines };
        }),
        riffs: remapRiffAnchors(score, patch.sectionId, (li) => ({
          lineIdx: firstRowOfLine[li] ?? li,
        })),
      };
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
      return {
        ...score,
        sections,
        // Lines from atLineIdx on now live in the new section, renumbered from 0.
        riffs: remapRiffAnchors(score, patch.sectionId, (li) =>
          li >= patch.atLineIdx
            ? { sectionId: patch.newSection.id, lineIdx: li - patch.atLineIdx }
            : { lineIdx: li },
        ),
      };
    }

    case "replace_score": {
      const expanded = expandIntentToScore(patch.score);
      // Carry riffs across. expandIntentToScore builds a fresh score from an
      // LLM intent, which has no riff field — without this an AI "rewrite the
      // song" would silently destroy hand-authored riffs, the way it already
      // destroys annotations.
      return { ...expanded, id: score.id, riffs: score.riffs };
    }

    case "add_annotation": {
      return {
        ...score,
        annotations: [...(score.annotations ?? []), patch.annotation],
      };
    }

    case "update_annotation": {
      return {
        ...score,
        annotations: (score.annotations ?? []).map((a) =>
          a.id === patch.id ? { ...a, ...patch.updates } : a
        ),
      };
    }

    case "remove_annotation": {
      return {
        ...score,
        annotations: (score.annotations ?? []).filter((a) => a.id !== patch.id),
      };
    }

    case "add_riff": {
      return { ...score, riffs: [...(score.riffs ?? []), patch.riff] };
    }

    case "add_riff_from_ascii": {
      // The shared entry point for the paste box and the AI: one pure parser,
      // so both surfaces fail (and succeed) identically.
      const parsed = parseAsciiTab(patch.ascii, {
        timeSignature: score.timeSignature,
        tuning: patch.riff.tuning,
      });
      if (parsed.bars.length === 0) return score; // nothing readable → no-op
      const riff: Riff = {
        id: patch.riff.id,
        label: patch.riff.label,
        kind: "tab",
        tuning: parsed.tuning,
        anchor: patch.riff.anchor,
        bars: parsed.bars,
        visibility: "shared",
        source: "ascii",
        // createdAt comes from the caller so applyPatch stays pure and
        // undo/redo replays identically.
        createdAt: patch.riff.createdAt ?? 0,
      };
      return { ...score, riffs: [...(score.riffs ?? []), riff] };
    }

    case "update_riff": {
      return {
        ...score,
        riffs: (score.riffs ?? []).map((r) =>
          r.id === patch.id
            ? { ...r, ...patch.updates, updatedAt: patch.updatedAt ?? r.updatedAt }
            : r,
        ),
      };
    }

    case "remove_riff": {
      return { ...score, riffs: (score.riffs ?? []).filter((r) => r.id !== patch.id) };
    }

    default:
      return score;
  }
}
