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
  const { readPendingInvitation, clearPendingInvitation } = await import("@/lib/pending-invitation");
  const originalUrl = window.location.href;
  const nav = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  const reload = vi.spyOn(window.location,"reload").mockImplementation(() => {});
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const root = createRoot(mount);
  const personal = {songbookId:"demo-home",name:"Demo account",role:"owner"};
  const testBook = {songbookId:"demo-shared",name:"TestBook",role:"viewer"};
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
    await act(async () => primary().click());
    expect(accepted).toBe(true);
    expect(auth.getActiveSongbookId()).toBe(testBook.songbookId);
    expect(auth.getSnapshot().memberships.some(book => book.name === "TestBook")).toBe(true);
    expect(readPendingInvitation()).toBe("");
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    mount.remove();
    window.history.replaceState(null, "", originalUrl);
  }
});
