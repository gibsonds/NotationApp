/** Navigation preferences never establish identity, membership or a personal-book role. */
interface BookChoice {
  songbookId: string;
  name: string;
  role: "owner" | "editor" | "viewer";
}

export function songbookPreferenceKey(sub: string): string {
  return `notation-app-songbook-choice:${encodeURIComponent(sub)}`;
}

export function chooseSongbook({
  sub, memberships, verifiedCurrentSub, currentBookId, preferredBookId,
}: {
  sub: string;
  memberships: readonly BookChoice[];
  verifiedCurrentSub: string | null;
  currentBookId: string | null;
  preferredBookId: string | null;
}): string | null {
  const belongs = (id: string | null) => !!id && memberships.some(book => book.songbookId === id);
  if (verifiedCurrentSub === sub && belongs(currentBookId)) return currentBookId;
  if (belongs(preferredBookId)) return preferredBookId;
  // Existing accounts have no server-declared personal/default marker. This is
  // only an unambiguous navigation fallback, never a permission inference.
  const home = memberships.filter(book => book.role === "owner" && book.name === "My Songs");
  if (home.length === 1) return home[0].songbookId;
  if (memberships.length === 1) return memberships[0].songbookId;
  return null; // Offer the picker instead of choosing by random UUID order.
}
