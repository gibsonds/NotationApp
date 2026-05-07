// Lightweight client-side usage instrumentation. Always-on for all users;
// payloads are deliberately minimal — short field names, no user content.
//
// Storage layout:
//   localStorage["notation-app-analytics"] = JSON array, oldest-first, capped
//     at MAX_EVENTS. Oldest entries are dropped when full.
//   sessionStorage["notation-app-session-id"] = UUID generated lazily once
//     per browser session; cleared when the tab closes.
//
// Stored shape per event: { e, t, s }
//   e = event name (with ":<name>" suffix when caller passed a `name`)
//   t = unix ms timestamp
//   s = first 8 chars of session id
// appVersion / scoreType / platform are intentionally NOT stored — they bulk
// up the buffer and can be derived at analysis time from session metadata.

import { v4 as uuidv4 } from "uuid";

const STORAGE_KEY = "notation-app-analytics";
const SESSION_KEY = "notation-app-session-id";
const MAX_EVENTS = 100;
const SESSION_PREFIX_LEN = 8;

export type ScoreType = "notation" | "chord-chart" | "none";

export interface AnalyticsEvent {
  e: string;
  t: number;
  s: string;
}

// Optional per-event extras — kept tiny on purpose. Callers may pass a
// `name` (menu item label, mode name, error type, etc.) and a `scoreType`
// for back-compat with existing call sites; we never accept freeform user
// content here. `scoreType` is currently ignored at write time (see header).
export interface LogEventInput {
  event: string;
  scoreType?: ScoreType;
  name?: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function getSessionId(): string {
  if (!isBrowser()) return "ssr";
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = uuidv4();
    window.sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return "no-sess";
  }
}

function readBuffer(): AnalyticsEvent[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Tolerate the previous (verbose) shape if the buffer was written by an
    // older build — normalize to {e,t,s}.
    return parsed
      .map((ev): AnalyticsEvent | null => {
        if (!ev || typeof ev !== "object") return null;
        if (typeof ev.e === "string" && typeof ev.t === "number") {
          return { e: ev.e, t: ev.t, s: typeof ev.s === "string" ? ev.s : "" };
        }
        if (typeof ev.event === "string" && typeof ev.timestamp === "number") {
          return {
            e: ev.event,
            t: ev.timestamp,
            s: typeof ev.sessionId === "string" ? ev.sessionId.slice(0, SESSION_PREFIX_LEN) : "",
          };
        }
        return null;
      })
      .filter((x): x is AnalyticsEvent => x !== null);
  } catch {
    return [];
  }
}

function writeBuffer(events: AnalyticsEvent[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Quota exceeded or storage disabled — drop silently.
  }
}

export function logEvent(input: LogEventInput): void {
  if (!isBrowser()) return;
  const eventName = input.event;
  if (!eventName) return;
  const ev: AnalyticsEvent = {
    e: input.name ? `${eventName}:${input.name}` : eventName,
    t: Date.now(),
    s: getSessionId().slice(0, SESSION_PREFIX_LEN),
  };
  const buffer = readBuffer();
  buffer.push(ev);
  while (buffer.length > MAX_EVENTS) buffer.shift();
  writeBuffer(buffer);
  try {
    window.dispatchEvent(new CustomEvent("notation-app-analytics", { detail: ev }));
  } catch {
    // CustomEvent unavailable in some environments — non-fatal.
  }
}

export function getEvents(): AnalyticsEvent[] {
  return readBuffer();
}

export function clearEvents(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("notation-app-analytics", { detail: null }));
  } catch {
    // ignore
  }
}

// Helper: classify a score for the `scoreType` field. Matches the same
// branching the rest of the app uses (chord-chart when sections are
// populated, notation otherwise).
export function scoreTypeOf(score: { sections?: unknown[] } | null | undefined): ScoreType {
  if (!score) return "none";
  const sections = score.sections;
  if (Array.isArray(sections) && sections.length > 0) return "chord-chart";
  return "notation";
}
