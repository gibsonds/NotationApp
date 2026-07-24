/**
 * Minimal PKCE (RFC 7636) helpers for the OAuth42 Authorization Code flow.
 * Pure functions over Web Crypto — no dependencies, unit-tested against
 * the RFC's Appendix B vector.
 */

const UNRESERVED =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** RFC 7636 §4.1: 43–128 chars from the unreserved set. */
export function generateVerifier(length = 64): string {
  const clamped = Math.min(128, Math.max(43, length));
  const bytes = new Uint8Array(clamped);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += UNRESERVED[b % UNRESERVED.length];
  return out;
}

/** base64url without padding (RFC 7636 §4.2). */
export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** S256 code challenge for a verifier. */
export async function challengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64UrlEncode(digest);
}

/** Opaque CSRF state parameter. */
export function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
