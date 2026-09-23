/**
 * Guards for async results that want to replace the OPEN score.
 *
 * Both callers here start an async job (a songbook sync, a cloud autosave
 * that 409'd and auto-merged) and, seconds later, want to swap the open
 * score for a fresher copy of "the current song". The bug this module
 * fixes: they judged "the current song" from values captured when the job
 * STARTED. If the user loaded a different song while the job was in flight
 * — pick a song from My Songs while its open-time sync is still running —
 * the late result replaced the song they had just opened with the
 * previous song's cloud copy. That is how the app "loaded the wrong song":
 * the swap happened a beat after the load, so it looked like the load
 * itself was wrong.
 *
 * Every decision here reads the store LIVE via getState() and checks the
 * result still belongs to the song that is open NOW.
 */

import { useScoreStore } from "@/store/score-store";
import type { Score } from "@/lib/schema";
import type { SongBankEntry } from "@/lib/song-bank";

/** True when `incoming` is a copy of the score that is open right now —
 *  same songbook entry, and (when both carry ids) the same score id. */
function belongsToOpenSong(songId: string, incoming: Score): boolean {
  const { score, uiState } = useScoreStore.getState();
  if (!score || !uiState.currentSongId) return false;
  if (uiState.currentSongId !== songId) return false;
  if (score.id && incoming.id && score.id !== incoming.id) return false;
  return true;
}

/**
 * After a songbook sync, replace the open score with the synced copy of the
 * same song IF the cloud brought newer content and the user has no unsaved
 * local edits. `preLocalById` is the bank as it stood before the sync began
 * — the reference for "unsaved edits" (open score differs from what was
 * saved locally).
 *
 * Returns true when the open score was replaced.
 */
export function adoptSyncedOpenSong(
  merged: SongBankEntry[],
  preLocalById: Map<string, SongBankEntry>,
): boolean {
  const { score, uiState, setScore } = useScoreStore.getState();
  const songId = uiState.currentSongId;
  if (!songId || !score) return false;
  const fresh = merged.find((e) => e.id === songId);
  if (!fresh || fresh.score === score) return false;
  if (!belongsToOpenSong(songId, fresh.score)) return false;
  const preLocal = preLocalById.get(songId);
  const cloudIsNewer = JSON.stringify(fresh.score) !== JSON.stringify(score);
  const noLocalUnsavedEdits =
    !!preLocal && JSON.stringify(score) === JSON.stringify(preLocal.score);
  if (!cloudIsNewer || !noLocalUnsavedEdits) return false;
  setScore(fresh.score);
  return true;
}

/**
 * A cloud autosave auto-merged with another device's edits and wants the
 * editor to show the merge result. Adopt it only if that song is still the
 * one open — a merge for a song the user has since navigated away from is
 * already in the songbook entry and must not clobber the current one.
 *
 * Returns true when the open score was replaced.
 */
export function adoptMergedScore(songId: string, mergedScore: Score): boolean {
  if (!belongsToOpenSong(songId, mergedScore)) return false;
  useScoreStore.getState().setScore(mergedScore);
  return true;
}
