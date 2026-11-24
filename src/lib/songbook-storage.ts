/** A page owns one account/songbook namespace for its entire lifetime.
 * Switching books reloads the page, so delayed saves and IndexedDB callbacks
 * can never start writing into the newly selected book. Legacy keys stay intact.
 */
const enabled = !!(process.env.NEXT_PUBLIC_OAUTH_ISSUER && process.env.NEXT_PUBLIC_OAUTH_CLIENT_ID);

function currentScope(): string {
  if (!enabled) return "";
  try {
    const tokens = JSON.parse(localStorage.getItem("notation-app-auth") ?? "null");
    const sub = tokens?.claims?.sub;
    const book = localStorage.getItem("notation-app-active-songbook");
    return sub && book ? `${encodeURIComponent(sub)}:${encodeURIComponent(book)}` : "signed-out";
  } catch {
    return "signed-out";
  }
}

const pageScope = currentScope();
let scopeValid = true;

/** Keep the existing namespace pinned, but stop cloud work if verified identity
 * metadata cannot be persisted safely. A fresh document can verify it again. */
export function invalidateSongbookScope(): void {
  scopeValid = false;
}

export function songbookStorageKey(key: string): string {
  return pageScope ? `${key}:${pageScope}` : key;
}

export function songbookScopeIsCurrent(): boolean {
  return scopeValid && pageScope === currentScope();
}
