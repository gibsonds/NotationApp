import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("resumes the token after simulated hosted sign-in, then joins only on the signed-in click", async () => {
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("NEXT_PUBLIC_OAUTH_ISSUER", "https://fake-idp.test");
  vi.stubEnv("NEXT_PUBLIC_OAUTH_CLIENT_ID", "preview-only");
  vi.stubEnv("NEXT_PUBLIC_API_BASE", "https://fake-charts-api.test");
  vi.stubEnv("NEXT_PUBLIC_COOKIE_SESSIONS", "1");
  const { default: Flow } = await import("../SongbookInviteFlow");
  const auth = await import("@/lib/auth");
  const { takeSongBrowserIntent, matchesSongBrowserIntent } = await import("@/lib/songbook-browser-intent");
  const { readPendingInvitation, clearPendingInvitation } = await import("@/lib/pending-invitation");
  const originalUrl = window.location.href;
  const nav = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  const reload = vi.spyOn(window.location,"reload").mockImplementation(() => {});
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const root = createRoot(mount);
  // Shared and owned books can have the same name; navigation must use the
  // accepted membership's ID rather than the recipient's empty namesake.
  const personal = {songbookId:"demo-home",name:"My Songs",role:"owner"};
  const testBook = {songbookId:"demo-shared",name:"My Songs",role:"viewer"};
  let accepted = false;
  const fakeFetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/oauth/exchange")) return Response.json({ok:true});
    if (url.endsWith("/me")) return Response.json({sub:"test-user",memberships:accepted ? [personal,testBook] : [personal]});
    if (url.endsWith("/invites/demo-invite/accept") && options?.method === "POST") {
      accepted = true;
      return Response.json(testBook);
    }
    throw new Error("Unexpected network request during test");
  });
  vi.stubGlobal("fetch",fakeFetch);
  const primary = () => mount.querySelector<HTMLButtonElement>("section button")!;
  try {
    window.history.replaceState(null, "", "/?invite=demo-invite");
    const invite = readPendingInvitation();
    expect(invite).toBe("demo-invite");
    expect(window.location.href).not.toContain("demo-invite");
    await act(async () => root.render(<Flow token={invite} ready signedIn={false} onLeave={clearPendingInvitation} />));
    expect(primary().textContent).toBe("Continue to sign in");
    expect(mount.textContent).not.toContain("demo-invite");
    await act(async () => primary().click());
    expect(nav).toHaveBeenCalledOnce();
    const redirect = new URL(nav.mock.calls[0][0]);
    expect(redirect.origin + redirect.pathname).toBe("https://fake-idp.test/oauth2/authorize");
    expect(fakeFetch).not.toHaveBeenCalled();

    // Simulated provider callback, with the public invite query absent.
    window.history.replaceState(null, "", "/");
    expect(await auth.completeSignIn("test-auth-code", redirect.searchParams.get("state")!)).toBe(true);
    expect(readPendingInvitation()).toBe(invite);
    expect(auth.getSnapshot().status).toBe("signed-in");
    // A real callback reloads the page, so remount the invitation component.
    await act(async () => root.render(<Flow key="after-callback" token={invite} ready signedIn onLeave={clearPendingInvitation} />));
    expect(primary().textContent).toBe("Join songbook");
    expect(accepted).toBe(false);
    expect(takeSongBrowserIntent()).toBeNull();
    await act(async () => primary().click());
    expect(accepted).toBe(true);
    expect(auth.getActiveSongbookId()).toBe(testBook.songbookId);
    expect(auth.getSnapshot().memberships.some(book => book.songbookId === testBook.songbookId)).toBe(true);
    expect(readPendingInvitation()).toBe("");
    expect(reload).toHaveBeenCalledOnce();
    const intent=takeSongBrowserIntent();
    expect(matchesSongBrowserIntent(intent,'test-user',testBook.songbookId)).toBe(true);
    expect(takeSongBrowserIntent()).toBeNull();
  } finally {
    await act(async () => root.unmount());
    mount.remove();
    window.history.replaceState(null, "", originalUrl);
  }
});

it("keeps a legacy invitation available when browser storage blocks selecting the joined book", async () => {
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("NEXT_PUBLIC_OAUTH_ISSUER", "https://fake-idp.test");
  vi.stubEnv("NEXT_PUBLIC_OAUTH_CLIENT_ID", "preview-only");
  vi.stubEnv("NEXT_PUBLIC_API_BASE", "https://fake-charts-api.test");
  vi.stubEnv("NEXT_PUBLIC_COOKIE_SESSIONS", "1");
  const { default: Flow } = await import("../SongbookInviteFlow");
  const auth = await import("@/lib/auth");
  const { takeSongBrowserIntent } = await import("@/lib/songbook-browser-intent");
  const { readPendingInvitation, clearPendingInvitation } = await import("@/lib/pending-invitation");
  const own = {songbookId:"demo-home",name:"My Songs",role:"owner"};
  const shared = {songbookId:"demo-shared",name:"My Songs",role:"editor"};
  let accepted = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/me")) return Response.json({sub:"test-user",memberships:accepted ? [own,shared] : [own]});
    if (url.endsWith("/invites/demo-storage/accept")) { accepted = true; return Response.json(shared); }
    throw new Error("Unexpected network request during test");
  }));
  await auth.loadMe();
  const reload = vi.spyOn(window.location,"reload").mockImplementation(() => {});
  const originalUrl = window.location.href;
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const root = createRoot(mount);
  const leave = vi.fn(clearPendingInvitation), showList = vi.fn();
  const realSetItem = localStorage.setItem.bind(localStorage);
  try {
    window.history.replaceState(null, "", "/?invite=demo-storage");
    expect(readPendingInvitation()).toBe("demo-storage");
    await act(async () => root.render(<Flow token="demo-storage" ready signedIn onLeave={leave} onOpenBook={showList} />));
    const storage = vi.spyOn(localStorage,"setItem").mockImplementation((key, value) => {
      if (key === "notation-app-active-songbook" && value === shared.songbookId) throw new Error("synthetic blocked storage");
      return realSetItem(key,value);
    });
    await act(async () => mount.querySelector<HTMLButtonElement>("section button")!.click());
    expect(accepted).toBe(true);
    expect(mount.textContent).toContain("Allow browser storage and try again.");
    expect(readPendingInvitation()).toBe("demo-storage");
    expect(auth.getActiveSongbookId()).toBe(own.songbookId);
    expect(takeSongBrowserIntent()).toBeNull();
    expect(leave).not.toHaveBeenCalled();
    expect(showList).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    storage.mockRestore();
    await act(async () => mount.querySelector<HTMLButtonElement>("section button")!.click());
    expect(auth.getActiveSongbookId()).toBe(shared.songbookId);
    expect(readPendingInvitation()).toBe("");
    expect(leave).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    mount.remove();
    window.history.replaceState(null, "", originalUrl);
  }
});
