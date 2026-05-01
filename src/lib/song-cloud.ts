import type { Score } from "@/lib/schema";
import type { SongDTO, SongSummary } from "@/lib/song-cloud-types";

const DEVICE_ID_KEY = "notation-app-device-id";
const QUEUE_KEY = "notation-app-cloud-queue";
const TIMEOUT_MS = 8000;
const MAX_PAYLOAD = 380 * 1024; // DDB cap is 400 KB; keep headroom.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
export const CLOUD_ENABLED = !!API_BASE;

export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    try {
      localStorage.setItem(DEVICE_ID_KEY, id);
    } catch {
      // localStorage full / blocked — return ephemeral id; sync won't persist
      // across reloads but the session still works.
    }
  }
  return id;
}

// Replace the device ID — used to pair this browser with another device's
// songbook before auth lands. Caller is responsible for re-syncing.
export function setDeviceId(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEVICE_ID_KEY, id);
}

class TerminalCloudError extends Error {}
class TransientCloudError extends Error {}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!CLOUD_ENABLED) throw new TerminalCloudError("cloud disabled");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "x-device-id": getDeviceId(),
        ...(init.headers ?? {}),
      },
    });
    if (res.status >= 500) throw new TransientCloudError(`HTTP ${res.status}`);
    if (res.status >= 400) {
      const body = await res.text().catch(() => "");
      throw new TerminalCloudError(`HTTP ${res.status}: ${body}`);
    }
    return res;
  } catch (err) {
    if (err instanceof TerminalCloudError) throw err;
    if (err instanceof TransientCloudError) throw err;
    // AbortError, network failure, DNS, etc → treat as transient.
    throw new TransientCloudError(String(err));
  } finally {
    clearTimeout(timer);
  }
}

export async function cloudListSongs(): Promise<SongSummary[]> {
  const res = await apiFetch("/songs");
  const json = (await res.json()) as { songs: SongSummary[] };
  return json.songs;
}

export async function cloudGetSong(id: string): Promise<SongDTO> {
  const res = await apiFetch(`/songs/${encodeURIComponent(id)}`);
  return (await res.json()) as SongDTO;
}

export async function cloudPutSong(s: {
  id: string;
  title: string;
  score: Score;
  savedAt?: number;
}): Promise<SongDTO> {
  const body = JSON.stringify({ title: s.title, score: s.score, savedAt: s.savedAt });
  if (body.length > MAX_PAYLOAD) {
    throw new TerminalCloudError(
      `song too large for cloud (${(body.length / 1024).toFixed(0)} KB; cap ${MAX_PAYLOAD / 1024} KB)`
    );
  }
  const res = await apiFetch(`/songs/${encodeURIComponent(s.id)}`, {
    method: "PUT",
    body,
  });
  return (await res.json()) as SongDTO;
}

export async function cloudDeleteSong(id: string): Promise<void> {
  await apiFetch(`/songs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Offline queue ──────────────────────────────────────────────────────────
// Best-effort. On transient failures we record the intent and replay later.

export type PendingOp =
  | { type: "put"; id: string; title: string; score: Score; savedAt?: number }
  | { type: "delete"; id: string };

function readQueue(): PendingOp[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingOp[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(ops: PendingOp[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(ops));
  } catch {
    console.warn("[song-cloud] failed to persist offline queue");
  }
}

export function enqueueOffline(op: PendingOp): void {
  const ops = readQueue();
  // Collapse repeated ops on the same id — only the latest matters.
  const filtered = ops.filter((o) => o.id !== op.id);
  filtered.push(op);
  writeQueue(filtered);
}

export function hasPendingOps(): boolean {
  return readQueue().length > 0;
}

export async function flushQueue(): Promise<{ ok: number; failed: number }> {
  if (!CLOUD_ENABLED) return { ok: 0, failed: 0 };
  const ops = readQueue();
  const remaining: PendingOp[] = [];
  let ok = 0;
  for (const op of ops) {
    try {
      if (op.type === "put") {
        await cloudPutSong({ id: op.id, title: op.title, score: op.score, savedAt: op.savedAt });
      } else {
        await cloudDeleteSong(op.id);
      }
      ok++;
    } catch (err) {
      if (err instanceof TerminalCloudError) {
        // Drop terminal failures from the queue — retrying won't help.
        console.warn("[song-cloud] dropping queued op after terminal error", op, err);
      } else {
        remaining.push(op);
      }
    }
  }
  writeQueue(remaining);
  return { ok, failed: remaining.length };
}

export function isTransient(err: unknown): boolean {
  return err instanceof TransientCloudError;
}
