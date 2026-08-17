"use client";

// ── Save a score into the songbook (local + cloud) ──────────────────────────
//
// This is THE durable save. Everything else that sounds like saving isn't:
//
//   - "Save Revision" writes a named snapshot into the in-memory store only.
//   - Cloud autosave requires an existing song id, so it never fires for a
//     score that has not been saved here at least once.
//
// So a brand-new score — a fresh paste you haven't named yet, i.e. exactly the
// work most at risk — had no durable home until this ran. Extracted into a lib
// so the File menu and the My Songs modal share one implementation instead of
// drifting apart.

import type { Score } from "@/lib/schema";
import type { SongBankEntry } from "@/lib/song-bank";
import { getSongs, saveSong, updateSong } from "@/lib/song-bank";
import {
  CLOUD_ENABLED,
  cloudPutSong,
  enqueueOffline,
  isTransient,
} from "@/lib/song-cloud";

export type SongSaveCloudStatus = "ok" | "offline" | "failed" | "disabled";

export interface SongSaveResult {
  entry: SongBankEntry;
  /** Whether the entry reached the cloud, and how it failed if not. */
  cloud: SongSaveCloudStatus;
  /** True when a new songbook entry was created rather than one updated. */
  created: boolean;
  error?: string;
}

export interface SongSaveOptions {
  score: Score;
  /** Songbook entry to update. Null/undefined creates a new entry. */
  songId?: string | null;
  /** Defaults to the score's title. */
  title?: string;
  /** Force a new entry even when songId is set (Save As). */
  asNew?: boolean;
}

/**
 * Write `score` into the song bank and push it to the cloud.
 *
 * Local write happens first and unconditionally, so a cloud failure can never
 * lose the work; a failed push is queued for retry and reported in `cloud`
 * rather than thrown. The entry stays `pendingSync` until the push is
 * confirmed, which is what stops syncSongbook tombstoning it in the meantime.
 */
export async function saveScoreToSongbook(
  opts: SongSaveOptions,
): Promise<SongSaveResult> {
  const { score, asNew = false } = opts;
  const now = Date.now();
  const title = (opts.title ?? score.title ?? "").trim() || "Untitled Song";

  const existing =
    !asNew && opts.songId ? getSongs().find((s) => s.id === opts.songId) : null;

  let entry: SongBankEntry;
  let created = false;
  if (existing) {
    const updated = updateSong(existing.id, {
      title,
      score,
      savedAt: now,
      pendingSync: true,
    });
    // updateSong returns null when the local write failed (iOS quota). Keep an
    // in-memory entry so the cloud push still runs and the work isn't lost.
    entry = updated ?? { ...existing, title, score, savedAt: now, pendingSync: true };
  } else {
    created = true;
    const fresh = saveSong(title, score);
    if (fresh) updateSong(fresh.id, { pendingSync: true });
    entry = fresh
      ? { ...fresh, pendingSync: true }
      : { id: `song-${now}`, title, savedAt: now, score, pendingSync: true };
  }

  if (!CLOUD_ENABLED) return { entry, cloud: "disabled", created };

  try {
    // No expectedVersion: an explicit user save is authoritative and must not
    // be rejected by a stale version. Background autosave keeps optimistic
    // concurrency and the conflict modal.
    const dto = await cloudPutSong({
      id: entry.id,
      title: entry.title,
      score: entry.score,
      savedAt: entry.savedAt,
      folder: entry.folder ?? null,
    });
    updateSong(entry.id, { cloudVersion: dto.version, pendingSync: false });
    return { entry, cloud: "ok", created };
  } catch (err) {
    // Never report a phantom success. Keep it pendingSync so syncSongbook
    // re-pushes, and queue a retry.
    enqueueOffline({
      type: "put",
      id: entry.id,
      title: entry.title,
      score: entry.score,
      savedAt: entry.savedAt,
    });
    const message = err instanceof Error ? err.message : "Cloud save failed";
    if (!isTransient(err)) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("notation-persist-failed", {
            detail: { error: `Cloud save failed: ${message}` },
          }),
        );
      }
      return { entry, cloud: "failed", created, error: message };
    }
    return { entry, cloud: "offline", created, error: message };
  }
}
