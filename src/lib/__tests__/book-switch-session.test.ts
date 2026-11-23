import { afterEach, beforeEach, expect, it, vi } from "vitest";

const books = [{ songbookId: "a", name: "Band", role: "owner" }, { songbookId: "b", name: "TestBook", role: "viewer" }];
function response(sub = "alice", memberships = books) { return Response.json({ sub, memberships, email: "untrusted@gmail.com", method: "google" }); }
async function auth() { return import("../auth"); }
beforeEach(() => {
  vi.resetModules(); localStorage.clear(); sessionStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_OAUTH_ISSUER", "https://issuer.test"); vi.stubEnv("NEXT_PUBLIC_OAUTH_CLIENT_ID", "test-client");
  vi.stubEnv("NEXT_PUBLIC_COOKIE_SESSIONS", "1"); vi.stubEnv("NEXT_PUBLIC_API_BASE", "/auth-api");
  localStorage.setItem("notation-app-auth", JSON.stringify({ claims: { sub: "alice" } }));
  localStorage.setItem("notation-app-active-songbook", "a");
  vi.stubGlobal("fetch", vi.fn(async () => response()));
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("switches two synthetic books with separate caches and a one-shot browser restore after verification", async () => {
  let client = await auth(); await client.initAuth();
  let scope = await import("../songbook-storage");
  const keyA = scope.songbookStorageKey("notation-app-songs");
  localStorage.setItem(keyA, '["Band song"]');
  client.setActiveSongbook("b", true, { reopenMySongs: true });
  expect(window.location.reload).toHaveBeenCalledOnce(); expect(scope.songbookScopeIsCurrent()).toBe(false);
  vi.resetModules(); client = await auth(); scope = await import("../songbook-storage");
  const intent = await import("../songbook-browser-intent"); const ticket = intent.takeSongBrowserIntent();
  expect(client.getSnapshot().verifiedAccount).toBeNull();
  expect(intent.matchesSongBrowserIntent(ticket, null, "b")).toBe(false);
  await client.initAuth();
  expect(intent.matchesSongBrowserIntent(ticket, client.getSnapshot().verifiedAccount?.sub ?? null, client.getActiveSongbookId())).toBe(true);
  const keyB = scope.songbookStorageKey("notation-app-songs");expect(keyB).not.toBe(keyA);
  localStorage.setItem(keyB, '["TestBook song"]');
  expect(intent.takeSongBrowserIntent()).toBeNull(); // arbitrary later reload cannot replay
  client.setActiveSongbook("a", true, { reopenMySongs: true });
  expect(localStorage.getItem(keyA)).toBe('["Band song"]');expect(localStorage.getItem(keyB)).toBe('["TestBook song"]');
});
it("does not record browser restore for invitation/default switching, sign-out or invalid membership", async () => {
  const client = await auth(); await client.initAuth(); const intent = await import("../songbook-browser-intent");
  client.setActiveSongbook("b"); expect(intent.takeSongBrowserIntent()).toBeNull();
  expect(() => client.setActiveSongbook("other", true, { reopenMySongs: true })).toThrow(/belong/);
  intent.rememberSongBrowserIntent("alice", "b"); await client.signOut(); expect(intent.takeSongBrowserIntent()).toBeNull();
  expect(client.getSnapshot().verifiedAccount).toBeNull();
});
it("rejects old-account, wrong-book, expired and malformed resume instructions", async () => {
  const intent = await import("../songbook-browser-intent");
  intent.rememberSongBrowserIntent("alice", "b");const ticket = intent.takeSongBrowserIntent();
  expect(intent.matchesSongBrowserIntent(ticket, "bob", "b")).toBe(false);
  expect(intent.matchesSongBrowserIntent(ticket, "alice", "a")).toBe(false);
  vi.spyOn(Date,"now").mockReturnValue(Date.now()+31_000);
  expect(intent.matchesSongBrowserIntent(ticket,"alice","b")).toBe(false);
  sessionStorage.setItem("notation-app-resume-song-browser", "bad");expect(intent.takeSongBrowserIntent()).toBeNull();
});
it("ignores an older /me result and never adopts unverified email/method metadata", async () => {
  const client = await auth();let finish!: (r: Response)=>void;
  const fetch = vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>{finish=r;})).mockResolvedValueOnce(response("bob"));
  vi.stubGlobal("fetch",fetch);const old=client.loadMe();await Promise.resolve();await client.loadMe();finish(response("alice"));await old;
  expect(client.getSnapshot().verifiedAccount).toEqual({sub:"bob"});expect(client.getSnapshot().claims).toEqual({sub:"bob"});
});
it("ignores late session results after sign-out and after a different tab changes account", async () => {
  const client = await auth();await client.initAuth();let finish!:(r:Response)=>void;
  vi.stubGlobal("fetch",vi.fn((url:string)=>url.endsWith("/oauth/logout") ? Promise.resolve(Response.json({ok:true})) : new Promise<Response>(r=>{finish=r;})));
  const old=client.loadMe();await Promise.resolve();await client.signOut();finish(response());await old;
  expect(client.getSnapshot().status).toBe("signed-out");expect(client.getSnapshot().verifiedAccount).toBeNull();
  vi.stubGlobal("fetch",vi.fn(async()=>response()));await client.loadMe();
  const unsubscribe=client.subscribe(()=>{});
  localStorage.setItem("notation-app-auth",JSON.stringify({claims:{sub:"bob"}}));
  window.dispatchEvent(new StorageEvent("storage",{key:"notation-app-auth"}));
  expect(client.getSnapshot().verifiedAccount).toBeNull();unsubscribe();
});
it("ignores a pending /me response after switching books", async () => {
  const client=await auth();await client.initAuth();let finish!:(r:Response)=>void;
  vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(r=>{finish=r;})));
  const old=client.loadMe();await Promise.resolve();client.setActiveSongbook("b",true,{reopenMySongs:true});finish(response());await old;
  expect(client.getSnapshot().activeSongbookId).toBe("b");expect(client.getSnapshot().verifiedAccount).toBeNull();
});
it("rejects a late old-book network response before it can update state", async () => {
  const client=await auth();await client.initAuth();let finish!:(r:Response)=>void;
  vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(r=>{finish=r;})));
  const cloud=await import("../song-cloud");const request=cloud.cloudListSongs();
  const rejected=expect(request).rejects.toThrow(/Songbook changed/);
  await Promise.resolve();await Promise.resolve();
  client.setActiveSongbook("b",true,{reopenMySongs:true});finish(Response.json([{id:"old-song"}]));await rejected;
});
