"use client";

import type { Score } from "@/lib/schema";
import { CLOUD_ENABLED, cloudPutSong, isTransient, enqueueOffline } from "@/lib/song-cloud";
import { getSongs, updateSong } from "@/lib/song-bank";

/**
 * Cloud autosave: pushes the currently-loaded song to DynamoDB after edits
 * settle, so "I edited but never clicked Save Song" can't lose work the
 * way it has been.
 *
 * Fires lifecycle events the UI listens to:
 *   - notation-cloud-saving — push started
 *   - notation-cloud-saved  — push succeeded (detail: { ts: number })
 *   - notation-cloud-offline — push failed transiently (queued for retry)
 */

const SAVING_EVENT = "notation-cloud-saving";
const SAVED_EVENT = "notation-cloud-saved";
const OFFLINE_EVENT = "notation-cloud-offline";

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

  // Look up the local entry for its title and folder (in case they were
  // updated separately). Fall back to score.title.
  const localEntry = getSongs().find(s => s.id === songId);
  const title = localEntry?.title ?? score.title ?? "Untitled Song";
  const folder = localEntry?.folder ?? null;

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SAVING_EVENT));
  }
  try {
    const now = Date.now();
    await cloudPutSong({
      id: songId,
      title,
      score,
      savedAt: now,
      folder,
    });
    // Mirror to local entry so list views show the latest savedAt.
    if (localEntry) {
      updateSong(songId, { score, savedAt: now });
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
};
