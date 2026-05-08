// Frontend mirror of infra/lambda/types.ts. Frontend keeps the real Score
// type; backend treats score as opaque. Drift between the two is caught by
// e2e/song-cloud-types.spec.ts.

import type { Score } from "@/lib/schema";

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
  /** Optional folder for the My Songs picker. Synced across devices. */
  folder?: string;
}

export interface SongDTO extends SongSummary {
  score: Score;
}

export interface ApiError {
  error: string;
  /** When error === "conflict", the current cloud DTO is included so the
   *  client can show a side-by-side diff without a second round trip. */
  current?: SongDTO;
}

export interface VersionEntry {
  ts: number;
  kind: "auto" | "daily" | "named";
  name?: string;
  title?: string;
  savedAt?: number;
}
