import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function session(sub: string, book: string) {
  localStorage.setItem("notation-app-auth", JSON.stringify({ access_token: `token-${sub}`, expires_at: Date.now() + 3600000, claims: { sub } }));
  localStorage.setItem("notation-app-active-songbook", book);
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_OAUTH_ISSUER", "https://issuer.test");
  vi.stubEnv("NEXT_PUBLIC_OAUTH_CLIENT_ID", "test-client");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("authenticated songbook isolation", () => {
  it("keeps song lists, queues, and editor drafts in distinct account/book namespaces", async () => {
    session("alice", "band");
    const first = await import("../songbook-storage");
    const keys = ["notation-app-songs", "notation-app-cloud-queue", "notation-app-store", "notationapp-autosave", "notationapp-songbank", "notation-app-song-sets"];
    for (const key of keys) localStorage.setItem(first.songbookStorageKey(key), "Alice's draft");
    session("bob", "band");
    expect(first.songbookScopeIsCurrent()).toBe(false);
    // In-flight callbacks still belong to the page's original book.
    for (const key of keys) expect(localStorage.getItem(first.songbookStorageKey(key))).toBe("Alice's draft");
    vi.resetModules();
    const second = await import("../songbook-storage");
    for (const key of keys) expect(localStorage.getItem(second.songbookStorageKey(key))).toBeNull();
    session("bob", "solo");
    expect(second.songbookScopeIsCurrent()).toBe(false);
  });

  it("leaves GitHub Pages storage keys unchanged", async () => {
    vi.stubEnv("NEXT_PUBLIC_OAUTH_CLIENT_ID", "");
    const storage = await import("../songbook-storage");
    expect(storage.songbookStorageKey("notation-app-songs")).toBe("notation-app-songs");
    expect(storage.songbookScopeIsCurrent()).toBe(true);
  });

  it("fails closed when signed out instead of sending anonymous data requests", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const cloud = await import("../song-cloud");
    await expect(cloud.cloudListSongs()).rejects.toThrow("Sign in");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a save if another tab changed the songbook", async () => {
    session("alice", "band");
    const cloud = await import("../song-cloud");
    session("alice", "solo");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(cloud.cloudListSongs()).rejects.toThrow("Songbook changed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pins the request to the original book while refreshing a token", async () => {
    session("alice", "band");
    localStorage.setItem("notation-app-auth", JSON.stringify({ access_token: "expired", refresh_token: "refresh", expires_at: 0, claims: { sub: "alice" } }));
    let resolveRefresh!: (response: Response) => void;
    const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(resolve => { resolveRefresh = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const cloud = await import("../song-cloud");
    const request = cloud.cloudListSongs();
    const result = expect(request).rejects.toThrow("Sign in");
    localStorage.setItem("notation-app-active-songbook", "solo");
    resolveRefresh(new Response(JSON.stringify({ access_token: "new-token", expires_in: 3600 })));
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("/oauth/refresh");
  });
});
