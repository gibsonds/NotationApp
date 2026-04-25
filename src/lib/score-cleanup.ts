import { Score, ScorePatch } from "./schema";

const DURATION_BEATS: Record<string, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25,
  "thirty-second": 0.125, "sixty-fourth": 0.0625,
};

function noteBeats(n: { duration: string; dots?: number; tuplet?: { actualNotes: number; normalNotes: number } }): number {
  let b = DURATION_BEATS[n.duration] || 1;
  if (n.dots) b *= 1 + (1 - Math.pow(0.5, n.dots));
  if (n.tuplet) b *= n.tuplet.normalNotes / n.tuplet.actualNotes;
  return b;
}

export interface RemovedNote {
  staffName: string;
  voiceId: string;
  measure: number;
  pitch: string;
  beat: number;
  duration: string;
  dots: number;
  reason: string;
}

export interface CleanupResult {
  patches: ScorePatch[];
  removed: RemovedNote[];
}

/**
 * Drop notes that violate measure-fit invariants:
 *   - beat ≥ beatsPerMeasure + 1 (note starts past the bar — invalid)
 *   - beat + duration > beatsPerMeasure + 1 (note extends past the bar)
 *   - beat range overlaps a same-or-earlier note's tail (within the same voice)
 *
 * Returns one `set_notes` patch per voice that needed cleaning, plus a list of
 * dropped notes with reasons. Producing patches (rather than mutating in place)
 * keeps the cleanup undoable via the existing history.
 *
 * Restricted to optional `targetMeasures` if provided — useful for "clean
 * selected measure" commands.
 */
export function cleanScoreOverflow(score: Score, targetMeasures?: number[]): CleanupResult {
  const [bsStr, btStr] = score.timeSignature.split("/");
  const bpm = parseInt(bsStr) * (4 / parseInt(btStr));
  const filterMeasures = targetMeasures ? new Set(targetMeasures) : null;

  const patches: ScorePatch[] = [];
  const removed: RemovedNote[] = [];

  for (const staff of score.staves) {
    for (const voice of staff.voices) {
      // Group notes by measure
      const byMeasure = new Map<number, typeof voice.notes>();
      for (const n of voice.notes) {
        const list = byMeasure.get(n.measure) || [];
        list.push(n);
        byMeasure.set(n.measure, list);
      }

      let voiceChanged = false;
      const keptNotes = [...voice.notes];

      for (const [measure, mNotes] of byMeasure) {
        if (filterMeasures && !filterMeasures.has(measure)) continue;

        const sorted = mNotes.slice().sort(
          (a, b) => a.beat - b.beat || noteBeats(b) - noteBeats(a),
        );

        let endOfPrev = 1; // beat where the last-kept note ends
        const measureKeep: typeof voice.notes = [];

        for (const n of sorted) {
          const dur = noteBeats(n);
          const start = n.beat;
          const end = start + dur;

          let reason = "";
          if (start >= bpm + 1 - 0.001) {
            reason = `starts at B${start} which is past the ${bpm}-beat bar`;
          } else if (end > bpm + 1 + 0.001) {
            reason = `ends at B${end} (${dur} beats from B${start}) — extends past the ${bpm}-beat bar`;
          } else if (start < endOfPrev - 0.001) {
            reason = `starts at B${start} but previous-kept note ends at B${endOfPrev} (overlap)`;
          }

          if (reason) {
            removed.push({
              staffName: staff.name,
              voiceId: voice.id,
              measure,
              pitch: n.pitch,
              beat: n.beat,
              duration: n.duration,
              dots: n.dots ?? 0,
              reason,
            });
            continue;
          }

          measureKeep.push(n);
          endOfPrev = end;
        }

        if (measureKeep.length !== mNotes.length) {
          voiceChanged = true;
          // Replace this measure's notes in the kept list
          const otherNotes = keptNotes.filter(n => n.measure !== measure);
          keptNotes.length = 0;
          keptNotes.push(...otherNotes, ...measureKeep);
        }
      }

      if (voiceChanged) {
        patches.push({
          op: "set_notes",
          staffId: staff.id,
          voiceId: voice.id,
          notes: keptNotes,
        });
      }
    }
  }

  return { patches, removed };
}
