/**
 * Client auth-module tests. auth.ts computes AUTH_ENABLED from env at
 * module load, so each test group stubs env and dynamically imports a
 * fresh copy via vi.resetModules().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKENS_KEY = "notation-app-auth";
const PKCE_KEY = "notation-app-pkce";

async function freshAuth() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_OAUTH_ISSUER", "https://idp.test");
  vi.stubEnv("NEXT_PUBLIC_OAUTH_CLIENT_ID", "client-123");
  vi.stubEnv("NEXT_PUBLIC_API_BASE", "https://api.test");
  return await import("@/lib/auth");
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function seedTokens(overrides: Record<string, unknown> = {}) {
  localStorage.setItem(
    TOKENS_KEY,
    JSON.stringify({
      access_token: "at-1",
      refresh_token: "rt-1",
      expires_at: Date.now() + 3600_000,
      claims: { sub: "u1", email: "u@test" },
      ...overrides,
    })
  );
}

describe("completeSignIn", () => {
  it("rejects a state mismatch without calling the broker", async () => {
    const auth = await freshAuth();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier: "v", state: "expected" }));
    expect(await auth.completeSignIn("code", "WRONG")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOKENS_KEY)).toBeNull();
  });

  it("exchanges the code via the broker and persists tokens", async () => {
    const auth = await freshAuth();
    // Second param is declared so the assertion below can read the request
    // init (the exchange body); fetch is called with it either way.
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (String(url).endsWith("/oauth/exchange")) {
        return new Response(
          JSON.stringify({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 }),
          { status: 200 }
        );
      }
      // /me bootstrap
      return new Response(
        JSON.stringify({ sub: "u1", memberships: [{ songbookId: "b1", name: "My Songs", role: "owner" }] }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchSpy);
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier: "v", state: "s1" }));
    expect(await auth.completeSignIn("code-1", "s1")).toBe(true);
    const stored = JSON.parse(localStorage.getItem(TOKENS_KEY)!);
    expect(stored.access_token).toBe("at-2");
    expect(auth.getSnapshot().status).toBe("signed-in");
    expect(auth.getSnapshot().activeSongbookId).toBe("b1");
    // Exchange body carried the PKCE verifier and redirect_uri.
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.code_verifier).toBe("v");
    expect(body.code).toBe("code-1");
  });
});

describe("getAccessToken", () => {
  it("returns the stored token while fresh", async () => {
    const auth = await freshAuth();
    seedTokens();
    expect(await auth.getAccessToken()).toBe("at-1");
  });

  it("refreshes once for concurrent callers (single-flight)", async () => {
    const auth = await freshAuth();
    seedTokens({ expires_at: Date.now() - 1000 });
    let refreshCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return new Response(
          JSON.stringify({ access_token: "at-new", expires_in: 3600 }),
          { status: 200 }
        );
      })
    );
    const [a, b, c] = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
      auth.getAccessToken(),
    ]);
    expect(refreshCalls).toBe(1);
    expect(a).toBe("at-new");
    expect(b).toBe("at-new");
    expect(c).toBe("at-new");
    // Rotation: refresh_token absent in response keeps the old one.
    const stored = JSON.parse(localStorage.getItem(TOKENS_KEY)!);
    expect(stored.refresh_token).toBe("rt-1");
  });

  it("marks the session expired when refresh is rejected", async () => {
    const auth = await freshAuth();
    seedTokens({ expires_at: Date.now() - 1000 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }))
    );
    expect(await auth.getAccessToken()).toBeNull();
    expect(auth.getSnapshot().status).toBe("expired");
    // Claims survive for the "signed in as X — expired" UI.
    expect(auth.getSnapshot().claims?.sub).toBe("u1");
    expect(localStorage.getItem(TOKENS_KEY)).toBeNull();
  });

  it("expires immediately when there is no refresh token", async () => {
    const auth = await freshAuth();
    seedTokens({ expires_at: Date.now() - 1000, refresh_token: undefined });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await auth.getAccessToken()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(auth.getSnapshot().status).toBe("expired");
  });
});

describe("signOut", () => {
  it("clears tokens and snapshot", async () => {
    const auth = await freshAuth();
    seedTokens();
    localStorage.setItem("notation-app-active-songbook", "b1");
    auth.signOut();
    expect(localStorage.getItem(TOKENS_KEY)).toBeNull();
    expect(localStorage.getItem("notation-app-active-songbook")).toBeNull();
    expect(auth.getSnapshot().status).toBe("signed-out");
  });
});

describe("AUTH_ENABLED gating", () => {
  it("is inert without the OAuth env vars (legacy build)", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_OAUTH_ISSUER", "");
    vi.stubEnv("NEXT_PUBLIC_OAUTH_CLIENT_ID", "");
    const auth = await import("@/lib/auth");
    expect(auth.AUTH_ENABLED).toBe(false);
    expect(await auth.getAccessToken()).toBeNull();
    expect(await auth.completeSignIn("c", "s")).toBe(false);
  });
});
