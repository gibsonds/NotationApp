import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { songbookPreferenceKey } from "../songbook-preference";
import type { Membership } from "../auth";

const ACTIVE = "notation-app-active-songbook";
const TOKENS = "notation-app-auth";
const PKCE = "notation-app-pkce";
const testBook = { songbookId: "a-test", name: "TestBook", role: "owner" as const };
const home = { songbookId: "z-home", name: "My Songs", role: "owner" as const };
const books: Membership[] = [testBook, home];
function me(sub = "alice", memberships: Membership[] = books) { return Response.json({ sub, memberships }); }
async function auth() { return import("../auth"); }
function failStorageWrite(keyToFail: string) {
  const storage = localStorage;
  vi.stubGlobal("localStorage", {
    getItem: storage.getItem.bind(storage), removeItem: storage.removeItem.bind(storage),
    setItem: (key: string, value: string) => {
      if (key === keyToFail) throw new Error("storage unavailable");
      storage.setItem(key, value);
    },
  });
}

beforeEach(() => {
  vi.resetModules(); localStorage.clear(); sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.stubEnv("NEXT_PUBLIC_OAUTH_ISSUER", "https://issuer.test");
  vi.stubEnv("NEXT_PUBLIC_OAUTH_CLIENT_ID", "client-test");
  vi.stubEnv("NEXT_PUBLIC_COOKIE_SESSIONS", "1");
  vi.stubEnv("NEXT_PUBLIC_API_BASE", "/auth-api");
  localStorage.setItem(TOKENS, JSON.stringify({ claims: { sub: "alice" } }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/me") ? me() : Response.json({ ok: true })));
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("verified songbook navigation", () => {
  it("chooses the unique owned My Songs instead of first-UUID TestBook without recording a fabricated choice", async () => {
    const client = await auth(); await client.loadMe();
    expect(client.getActiveSongbookId()).toBe(home.songbookId);
    expect(localStorage.getItem(ACTIVE)).toBe(home.songbookId);
    expect(localStorage.getItem(songbookPreferenceKey("alice"))).toBeNull();
  });

  it("does not adopt the legacy global TestBook selection after sign-in", async () => {
    localStorage.setItem(ACTIVE, testBook.songbookId);
    const client = await auth(); await client.loadMe();
    expect(client.getSnapshot().activeSongbookId).toBe(home.songbookId);
  });

  it("restores explicit account choices across ordinary sign-out and sign-in", async () => {
    let client = await auth(); await client.loadMe();
    client.setActiveSongbook(testBook.songbookId);
    expect(localStorage.getItem(songbookPreferenceKey("alice"))).toBe(testBook.songbookId);
    await client.signOut();
    expect(localStorage.getItem(ACTIVE)).toBeNull();
    expect(localStorage.getItem(songbookPreferenceKey("alice"))).toBe(testBook.songbookId);
    vi.resetModules(); client = await auth(); await client.loadMe();
    expect(client.getSnapshot().activeSongbookId).toBe(testBook.songbookId);
  });

  it("clears local choices with Clear device", async () => {
    const client = await auth(); await client.loadMe(); client.setActiveSongbook(testBook.songbookId);
    vi.stubGlobal("indexedDB", { databases: vi.fn(async () => []) });
    await client.signOut(true);
    expect(localStorage.getItem(songbookPreferenceKey("alice"))).toBeNull();
  });

  it("does not inherit another account's selection even for a shared membership", async () => {
    localStorage.setItem(ACTIVE, testBook.songbookId);
    localStorage.setItem(songbookPreferenceKey("alice"), testBook.songbookId);
    const bobHome = { ...home, songbookId: "bob-home" };
    vi.stubGlobal("fetch", vi.fn(async () => me("bob", [{ ...testBook, role: "viewer" }, bobHome])));
    const client = await auth(); await client.loadMe();
    expect(client.getSnapshot().verifiedAccount).toEqual({ sub: "bob" });
    expect(client.getSnapshot().activeSongbookId).toBe(bobHome.songbookId);
    expect(localStorage.getItem(songbookPreferenceKey("bob"))).toBeNull();
  });

  it("ignores a revoked remembered membership", async () => {
    localStorage.setItem(songbookPreferenceKey("alice"), testBook.songbookId);
    vi.stubGlobal("fetch", vi.fn(async () => me("alice", [home])));
    const client = await auth(); await client.loadMe();
    expect(client.getSnapshot().activeSongbookId).toBe(home.songbookId);
    expect(() => client.setActiveSongbook(testBook.songbookId)).toThrow(/belong/);
  });

  it("keeps an already-verified active book during a same-page membership refresh", async () => {
    localStorage.setItem(songbookPreferenceKey("alice"), testBook.songbookId);
    const client = await auth(); await client.loadMe();
    localStorage.removeItem(songbookPreferenceKey("alice"));
    await client.loadMe();
    expect(client.getSnapshot().activeSongbookId).toBe(testBook.songbookId);
  });

  it("records an explicit selection of the already-active sole shared book", async () => {
    const shared = { ...testBook, role: "viewer" as const };
    vi.stubGlobal("fetch", vi.fn(async () => me("alice", [shared])));
    const client = await auth(); await client.initAuth();
    expect(client.getSnapshot().activeSongbookId).toBe(shared.songbookId);
    expect(window.location.reload).toHaveBeenCalledOnce(); // verified initial scope boundary
    client.setActiveSongbook(shared.songbookId);
    expect(localStorage.getItem(songbookPreferenceKey("alice"))).toBe(shared.songbookId);
    expect(window.location.reload).toHaveBeenCalledOnce(); // same book needs no extra reload
  });

  it("offers explicit selection for ambiguous or renamed books instead of UUID order", async () => {
    const alternatives = [testBook, { ...home, name: "Rehearsals" }];
    localStorage.setItem(ACTIVE, testBook.songbookId);
    vi.stubGlobal("fetch", vi.fn(async () => me("alice", alternatives)));
    const client = await auth(); await client.loadMe();
    expect(client.getSnapshot().activeSongbookId).toBeNull();
    expect(client.getActiveSongbookId()).toBeNull(); expect(localStorage.getItem(ACTIVE)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => me("alice", [home, { ...home, songbookId: "second-home" }])));
    await client.loadMe(); expect(client.getSnapshot().activeSongbookId).toBeNull();
  });

  it("preserves the previous page namespace when saving a preference fails", async () => {
    localStorage.setItem(ACTIVE, home.songbookId);
    const client = await auth(); await client.loadMe();
    const storage = await import("../songbook-storage");
    failStorageWrite(songbookPreferenceKey("alice"));
    expect(() => client.setActiveSongbook(testBook.songbookId)).toThrow(/browser storage/);
    expect(client.getSnapshot().activeSongbookId).toBe(home.songbookId);
    expect(localStorage.getItem(ACTIVE)).toBe(home.songbookId);
    expect(storage.songbookScopeIsCurrent()).toBe(true);
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it("rolls back the preference when the active namespace cannot be saved", async () => {
    localStorage.setItem(ACTIVE, home.songbookId);
    const client = await auth(); await client.loadMe(); failStorageWrite(ACTIVE);
    expect(() => client.setActiveSongbook(testBook.songbookId)).toThrow(/browser storage/);
    expect(localStorage.getItem(songbookPreferenceKey("alice"))).toBeNull();
    expect(client.getSnapshot().activeSongbookId).toBe(home.songbookId);
    expect(localStorage.getItem(ACTIVE)).toBe(home.songbookId);
  });

  it("invalidates the page for cloud work if a different verified identity cannot be persisted", async () => {
    localStorage.setItem(ACTIVE, home.songbookId);
    const client = await auth(); await client.loadMe();
    const storage = await import("../songbook-storage");
    const previousKey = storage.songbookStorageKey("notation-app-songs");
    failStorageWrite(TOKENS);
    const fetch = vi.fn(async () => me("bob")); vi.stubGlobal("fetch", fetch);
    await expect(client.loadMe()).rejects.toThrow(/Account could not be saved/);
    expect(client.getSnapshot().verifiedAccount).toBeNull();
    expect(storage.songbookScopeIsCurrent()).toBe(false);
    expect(storage.songbookStorageKey("notation-app-songs")).toBe(previousKey);
    const cloud = await import("../song-cloud");
    await expect(cloud.cloudListSongs()).rejects.toThrow(/Songbook changed/);
    expect(fetch).toHaveBeenCalledOnce(); // /me only; no song request
  });
});

describe("sign-in destination", () => {
  async function finish() {
    const client = await auth();
    sessionStorage.setItem(PKCE, JSON.stringify({ verifier: "synthetic-verifier", state: "synthetic-state", nonce: "synthetic-nonce" }));
    expect(await client.completeSignIn("synthetic-code", "synthetic-state")).toBe(true);
    return client;
  }

  it("reopens My Songs once after ordinary verified sign-in", async () => {
    const client = await finish(); const intent = await import("../songbook-browser-intent");
    const ticket = intent.takeSongBrowserIntent();
    expect(intent.matchesSongBrowserIntent(ticket, client.getSnapshot().verifiedAccount?.sub ?? null, home.songbookId)).toBe(true);
    expect(intent.takeSongBrowserIntent()).toBeNull();
  });

  it("reopens the explicit picker when no book is unambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/me")
      ? me("alice", [testBook, { ...home, name: "Rehearsals" }]) : Response.json({ ok: true })));
    await finish(); const intent = await import("../songbook-browser-intent");
    const ticket = intent.takeSongBrowserIntent();
    expect(intent.matchesSongBrowserIntent(ticket, "alice", null)).toBe(true);
    expect(intent.matchesSongBrowserIntent(ticket, "bob", null)).toBe(false);
  });

  it("keeps pending invitations in charge of return navigation and preserves an explicit accepted-book target", async () => {
    sessionStorage.setItem("notation-app-pending-invite", "synthetic-invite");
    let client = await finish(); const intent = await import("../songbook-browser-intent");
    expect(intent.takeSongBrowserIntent()).toBeNull();
    expect(sessionStorage.getItem("notation-app-pending-invite")).toBe("synthetic-invite");
    // Acceptance/controller code explicitly selects a verified membership.
    client.setActiveSongbook(testBook.songbookId);
    vi.resetModules(); client = await auth(); await client.loadMe();
    expect(client.getSnapshot().activeSongbookId).toBe(testBook.songbookId);
    expect(intent.takeSongBrowserIntent()).toBeNull();
  });

  it("returns to the explicitly accepted shared My Songs instead of the empty owned namesake", async () => {
    const shared = { ...home, songbookId: "shared-home", role: "editor" as const };
    const memberships: Membership[] = [home, shared];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/me") ? me("alice", memberships) : Response.json({ ok: true })));
    let client = await auth(); await client.loadMe();
    expect(client.getActiveSongbookId()).toBe(home.songbookId);
    client.setActiveSongbook(shared.songbookId);
    await client.signOut(); vi.resetModules(); client = await finish();
    expect(client.getSnapshot().activeSongbookId).toBe(shared.songbookId);
    expect(client.getSnapshot().memberships.find(book => book.songbookId === shared.songbookId)?.role).toBe("editor");
  });
});
