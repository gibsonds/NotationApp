/**
 * Bring-your-own-key (BYOK) storage for AI provider credentials.
 *
 * Keys live ONLY in module memory for the current page, until reload or close.
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

let memoryKeys: StoredKeys = {};

function readStore(): StoredKeys {
  if (typeof window === "undefined") return {};
  // Upgrade existing keys without copying them into another persistent store.
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      storage.removeItem(STORAGE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.anthropic === "string" && !memoryKeys.anthropic) memoryKeys.anthropic = parsed.anthropic;
      if (typeof parsed?.openai === "string" && !memoryKeys.openai) memoryKeys.openai = parsed.openai;
    } catch { /* Unavailable or corrupt legacy storage. */ }
  }
  return { ...memoryKeys };
}

function writeStore(keys: StoredKeys): void {
  if (typeof window === "undefined") return;
  memoryKeys = { ...keys };
}

export function clearAllApiKeys(): void {
  memoryKeys = {};
  if (typeof window === "undefined") return;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try { storage.removeItem(STORAGE_KEY); } catch { /* Storage unavailable. */ }
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
