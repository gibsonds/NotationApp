/** Authorization URL regressions; no provider login, network or token exposure. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function authorizationUrl(multi?: string, email?: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_OAUTH_ISSUER", "https://identity.example.test");
  vi.stubEnv("NEXT_PUBLIC_OAUTH_CLIENT_ID", "scope-test-client");
  vi.stubEnv("NEXT_PUBLIC_MULTI_BOOK_INVITES", multi);
  vi.stubEnv("NEXT_PUBLIC_VERIFIED_EMAIL_INVITES", email);
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const auth = await import("@/lib/auth");
  await auth.beginSignIn();
  expect(assign).toHaveBeenCalledOnce();
  expect(fetcher).not.toHaveBeenCalled();
  return new URL(assign.mock.calls[0][0]);
}

it.each([
  [undefined, undefined],
  ["1", undefined],
  [undefined, "1"],
  ["0", "1"],
  ["false", "1"],
  ["true", "1"],
  [" 1", "1"],
  ["1", "0"],
  ["1", "false"],
  ["1", "true"],
  ["1", "TRUE"],
  ["1", " 1"],
  ["1", "1 "],
  ["1", "01"],
  ["1", ""],
])("retains exact openid scope for non-opted-in flags (%s, %s)", async (multi, email) => {
  const url = await authorizationUrl(multi, email);
  expect(url.searchParams.get("scope")).toBe("openid");
});

it("requests only openid email when both invitation flags are exactly 1", async () => {
  const subjectCache = JSON.stringify({claims:{sub:"opaque-existing-account"}});
  localStorage.setItem("notation-app-auth",subjectCache);
  localStorage.setItem("notation-app-active-songbook","existing-book");
  sessionStorage.setItem("notation-app-pending-invite","mi-existing-intent");
  const url = await authorizationUrl("1","1");
  expect(url.origin + url.pathname).toBe("https://identity.example.test/oauth2/authorize");
  expect(url.searchParams.get("scope")).toBe("openid email");
  expect(url.searchParams.get("client_id")).toBe("scope-test-client");
  expect(url.searchParams.get("redirect_uri")).toBe(window.location.origin + "/");
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(url.searchParams.get("nonce")!.length).toBeGreaterThanOrEqual(32);
  expect([...url.searchParams.keys()].sort()).toEqual([
    "client_id","code_challenge","code_challenge_method","nonce",
    "redirect_uri","response_type","scope","state",
  ]);
  const pkce = JSON.parse(sessionStorage.getItem("notation-app-pkce")!);
  expect(pkce.state).toBe(url.searchParams.get("state"));
  expect(pkce.nonce).toBe(url.searchParams.get("nonce"));
  expect(localStorage.getItem("notation-app-auth")).toBe(subjectCache);
  expect(localStorage.getItem("notation-app-active-songbook")).toBe("existing-book");
  expect(sessionStorage.getItem("notation-app-pending-invite")).toBe("mi-existing-intent");
});

it("does not enable authentication in a legacy build even when both flags are 1", async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_OAUTH_ISSUER", "");
  vi.stubEnv("NEXT_PUBLIC_OAUTH_CLIENT_ID", "");
  vi.stubEnv("NEXT_PUBLIC_MULTI_BOOK_INVITES", "1");
  vi.stubEnv("NEXT_PUBLIC_VERIFIED_EMAIL_INVITES", "1");
  const assign = vi.spyOn(window.location,"assign").mockImplementation(() => {});
  const auth = await import("@/lib/auth");
  await auth.beginSignIn();
  expect(auth.AUTH_ENABLED).toBe(false);
  expect(assign).not.toHaveBeenCalled();
});
