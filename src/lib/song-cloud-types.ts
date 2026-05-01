// Frontend mirror of infra/lambda/types.ts. Frontend keeps the real Score
// type; backend treats score as opaque. Drift between the two is caught by
// e2e/song-cloud-types.spec.ts.

import type { Score } from "@/lib/schema";

export interface SongSummary {
  id: string;
  title: string;
  savedAt: number;
  updatedAt: number;
}

export interface SongDTO extends SongSummary {
  score: Score;
}

export interface ApiError {
  error: string;
}
