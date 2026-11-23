/** One navigation only; no credentials, song contents or display names. */
const KEY = "notation-app-resume-song-browser";
const MAX_AGE_MS = 30_000;
export interface SongBrowserIntent { sub: string; book: string; createdAt: number }

export function clearSongBrowserIntent(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* unavailable storage */ }
}
export function rememberSongBrowserIntent(sub: string, book: string): void {
  clearSongBrowserIntent();
  try { sessionStorage.setItem(KEY, JSON.stringify({ sub, book, createdAt: Date.now() })); } catch { /* switching still works */ }
}
/** Remove immediately on the next document, before awaiting session checks.
 * A refresh, failed bootstrap or later sign-in cannot replay this instruction. */
export function takeSongBrowserIntent(): SongBrowserIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    clearSongBrowserIntent();
    const value = JSON.parse(raw ?? "null");
    if (typeof value?.sub !== "string" || typeof value.book !== "string" ||
      typeof value.createdAt !== "number" || value.createdAt > Date.now() ||
      Date.now() - value.createdAt > MAX_AGE_MS) return null;
    return value;
  } catch { return null; }
}

export function matchesSongBrowserIntent(intent: SongBrowserIntent | null, sub: string | null, book: string | null): boolean {
  return !!intent && intent.sub === sub && intent.book === book &&
    Date.now() >= intent.createdAt && Date.now() - intent.createdAt <= MAX_AGE_MS;
}
