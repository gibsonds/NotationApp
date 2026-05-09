"use client";

import type { Score } from "@/lib/schema";
import type { SongDTO } from "@/lib/song-cloud-types";
import { CLOUD_ENABLED, cloudPutSong, isTransient, enqueueOffline, isConflictError } from "@/lib/song-cloud";
import { getSongs, updateSong } from "@/lib/song-bank";
import { mergeScores } from "@/lib/score-merge";

/**
 * Cloud autosave: pushes the currently-loaded song to DynamoDB after edits
 * settle, so "I edited but never clicked Save Song" can't lose work the
 * way it has been.
 *
 * Fires lifecycle events the UI listens to:
 *   - notation-cloud-saving — push started
 *   - notation-cloud-saved  — push succeeded (detail: { ts: number })
 *   - notation-cloud-offline — push failed transiently (queued for retry)
 *   - notation-cloud-conflict — server returned 409; detail.current is
 *     the cloud DTO, detail.local is the score we tried to push. UI
 *     opens the conflict modal in response.
 */

const SAVING_EVENT = "notation-cloud-saving";
const SAVED_EVENT = "notation-cloud-saved";
const OFFLINE_EVENT = "notation-cloud-offline";
const CONFLICT_EVENT = "notation-cloud-conflict";
const MERGED_EVENT = "notation-cloud-merged";

let lastPushedScore: Score | null = null;
let lastPushedSongId: string | null = null;

/** Push the score to cloud under the given song id. Returns true on
 *  success, false on transient failure (which is queued for retry). */
export async function autosaveToCloud(
  songId: string,
  score: Score,
): Promise<boolean> {
  if (!CLOUD_ENABLED) return false;
  // Skip if nothing changed since the last successful push for this song.
  if (lastPushedSongId === songId && lastPushedScore === score) return true;

  // Look up the local entry for its title, folder, and the cloudVersion
  // we'll send as expectedVersion. Fall back to score.title.
  const localEntry = getSongs().find(s => s.id === songId);
  const title = localEntry?.title ?? score.title ?? "Untitled Song";
  const folder = localEntry?.folder ?? null;
  const expectedVersion = localEntry?.cloudVersion;

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SAVING_EVENT));
  }
  try {
    const now = Date.now();
    const dto = await cloudPutSong({
      id: songId,
      title,
      score,
      savedAt: now,
      folder,
      ...(expectedVersion !== undefined && { expectedVersion }),
    });
    // Mirror to local entry so list views show the latest savedAt and
    // the cloudVersion advances in lockstep with cloud.
    if (localEntry) {
      updateSong(songId, { score, savedAt: now, cloudVersion: dto.version });
    }
    lastPushedScore = score;
    lastPushedSongId = songId;
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(SAVED_EVENT, { detail: { ts: now } })
      );
    }
    return true;
  } catch (err) {
    if (isConflictError(err)) {
      // Concurrent write detected (#87). Try a 3-way auto-merge first
      // (#89): if the only differences are non-conflicting (chord layout,
      // disjoint sections/lines, annotation adds), silently re-save the
      // merged content. Only fall back to the modal when there are real
      // user-visible disagreements.
      const base = localEntry?.score; // last successful sync = our merge ancestor
      if (base) {
        const merge = mergeScores(base, score, err.current.score);
        if (merge.conflicts.length === 0) {
          // Clean merge — push the merged content with theirs's version
          // as expectedVersion so the conditional update succeeds.
          try {
            const now2 = Date.now();
            const dto = await cloudPutSong({
              id: songId,
              title,
              score: merge.score,
              savedAt: now2,
              folder,
              expectedVersion: err.current.version,
            });
            updateSong(songId, {
              score: merge.score,
              savedAt: now2,
              cloudVersion: dto.version,
            });
            lastPushedScore = merge.score;
            lastPushedSongId = songId;
            if (typeof window !== "undefined") {
              // Tell the editor: replace the open score with the merge
              // result so the user sees the other side's contributions
              // along with their own. Toast UI listens to this event.
              window.dispatchEvent(
                new CustomEvent<{ score: Score; songId: string; stats: typeof merge.stats }>(
                  MERGED_EVENT,
                  { detail: { score: merge.score, songId, stats: merge.stats } },
                ),
              );
              window.dispatchEvent(
                new CustomEvent(SAVED_EVENT, { detail: { ts: now2 } }),
              );
            }
            return true;
          } catch (retryErr) {
            // The retry itself can race-conflict (someone else wrote
            // between our 409 and our retry). Fall through to the modal.
            console.warn("[cloud-autosave] merge retry conflicted", retryErr);
          }
        }
      }
      // Real conflicts (or no base to merge against) → modal.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent<{ current: SongDTO; local: Score; songId: string }>(
            CONFLICT_EVENT,
            { detail: { current: err.current, local: score, songId } },
          ),
        );
      }
      return false;
    }
    if (isTransient(err)) {
      enqueueOffline({
        type: "put",
        id: songId,
        title,
        score,
        savedAt: Date.now(),
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(OFFLINE_EVENT));
      }
    } else {
      console.warn("[cloud-autosave] non-transient failure", err);
    }
    return false;
  }
}

/** Clear the deduplication cache. Call after Load to avoid the first
 *  edit-after-load being a no-op when score is structurally similar. */
export function resetAutosaveDedup(): void {
  lastPushedScore = null;
  lastPushedSongId = null;
}

export const CloudSaveEvents = {
  Saving: SAVING_EVENT,
  Saved: SAVED_EVENT,
  Offline: OFFLINE_EVENT,
  Conflict: CONFLICT_EVENT,
  Merged: MERGED_EVENT,
};
