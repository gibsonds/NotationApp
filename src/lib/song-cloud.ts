import type { Score } from "@/lib/schema";
import type { SongDTO, SongSummary, VersionEntry } from "@/lib/song-cloud-types";
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

/** Thrown by cloudPutSong when the server returns 409. The cloud's current
 *  DTO is attached so the client can show a side-by-side diff or run a
 *  3-way merge (issue #89) without a second round trip. */
export class ConflictCloudError extends TerminalCloudError {
  constructor(public current: SongDTO) {
    super("version conflict");
    this.name = "ConflictCloudError";
  }
}

export function isConflictError(err: unknown): err is ConflictCloudError {
  return err instanceof ConflictCloudError;
}

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
    if (res.status === 409) {
      // Optimistic-concurrency conflict (#87). Body carries the current
      // cloud DTO so the client can show a diff / run merge.
      try {
        const j = await res.json();
        if (j && typeof j === "object" && j.error === "conflict" && j.current) {
          throw new ConflictCloudError(j.current as SongDTO);
        }
      } catch (err) {
        if (err instanceof ConflictCloudError) throw err;
        // Body wasn't the expected shape — fall through to generic.
      }
      throw new TerminalCloudError(`HTTP 409`);
    }
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
  folder?: string | null;
  /** The cloud version this save is replacing. When provided AND the cloud's
   *  current version differs, the request is rejected with ConflictCloudError
   *  so the caller can run resolution. Omit to force last-write-wins (e.g.
   *  the conflict modal's "keep mine" path). */
  expectedVersion?: string;
}): Promise<SongDTO> {
  const body = JSON.stringify({
    title: s.title,
    score: s.score,
    savedAt: s.savedAt,
    folder: s.folder ?? null,
    ...(s.expectedVersion !== undefined && { expectedVersion: s.expectedVersion }),
  });
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

export async function cloudListVersions(id: string): Promise<VersionEntry[]> {
  const res = await apiFetch(`/songs/${encodeURIComponent(id)}/versions`);
  const json = (await res.json()) as { versions: VersionEntry[] };
  return json.versions;
}

export async function cloudGetVersion(id: string, ts: number): Promise<SongDTO> {
  const res = await apiFetch(
    `/songs/${encodeURIComponent(id)}/versions/${ts}`
  );
  return (await res.json()) as SongDTO;
}

export async function cloudCreateNamedRevision(s: {
  id: string;
  name: string;
  title: string;
  score: Score;
  folder?: string | null;
}): Promise<VersionEntry> {
  const body = JSON.stringify({
    name: s.name,
    title: s.title,
    score: s.score,
    folder: s.folder ?? null,
  });
  const res = await apiFetch(`/songs/${encodeURIComponent(s.id)}/versions`, {
    method: "POST",
    body,
  });
  return (await res.json()) as VersionEntry;
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
        // Local has newer save — push it up (include folder + version).
        let pushedDto: SongDTO | undefined;
        try {
          pushedDto = await cloudPutSong({
            id: summary.id,
            title: localEntry.title,
            score: localEntry.score,
            savedAt: localEntry.savedAt,
            folder: localEntry.folder ?? null,
            ...(localEntry.cloudVersion !== undefined && { expectedVersion: localEntry.cloudVersion }),
          });
        } catch {
          /* keep local; retry next time */
        }
        merged.push({
          ...localEntry,
          ...(pushedDto?.version !== undefined && { cloudVersion: pushedDto.version }),
        });
      } else {
        try {
          const dto = await cloudGetSong(summary.id);
          // Folder resolution: cloud is the source of truth IF it has one.
          // If cloud has no folder but local does, that's a pre-sync local
          // folder we need to migrate up — push it now.
          let folder = dto.folder ?? localEntry?.folder;
          let version = dto.version;
          if (!dto.folder && localEntry?.folder) {
            try {
              const repushed = await cloudPutSong({
                id: dto.id,
                title: dto.title,
                score: dto.score,
                savedAt: dto.savedAt,
                folder: localEntry.folder,
                expectedVersion: dto.version,
              });
              folder = localEntry.folder;
              version = repushed.version;
            } catch {
              /* keep local-only for now */
            }
          }
          merged.push({
            id: dto.id,
            title: dto.title,
            savedAt: dto.savedAt,
            score: dto.score,
            ...(folder ? { folder } : {}),
            ...(version && { cloudVersion: version }),
          });
        } catch {
          if (localEntry) merged.push(localEntry);
        }
      }
    }

    // Local-only entries: two cases.
    //
    //   A) Never-synced (no cloudVersion) → push to cloud as a migration.
    //      This handles legacy entries created before cloud was enabled
    //      and entries created in this session that haven't been
    //      autosaved yet.
    //
    //   B) Already-synced (has cloudVersion) but cloud no longer lists
    //      it → cloud-side deletion. Drop locally instead of pushing
    //      back. This stops the resurrection bug where deleting a song
    //      from one device would have it re-uploaded by another that
    //      still had the entry in localStorage.
    //
    // The cloudVersion field is the tombstone signal: its presence means
    // "we knew about this in cloud at some point; cloud absence now is
    // intentional." Without it we'd assume migration and push back up.
    for (const entry of local) {
      if (cloudIds.has(entry.id)) continue;
      if (entry.cloudVersion) {
        // Tombstone respect — cloud deleted it, propagate the deletion
        // locally. Don't add to merged.
        continue;
      }
      try {
        const dto = await cloudPutSong({
          id: entry.id,
          title: entry.title,
          score: entry.score,
          savedAt: entry.savedAt,
          folder: entry.folder ?? null,
        });
        merged.push({ ...entry, cloudVersion: dto.version });
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

// UUID v4-ish shape — 8-4-4-4-12 hex with dashes. crypto.randomUUID()
// always produces this; cloud-side partitioning depends on the
// canonical lowercase form.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Parse a pasted value as either a share URL (?join=<id>) or a raw
// device code. Returns the device id ONLY if it cleans up to a valid
// UUID shape — otherwise null. Strips non-hex garbage from either end
// (this catches the "\<uuid>" mishap from URL-encoded paste round-
// trips). Returns lowercase canonical form so the cloud partition
// key is consistent.
export function extractJoinCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // URL form: ?join=<id>. URL parsing also URL-decodes %5C → \, so
  // the sanitize step below still picks up the slash and strips it.
  if (trimmed.includes("?") || trimmed.startsWith("http")) {
    try {
      const url = new URL(trimmed);
      const join = url.searchParams.get("join");
      if (join) return sanitizeDeviceCode(join);
    } catch {
      /* not a URL — fall through to raw */
    }
  }
  return sanitizeDeviceCode(trimmed);
}

function sanitizeDeviceCode(raw: string): string | null {
  // Strip everything that isn't hex / dash from the front and back.
  // Internal garbage (e.g. spaces) would break a real UUID, so we
  // let the regex check reject it rather than mutate the middle.
  const cleaned = raw
    .trim()
    .replace(/^[^0-9a-fA-F]+/, "")
    .replace(/[^0-9a-fA-F]+$/, "")
    .toLowerCase();
  return UUID_RE.test(cleaned) ? cleaned : null;
}
