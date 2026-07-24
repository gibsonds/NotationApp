"use client";

/**
 * OAuth42 session management for the authenticated instance (issue #74).
 *
 * Standalone module (same pattern as song-cloud.ts keeps the device id out
 * of the zustand store). Active only when BOTH NEXT_PUBLIC_OAUTH_ISSUER and
 * NEXT_PUBLIC_OAUTH_CLIENT_ID are baked into the build — the legacy Pages
 * build sets neither, so every export is inert there and the legacy
 * instance behaves exactly as before.
 *
 * Flow: Authorization Code + PKCE. The code/refresh exchanges go through
 * OUR API's /oauth broker (OAuth42 advertises no public-client token auth;
 * the client secret lives in Lambda env, never in this bundle). PKCE is
 * still end-to-end: the verifier never leaves this browser except to our
 * own broker, which forwards it to the IdP.
 */

import { challengeS256, generateVerifier, randomState } from "@/lib/pkce";

export const OAUTH_ISSUER = process.env.NEXT_PUBLIC_OAUTH_ISSUER ?? "";
export const OAUTH_CLIENT_ID = process.env.NEXT_PUBLIC_OAUTH_CLIENT_ID ?? "";
export const AUTH_ENABLED = !!(OAUTH_ISSUER && OAUTH_CLIENT_ID);

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const TOKENS_KEY = "notation-app-auth";
const ACTIVE_BOOK_KEY = "notation-app-active-songbook";
const PKCE_KEY = "notation-app-pkce"; // sessionStorage: {verifier,state}
const REFRESH_EARLY_MS = 60_000;

export interface SessionClaims {
  sub: string;
  email?: string;
  name?: string;
}

export interface Membership {
  songbookId: string;
  name: string;
  role: "owner" | "editor" | "viewer";
}

export type AuthStatus = "signed-out" | "signed-in" | "expired";

export interface AuthSnapshot {
  status: AuthStatus;
  claims: SessionClaims | null;
  memberships: Membership[];
  activeSongbookId: string | null;
}

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  /** ms epoch when access_token expires. */
  expires_at: number;
  claims: SessionClaims;
}

// ── Reactive snapshot (useSyncExternalStore-compatible) ────────────────────

let snapshot: AuthSnapshot = {
  status: "signed-out",
  claims: null,
  memberships: [],
  activeSongbookId: null,
};
const listeners = new Set<() => void>();

function emit(next: Partial<AuthSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const l of listeners) l();
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getSnapshot(): AuthSnapshot {
  return snapshot;
}

// ── Token persistence ──────────────────────────────────────────────────────

function readTokens(): StoredTokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}

function writeTokens(t: StoredTokens | null): void {
  try {
    if (t) localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKENS_KEY);
  } catch {
    /* quota/blocked — session becomes memory-only, re-login after reload */
  }
}

/** Display-only claims from an unverified JWT payload (the server does the
 *  real verification on every API call). */
export function decodeClaims(jwt: string): SessionClaims | null {
  try {
    const payload = JSON.parse(
      atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    ) as Record<string, unknown>;
    if (typeof payload.sub !== "string") return null;
    return {
      sub: payload.sub,
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      ...(typeof payload.name === "string" ? { name: payload.name } : {}),
    };
  } catch {
    return null;
  }
}

// ── Sign-in flow ───────────────────────────────────────────────────────────

/** The registered redirect URI: the app's own root. */
export function redirectUri(): string {
  return `${window.location.origin}${BASE_PATH}/`;
}

export async function beginSignIn(): Promise<void> {
  if (!AUTH_ENABLED) return;
  const verifier = generateVerifier();
  const state = randomState();
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri(),
    // No offline_access: OAuth42 rejects it as an unregistered scope
    // ("Scope 'offline_access' is not allowed") — refresh tokens are
    // governed by the app's Refresh Token grant type instead.
    scope: "openid profile email",
    state,
    code_challenge: await challengeS256(verifier),
    code_challenge_method: "S256",
  });
  window.location.assign(`${OAUTH_ISSUER}/oauth2/authorize?${params}`);
}

/** Handle the ?code=&state= callback. Returns true when a session was
 *  established (caller strips the params and refreshes UI). */
export async function completeSignIn(code: string, state: string): Promise<boolean> {
  if (!AUTH_ENABLED) return false;
  let stash: { verifier: string; state: string } | null = null;
  try {
    stash = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? "null");
  } catch {
    stash = null;
  }
  sessionStorage.removeItem(PKCE_KEY);
  if (!stash || stash.state !== state) {
    console.warn("[auth] state mismatch — ignoring callback");
    return false;
  }
  const res = await fetch(`${API_BASE}/oauth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      code_verifier: stash.verifier,
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) {
    console.warn("[auth] code exchange failed", res.status);
    return false;
  }
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };
  if (!body.access_token) return false;
  const claims =
    (body.id_token && decodeClaims(body.id_token)) ||
    decodeClaims(body.access_token) || { sub: "unknown" };
  writeTokens({
    access_token: body.access_token,
    ...(body.refresh_token ? { refresh_token: body.refresh_token } : {}),
    expires_at: Date.now() + (body.expires_in ?? 3600) * 1000,
    claims,
  });
  emit({ status: "signed-in", claims });
  await loadMe();
  return true;
}

export function signOut(): void {
  writeTokens(null);
  try {
    localStorage.removeItem(ACTIVE_BOOK_KEY);
  } catch {
    /* ignore */
  }
  emit({ status: "signed-out", claims: null, memberships: [], activeSongbookId: null });
}

// ── Access token with single-flight refresh ────────────────────────────────

let refreshInFlight: Promise<string | null> | null = null;

export async function getAccessToken(): Promise<string | null> {
  if (!AUTH_ENABLED) return null;
  const t = readTokens();
  if (!t) return null;
  if (Date.now() < t.expires_at - REFRESH_EARLY_MS) return t.access_token;
  if (!t.refresh_token) {
    markExpired(t);
    return null;
  }
  if (!refreshInFlight) {
    refreshInFlight = doRefresh(t).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(t: StoredTokens): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/oauth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: t.refresh_token }),
    });
    if (!res.ok) {
      markExpired(t);
      return null;
    }
    const body = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) {
      markExpired(t);
      return null;
    }
    const next: StoredTokens = {
      access_token: body.access_token,
      // Rotation: keep the new refresh token when issued, else the old one.
      refresh_token: body.refresh_token ?? t.refresh_token,
      expires_at: Date.now() + (body.expires_in ?? 3600) * 1000,
      claims: t.claims,
    };
    writeTokens(next);
    if (snapshot.status !== "signed-in") emit({ status: "signed-in", claims: t.claims });
    return next.access_token;
  } catch {
    // Network blip — keep tokens, report unavailable for this call.
    return null;
  }
}

function markExpired(t: StoredTokens): void {
  // Keep claims for the "signed in as X — session expired" UI.
  writeTokens(null);
  emit({ status: "expired", claims: t.claims });
}

/** Called by song-cloud on a 401 that carried a token: the token was
 *  revoked/invalid server-side. */
export function invalidateSession(): void {
  const t = readTokens();
  if (t) markExpired(t);
}

// ── Memberships / active songbook ──────────────────────────────────────────

export function getActiveSongbookId(): string | null {
  if (snapshot.activeSongbookId) return snapshot.activeSongbookId;
  try {
    return localStorage.getItem(ACTIVE_BOOK_KEY);
  } catch {
    return null;
  }
}

export function setActiveSongbook(id: string): void {
  try {
    localStorage.setItem(ACTIVE_BOOK_KEY, id);
  } catch {
    /* ignore */
  }
  emit({ activeSongbookId: id });
}

/** GET /me — bootstraps memberships (server auto-creates a personal
 *  songbook on first touch) and picks an active songbook if none is set. */
export async function loadMe(): Promise<Membership[]> {
  const token = await getAccessToken();
  if (!token) return [];
  const res = await fetch(`${API_BASE}/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    sub: string;
    email?: string;
    name?: string;
    memberships: Membership[];
  };
  const memberships = body.memberships ?? [];
  const current = getActiveSongbookId();
  const active =
    (current && memberships.find((m) => m.songbookId === current)?.songbookId) ||
    memberships[0]?.songbookId ||
    null;
  if (active && active !== current) setActiveSongbook(active);
  emit({
    memberships,
    activeSongbookId: active,
    status: "signed-in",
    claims: {
      sub: body.sub,
      ...(body.email ? { email: body.email } : {}),
      ...(body.name ? { name: body.name } : {}),
    },
  });
  return memberships;
}

// ── Legacy device import ───────────────────────────────────────────────────

const IMPORT_DONE_KEY = "notation-app-import-done";

export function legacyImportDone(): boolean {
  try {
    return localStorage.getItem(IMPORT_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

/** One-shot copy of this browser's legacy device songbook into the active
 *  songbook (server reads the old table; see infra/lambda/import.ts).
 *  Returns the copy counts, or null on failure. */
export async function importLegacyDevice(
  deviceId: string
): Promise<{ songs: number; versions: number } | null> {
  const token = await getAccessToken();
  const songbookId = getActiveSongbookId();
  if (!token || !songbookId) return null;
  const res = await fetch(`${API_BASE}/import-device`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ deviceId, songbookId }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { songs: number; versions: number };
  try {
    localStorage.setItem(IMPORT_DONE_KEY, "1");
  } catch {
    /* ignore */
  }
  return body;
}

/** Rehydrate session state at app start (called once from page.tsx). */
export async function initAuth(): Promise<void> {
  if (!AUTH_ENABLED || typeof window === "undefined") return;
  const t = readTokens();
  if (!t) return;
  emit({ status: "signed-in", claims: t.claims });
  await loadMe();
}
