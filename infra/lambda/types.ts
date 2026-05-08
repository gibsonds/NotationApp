// Server-side types. The Score blob is opaque here — the frontend has the
// real Zod-typed Score in src/lib/schema.ts, mirrored alongside these in
// src/lib/song-cloud-types.ts.

export interface SongSummary {
  id: string;
  title: string;
  savedAt: number;
  updatedAt: number;
  /** Opaque concurrency token. Regenerated on every successful write.
   *  Clients keep the version they last loaded against and pass it on
   *  subsequent writes; if cloud's current version differs, the write
   *  fails with 409 Conflict (issue #87 — Tier 1 conflict-aware sync). */
  version: string;
  /** Optional folder for the My Songs picker. Synced so multiple devices
   *  see the same organization. */
  folder?: string;
}

export interface SongDTO extends SongSummary {
  score: Record<string, unknown>;
}

export interface ApiError {
  error: string;
  /** When error === "conflict", the current cloud DTO is included so the
   *  client can show a side-by-side diff without a second round trip. */
  current?: SongDTO;
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
