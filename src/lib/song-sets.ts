/**
 * Set lists (#73). A SongSet is an ordered list of song-bank entry ids
 * (chord charts or notation scores) that the user wants to play together
 * — typically a gig, rehearsal, or practice grouping.
 *
 * Storage: localStorage. Cloud sync deferred until #74 (auth) lands so
 * sets can be properly authorized per-user. Each device today has its
 * own sets.
 */

import { z } from "zod";
import { isAliasTitle, type SongBankEntry } from "@/lib/song-bank";

const STORAGE_KEY = "notation-app-song-sets";
const SETS_UPDATED_EVENT = "notation-sets-updated";

export const SongSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Ordered list of song-bank entry ids. Items not present in My Songs
   *  are skipped at render time but kept here so they reappear if the
   *  user re-imports the missing song. */
  songIds: z.array(z.string()),
  createdAt: z.number(),
  /** Last time the set's name or songIds were edited. */
  updatedAt: z.number(),
});
export type SongSet = z.infer<typeof SongSetSchema>;

const SongSetListSchema = z.array(SongSetSchema);

/** Event name dispatched whenever the sets list is rewritten. UI keeps
 *  itself in sync without polling. */
export const SetsUpdatedEvent = SETS_UPDATED_EVENT;

function fireUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SETS_UPDATED_EVENT));
}

export function getSets(): SongSet[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = SongSetListSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function writeSets(sets: SongSet[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
    fireUpdated();
  } catch {
    console.warn("[song-sets] localStorage write failed");
  }
}

/** Create a new (empty) set with the given name. Returns the new entry. */
export function createSet(name: string): SongSet {
  const now = Date.now();
  const entry: SongSet = {
    id: `set-${now}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || "Untitled set",
    songIds: [],
    createdAt: now,
    updatedAt: now,
  };
  writeSets([...getSets(), entry]);
  return entry;
}

export function renameSet(id: string, name: string): SongSet | null {
  const sets = getSets();
  const idx = sets.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed === sets[idx].name) return sets[idx];
  const updated: SongSet = { ...sets[idx], name: trimmed, updatedAt: Date.now() };
  const next = [...sets];
  next[idx] = updated;
  writeSets(next);
  return updated;
}

export function deleteSet(id: string): void {
  writeSets(getSets().filter((s) => s.id !== id));
}

/** Add a song id to a set. No-op if it's already there (sets keep song
 *  order but don't allow duplicates — playing the same chart twice in a
 *  row is too unusual to design for). */
export function addSongToSet(setId: string, songId: string): SongSet | null {
  const sets = getSets();
  const idx = sets.findIndex((s) => s.id === setId);
  if (idx === -1) return null;
  if (sets[idx].songIds.includes(songId)) return sets[idx];
  const updated: SongSet = {
    ...sets[idx],
    songIds: [...sets[idx].songIds, songId],
    updatedAt: Date.now(),
  };
  const next = [...sets];
  next[idx] = updated;
  writeSets(next);
  return updated;
}

export function removeSongFromSet(setId: string, songId: string): SongSet | null {
  const sets = getSets();
  const idx = sets.findIndex((s) => s.id === setId);
  if (idx === -1) return null;
  const filtered = sets[idx].songIds.filter((id) => id !== songId);
  if (filtered.length === sets[idx].songIds.length) return sets[idx];
  const updated: SongSet = {
    ...sets[idx],
    songIds: filtered,
    updatedAt: Date.now(),
  };
  const next = [...sets];
  next[idx] = updated;
  writeSets(next);
  return updated;
}

/** Reorder songs inside a set. From and to are 0-indexed positions in
 *  the songIds array. */
/**
 * Per-song set-membership index. Returns a Map keyed by songId
 * pointing at the list of full SongSet objects the song is a member
 * of. Pure function — caller decides whether it wants names (for the
 * "In N sets" badge), set ids (for the Perform switch-to-set chip
 * action), or full objects.
 *
 * Order within each songId's list follows the input `sets` order so
 * the UI sees stable chip / pill ordering across renders.
 */
export function songSetMembership(sets: SongSet[]): Map<string, SongSet[]> {
  const map = new Map<string, SongSet[]>();
  for (const s of sets) {
    for (const id of s.songIds) {
      const cur = map.get(id);
      if (cur) cur.push(s);
      else map.set(id, [s]);
    }
  }
  return map;
}

/**
 * Songs eligible to be added to a given set. Drops songs already in
 * the set and drops alias artifacts (titles ending in "(snapped)",
 * "(recovered ...)", "(latest ...)"). Optionally applies a
 * case-insensitive substring search.
 *
 * Pure function — exported so AddToSetSheet's filter logic can be
 * unit-tested without rendering React.
 */
export function filterCandidatesForSheet(
  songs: SongBankEntry[],
  setSongIds: string[],
  query: string = "",
): SongBankEntry[] {
  const inSet = new Set(setSongIds);
  const q = query.trim().toLowerCase();
  return songs
    .filter((s) => !inSet.has(s.id))
    .filter((s) => !isAliasTitle(s.title))
    .filter((s) => !q || s.title.toLowerCase().includes(q));
}

export function reorderSong(setId: string, fromIdx: number, toIdx: number): SongSet | null {
  const sets = getSets();
  const idx = sets.findIndex((s) => s.id === setId);
  if (idx === -1) return null;
  const ids = [...sets[idx].songIds];
  if (fromIdx < 0 || fromIdx >= ids.length || toIdx < 0 || toIdx >= ids.length) return sets[idx];
  if (fromIdx === toIdx) return sets[idx];
  const [moved] = ids.splice(fromIdx, 1);
  ids.splice(toIdx, 0, moved);
  const updated: SongSet = { ...sets[idx], songIds: ids, updatedAt: Date.now() };
  const next = [...sets];
  next[idx] = updated;
  writeSets(next);
  return updated;
}
