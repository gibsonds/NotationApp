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

/**
 * Recognises titles that past autosave-recovery / dedup-cleanup /
 * change-marker flows suffixed to disambiguate copies, e.g.
 *   "Anywhere (snapped)"
 *   "Foggy Night (recovered 9:06 PM)"
 *   "Star to Star (latest 10:37 PM)"
 *   "Foggy Night (with highlights 10:26 PM)"
 *   "Star to Star (chords fixed 9:59 PM)"
 *   "Anywhere (old)"
 * These are alias entries — we hide them from the Sets candidate
 * picker and offer a one-click cleanup. Returns the canonical title
 * (suffix stripped) if matched, else null.
 *
 * Two complementary rules so we keep matching new auto-generated
 * patterns without enumerating each one:
 *
 *   1. Known-verb prefix: `(snapped|recovered|latest|with X|chords X|
 *      lyrics X|fixed X|old)` followed by anything.
 *   2. Trailing timestamp: any parenthetical that *ends with* a clock
 *      time like "9:06 PM" — typical of save-timestamp aliasing.
 *
 * Bare keywords like "(live version)" or "(acoustic)" stay matched
 * as user-meaningful titles, not aliases.
 */
export function aliasCanonicalTitle(title: string): string | null {
  // Keyword-prefix patterns the codebase or migration scripts have
  // historically generated.
  const KEYWORDS = [
    "snapped",
    "recovered",
    "latest",
    "with highlights",
    "with chords",
    "chords fixed",
    "lyrics fixed",
    "fixed",
    "old",
  ];
  const keywordAlt = KEYWORDS.map((k) => k.replace(/\s/g, "\\s")).join("|");
  const keywordRe = new RegExp(
    `^(.*?)\\s*\\((?:${keywordAlt})(?:\\s[^)]*)?\\)\\s*$`,
    "i",
  );
  const m1 = title.match(keywordRe);
  if (m1) return m1[1].trim();
  // Safety net: any parenthetical that ENDS with an HH:MM AM/PM
  // timestamp. Catches future auto-generated patterns without
  // updating the keyword list (e.g. "(remixed 10:42 PM)").
  const m2 = title.match(/^(.*?)\s*\([^)]*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)\)\s*$/);
  if (m2) return m2[1].trim();
  return null;
}

/** True if the title looks like an autosave-/recovery-/sync-generated alias. */
export function isAliasTitle(title: string): boolean {
  return aliasCanonicalTitle(title) !== null;
}

/**
 * Canonical form of a song title for equality comparison. Folds the
 * surprising-divergence sources we've actually hit in user data:
 *
 *   - NFC vs NFD: macOS dead-key input ("Cafe" + combining-acute) hashes
 *     differently from precomposed "Café" without `.normalize("NFC")`.
 *   - Smart quotes: iOS auto-corrects ' → ’ and " → ”. "Friday's gig"
 *     from iPad would otherwise miss "Friday's gig" typed elsewhere.
 *   - Whitespace: nbsp (U+00A0), tabs, double spaces — all collapse to
 *     a single regular space. `\s` in modern JS already matches Unicode
 *     whitespace including nbsp, so /\s+/g is enough.
 *   - Case + leading/trailing whitespace.
 *
 * Use for any dedup or membership check that should treat
 * visually-identical titles as the same song.
 */
export function canonicalSongTitle(s: string): string {
  return (s ?? "")
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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
