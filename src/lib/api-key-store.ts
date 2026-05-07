/**
 * Bring-your-own-key (BYOK) storage for AI provider credentials.
 *
 * Keys live ONLY in the browser via localStorage under a single JSON blob.
 * They are never persisted server-side and must never be passed to analytics,
 * logging, or telemetry. If you find yourself importing this module from
 * `analytics.ts` (or anything that ships log payloads off-device), STOP — the
 * design contract is that the raw key value never leaves this module's
 * read paths and the request headers built by `getByokHeaders`.
 */

export type AiProvider = "anthropic" | "openai";

const STORAGE_KEY = "notation-app-api-keys";

export const BYOK_HEADER_NAMES = {
  anthropic: "x-byok-anthropic-key",
  openai: "x-byok-openai-key",
} as const;

interface StoredKeys {
  anthropic?: string;
  openai?: string;
}

function readStore(): StoredKeys {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: StoredKeys = {};
    if (typeof parsed.anthropic === "string") out.anthropic = parsed.anthropic;
    if (typeof parsed.openai === "string") out.openai = parsed.openai;
    return out;
  } catch {
    return {};
  }
}

function writeStore(keys: StoredKeys): void {
  if (typeof window === "undefined") return;
  try {
    if (!keys.anthropic && !keys.openai) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Quota exceeded / storage disabled — silently no-op so callers don't crash.
  }
}

export function setApiKey(provider: AiProvider, key: string): void {
  const trimmed = key.trim();
  if (!trimmed) {
    clearApiKey(provider);
    return;
  }
  const current = readStore();
  current[provider] = trimmed;
  writeStore(current);
}

export function getApiKey(provider: AiProvider): string | null {
  const current = readStore();
  return current[provider] ?? null;
}

export function clearApiKey(provider: AiProvider): void {
  const current = readStore();
  delete current[provider];
  writeStore(current);
}

export function validateKeyFormat(provider: AiProvider, key: string): boolean {
  const trimmed = key.trim();
  if (provider === "anthropic") return /^sk-ant-[A-Za-z0-9_\-]{10,}$/.test(trimmed);
  if (provider === "openai") return /^sk-[A-Za-z0-9_\-]{10,}$/.test(trimmed);
  return false;
}

/** First 8 chars, then ••••••••. Safe to render in UI; never log this either. */
export function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return key.slice(0, 8) + "•".repeat(8);
}

/**
 * Build request headers for `/api/score/*` calls so server routes can prefer
 * BYOK keys over their env-var defaults. Returns an empty object when no
 * keys are stored — callers can spread it unconditionally.
 */
export function getByokHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const a = getApiKey("anthropic");
  if (a) headers[BYOK_HEADER_NAMES.anthropic] = a;
  const o = getApiKey("openai");
  if (o) headers[BYOK_HEADER_NAMES.openai] = o;
  return headers;
}
