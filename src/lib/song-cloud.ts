import type { Score } from "@/lib/schema";
import type { SongDTO, SongSummary } from "@/lib/song-cloud-types";
import { getSongs, setSongs as writeLocalSongs, type SongBankEntry } from "@/lib/song-bank";

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

// ── Songbook sync ──────────────────────────────────────────────────────────
// One-shot reconcile: pull cloud list, hydrate cloud-only entries, push
// local-only entries, write merged result to localStorage. Returns the
// merged list (newest-first ordering is the caller's job).
//
// If cloud is unreachable, returns the current local list and signals
// "offline" via the optional onStatus callback so the UI can render a badge
// without throwing.

export type SyncStatus = "syncing" | "ok" | "offline";

export async function syncSongbook(opts?: {
  onStatus?: (status: SyncStatus) => void;
}): Promise<SongBankEntry[]> {
  const onStatus = opts?.onStatus ?? (() => {});
  if (!CLOUD_ENABLED) return getSongs();
  onStatus("syncing");
  try {
    if (hasPendingOps()) await flushQueue();

    const local = getSongs();
    const summaries = await cloudListSongs();
    const localById = new Map(local.map((e) => [e.id, e]));
    const cloudIds = new Set(summaries.map((s) => s.id));
    const merged: SongBankEntry[] = [];

    for (const summary of summaries) {
      const localEntry = localById.get(summary.id);
      if (localEntry && localEntry.savedAt >= summary.updatedAt) {
        // Local has newer save — push it up.
        try {
          await cloudPutSong({
            id: summary.id,
            title: localEntry.title,
            score: localEntry.score,
            savedAt: localEntry.savedAt,
          });
        } catch {
          /* keep local; retry next time */
        }
        merged.push(localEntry);
      } else {
        try {
          const dto = await cloudGetSong(summary.id);
          merged.push({
            id: dto.id,
            title: dto.title,
            savedAt: dto.savedAt,
            score: dto.score,
          });
        } catch {
          if (localEntry) merged.push(localEntry);
        }
      }
    }

    // Local-only entries → push to cloud.
    for (const entry of local) {
      if (cloudIds.has(entry.id)) continue;
      try {
        await cloudPutSong({
          id: entry.id,
          title: entry.title,
          score: entry.score,
          savedAt: entry.savedAt,
        });
        merged.push(entry);
      } catch (err) {
        merged.push(entry);
        if (isTransient(err)) {
          enqueueOffline({
            type: "put",
            id: entry.id,
            title: entry.title,
            score: entry.score,
            savedAt: entry.savedAt,
          });
        }
      }
    }

    merged.sort((a, b) => a.savedAt - b.savedAt);
    writeLocalSongs(merged);
    onStatus("ok");
    return merged;
  } catch (err) {
    console.warn("[song-cloud] sync failed", err);
    onStatus("offline");
    return getSongs();
  }
}

// Parse a pasted value as either a share URL (?join=<id>) or a raw device
// code. Returns the device id, or null if nothing usable is found.
export function extractJoinCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes("?") || trimmed.startsWith("http")) {
    try {
      const url = new URL(trimmed);
      const join = url.searchParams.get("join");
      if (join) return join;
    } catch {
      /* not a URL — fall through to raw */
    }
  }
  return trimmed;
}
