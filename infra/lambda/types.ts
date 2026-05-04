// Server-side types. The Score blob is opaque here — the frontend has the
// real Zod-typed Score in src/lib/schema.ts, mirrored alongside these in
// src/lib/song-cloud-types.ts.

export interface SongSummary {
  id: string;
  title: string;
  savedAt: number;
  updatedAt: number;
  /** Optional folder for the My Songs picker. Synced so multiple devices
   *  see the same organization. */
  folder?: string;
}

export interface SongDTO extends SongSummary {
  score: Record<string, unknown>;
}

export interface ApiError {
  error: string;
}

/** Returned by GET /songs/{id}/versions. Each entry is one recovery
 *  point. Named revisions and daily milestones survive auto-pruning. */
export interface VersionEntry {
  ts: number;
  kind: "auto" | "daily" | "named";
  name?: string;
  title?: string;
  savedAt?: number;
}
