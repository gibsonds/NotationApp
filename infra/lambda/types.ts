// Server-side types. The Score blob is opaque here — the frontend has the
// real Zod-typed Score in src/lib/schema.ts, mirrored alongside these in
// src/lib/song-cloud-types.ts.

export interface SongSummary {
  id: string;
  title: string;
  savedAt: number;
  updatedAt: number;
}

export interface SongDTO extends SongSummary {
  score: Record<string, unknown>;
}

export interface ApiError {
  error: string;
}
