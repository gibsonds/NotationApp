import type { Score } from "@/lib/schema";

export interface SongBankEntry {
  id: string;
  title: string;
  savedAt: number;
  score: Score;
  /** Optional folder name (e.g. "Originals", "Covers"). Songs without a
   *  folder appear under "(Unfiled)" in the My Songs picker. */
  folder?: string;
  /** Cloud version this entry was last synced from. Used as the
   *  expectedVersion on cloudPutSong so concurrent writes from another
   *  device get caught with a 409 instead of silently overwriting (#87). */
  cloudVersion?: string;
}

const STORAGE_KEY = "notation-app-songs";
const SONGS_UPDATED_EVENT = "notation-songs-updated";

/** Event name dispatched on the window every time the song bank in
 *  localStorage is rewritten. Listen for this to keep secondary views
 *  (perform-mode song picker, sidebar lists) in sync without polling. */
export const SongsUpdatedEvent = SONGS_UPDATED_EVENT;

function fireSongsUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SONGS_UPDATED_EVENT));
}

export function getSongs(): SongBankEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SongBankEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveSong(title: string, score: Score): void {
  const songs = getSongs();
  songs.push({
    id: `song-${Date.now()}`,
    title,
    savedAt: Date.now(),
    score: JSON.parse(JSON.stringify(score)),
  });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
    fireSongsUpdated();
  } catch {
    console.warn("[song-bank] localStorage quota exceeded");
  }
}

export function deleteSong(id: string): void {
  try {
    const songs = getSongs().filter(s => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
    fireSongsUpdated();
  } catch {
    console.warn("[song-bank] failed to delete song");
  }
}

export function setSongs(songs: SongBankEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
    fireSongsUpdated();
  } catch {
    console.warn("[song-bank] localStorage quota exceeded");
  }
}

/** Rename a single song in-place (preserves id, savedAt, score, folder).
 *  Returns the updated entry, or null if no song with that id was found. */
export function renameSong(id: string, title: string): SongBankEntry | null {
  const songs = getSongs();
  const idx = songs.findIndex(s => s.id === id);
  if (idx === -1) return null;
  const next: SongBankEntry = { ...songs[idx], title };
  songs[idx] = next;
  setSongs(songs); // dispatches SongsUpdatedEvent
  return next;
}

/** Update an existing song in-place. Returns the updated entry, or null
 *  if no song with that id was found. Use this for Save (overwriting the
 *  current song) instead of saveSong (which always creates a new entry). */
export function updateSong(
  id: string,
  patch: Partial<Pick<SongBankEntry, "title" | "score" | "savedAt" | "folder" | "cloudVersion">>,
): SongBankEntry | null {
  const songs = getSongs();
  const idx = songs.findIndex(s => s.id === id);
  if (idx === -1) return null;
  const next: SongBankEntry = {
    ...songs[idx],
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.score !== undefined ? { score: JSON.parse(JSON.stringify(patch.score)) } : {}),
    ...(patch.savedAt !== undefined ? { savedAt: patch.savedAt } : {}),
    ...(patch.folder !== undefined ? { folder: patch.folder } : {}),
    ...(patch.cloudVersion !== undefined ? { cloudVersion: patch.cloudVersion } : {}),
  };
  songs[idx] = next;
  setSongs(songs);
  return next;
}

/** Set or clear a song's folder. Pass null/"" to remove it (back to
 *  "Unfiled"). */
export function setSongFolder(id: string, folder: string | null): SongBankEntry | null {
  const songs = getSongs();
  const idx = songs.findIndex(s => s.id === id);
  if (idx === -1) return null;
  const cur = songs[idx];
  const next: SongBankEntry = { ...cur };
  if (folder && folder.trim()) next.folder = folder.trim();
  else delete next.folder;
  songs[idx] = next;
  setSongs(songs);
  return next;
}
