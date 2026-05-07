// Lightweight client-side usage instrumentation. Logs anonymized interaction
// events to a localStorage ring buffer so we can inspect what users do without
// shipping any of their content. Event payloads are deliberately minimal:
// names + score type + platform — never lyrics, chord names, annotation text,
// AI prompts, or any user-typed string.
//
// Storage layout:
//   localStorage["notation-app-analytics"] = JSON array, oldest-first, capped
//     at MAX_EVENTS. Oldest entries are dropped when full.
//   sessionStorage["notation-app-session-id"] = UUID generated lazily once per
//     browser session; cleared when the tab closes.

import { v4 as uuidv4 } from "uuid";
import packageJson from "../../package.json";

const STORAGE_KEY = "notation-app-analytics";
const SESSION_KEY = "notation-app-session-id";
const MAX_EVENTS = 500;

export type ScoreType = "notation" | "chord-chart" | "none";

export interface AnalyticsEvent {
  event: string;
  timestamp: number;
  sessionId: string;
  appVersion: string;
  scoreType: ScoreType;
  platform: string;
}

// Optional per-event extras — kept tiny on purpose. Callers may pass a
// `name` (menu item label, mode name, error type, etc.); we never accept
// freeform user content here. No `text`, `prompt`, `lyric`, or `chord`
// fields exist by design.
export interface LogEventInput {
  event: string;
  scoreType?: ScoreType;
  name?: string;
}

const APP_VERSION = (packageJson as { version?: string }).version ?? "unknown";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function getPlatform(): string {
  if (!isBrowser()) return "ssr";
  const nav = window.navigator;
  // userAgentData is the modern, privacy-conscious surface; fall back to
  // platform/userAgent for older browsers. We only record the broad bucket
  // (Mac, Windows, Linux, iOS, Android, Other) — never the full UA.
  const uaPlatform = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    ?? nav.platform
    ?? "";
  const ua = nav.userAgent || "";
  const lower = (uaPlatform || ua).toLowerCase();
  if (lower.includes("iphone") || lower.includes("ipad") || lower.includes("ios")) return "iOS";
  if (lower.includes("android")) return "Android";
  if (lower.includes("mac")) return "macOS";
  if (lower.includes("win")) return "Windows";
  if (lower.includes("linux")) return "Linux";
  return "Other";
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
    // Session storage can throw in privacy modes — fall back to a per-call
    // id so we still log something coherent within this call.
    return "no-session";
  }
}

function readBuffer(): AnalyticsEvent[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBuffer(events: AnalyticsEvent[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Quota exceeded or storage disabled — drop silently. Analytics must
    // never break the app.
  }
}

export function logEvent(input: LogEventInput | AnalyticsEvent): void {
  if (!isBrowser()) return;
  const eventName = input.event;
  if (!eventName) return;
  // If the caller passes a fully-formed event (e.g. replaying), respect its
  // fields; otherwise fill in the contextual ones.
  const fullEvent: AnalyticsEvent = "sessionId" in input && "timestamp" in input
    ? input as AnalyticsEvent
    : {
        event: input.name ? `${eventName}:${input.name}` : eventName,
        timestamp: Date.now(),
        sessionId: getSessionId(),
        appVersion: APP_VERSION,
        scoreType: (input as LogEventInput).scoreType ?? "none",
        platform: getPlatform(),
      };
  const buffer = readBuffer();
  buffer.push(fullEvent);
  while (buffer.length > MAX_EVENTS) buffer.shift();
  writeBuffer(buffer);
  // Notify in-page listeners (the debug overlay polls via this event).
  try {
    window.dispatchEvent(new CustomEvent("notation-app-analytics", { detail: fullEvent }));
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
