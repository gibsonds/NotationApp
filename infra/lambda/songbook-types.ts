export type Role = "owner" | "editor" | "viewer";

export interface Membership {
  songbookId: string;
  name: string;
  role: Role;
  addedAt: number;
}

export interface Member {
  sub: string;
  role: Role;
  addedAt: number;
  email?: string;
}

export interface Invite {
  token: string;
  songbookId: string;
  role: Exclude<Role, "owner">;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
}

export interface SongSummaryB {
  id: string;
  title: string;
  savedAt: number;
  updatedAt: number;
  version: string;
  savedBy?: string;
  folder?: string;
}

export interface SongDTOB extends SongSummaryB {
  score: Record<string, unknown>;
}

export interface VersionEntryB {
  ts: number;
  kind: "auto" | "daily" | "named";
  name?: string;
  title?: string;
  savedAt?: number;
  savedBy?: string;
}
