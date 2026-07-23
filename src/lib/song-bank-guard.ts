/**
 * Second line of defense for the My Songs bank.
 *
 * The bank itself lives in a single localStorage key (see song-bank.ts),
 * which has three failure modes we've been bitten by:
 *   1. localStorage wiped/evicted while IndexedDB survives,
 *   2. a whole-bank overwrite that drops entries (sync reconcile edge
 *      cases, corrupt read followed by a save, cleanup flows),
 *   3. quota-exceeded writes silently dropping a save.
 *
 * This module keeps, in IndexedDB:
 *   - a "mirror": the latest full copy of the bank, updated on every
 *     successful localStorage write;
 *   - rolling "backups": full snapshots taken automatically right before
 *     any write that REMOVES songs (delete, duplicate cleanup, sync
 *     tombstones, join-wipe), newest MAX_BACKUPS kept.
 *
 * restoreBankIfLost() runs at app startup: if the localStorage bank is
 * empty but the mirror has songs, the mirror is written back.
 *
 * Everything here is best-effort — callers fire-and-forget with .catch —
 * so environments without IndexedDB (tests, SSR) degrade to no-ops.
 */

import type { SongBankEntry } from "@/lib/song-bank";

const DB_NAME = "notationapp-songbank";
const VERSION = 1;
const MIRROR_STORE = "mirror";
const BACKUP_STORE = "backups";
const MAX_BACKUPS = 15;

export interface BankBackup {
  /** ms since epoch; IndexedDB key. */
  timestamp: number;
  /** What triggered the backup (e.g. "shrink: 34 -> 12"). */
  reason: string;
  songs: SongBankEntry[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MIRROR_STORE)) {
        db.createObjectStore(MIRROR_STORE);
      }
      if (!db.objectStoreNames.contains(BACKUP_STORE)) {
        db.createObjectStore(BACKUP_STORE, { keyPath: "timestamp" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Overwrite the mirror with the latest bank contents. Best-effort. */
export async function mirrorBank(songs: SongBankEntry[]): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MIRROR_STORE, "readwrite");
      tx.objectStore(MIRROR_STORE).put({ songs, updatedAt: Date.now() }, "bank");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Snapshot the current bank into the rolling backup store, pruning to
 *  MAX_BACKUPS. Called right before a write that removes entries. */
export async function archiveBank(
  songs: SongBankEntry[],
  reason: string
): Promise<void> {
  if (songs.length === 0) return;
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE, "readwrite");
      const store = tx.objectStore(BACKUP_STORE);
      const backup: BankBackup = { timestamp: Date.now(), reason, songs };
      store.put(backup);
      // Prune oldest beyond MAX_BACKUPS.
      let kept = 0;
      const cur = store.openCursor(null, "prev");
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        kept += 1;
        if (kept > MAX_BACKUPS) c.delete();
        c.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Read the mirror copy (or null if none / empty). */
export async function readMirror(): Promise<SongBankEntry[] | null> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MIRROR_STORE, "readonly");
      const req = tx.objectStore(MIRROR_STORE).get("bank");
      req.onsuccess = () => {
        const v = req.result as { songs?: SongBankEntry[] } | undefined;
        resolve(Array.isArray(v?.songs) && v.songs.length > 0 ? v.songs : null);
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** List rolling backups, newest first, without song payloads. */
export async function listBankBackups(): Promise<
  Array<Omit<BankBackup, "songs"> & { count: number }>
> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const out: Array<Omit<BankBackup, "songs"> & { count: number }> = [];
      const tx = db.transaction(BACKUP_STORE, "readonly");
      const req = tx.objectStore(BACKUP_STORE).openCursor(null, "prev");
      req.onsuccess = () => {
        const c = req.result;
        if (!c) {
          resolve(out);
          return;
        }
        const v = c.value as BankBackup;
        out.push({ timestamp: v.timestamp, reason: v.reason, count: v.songs.length });
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Load one rolling backup in full. */
export async function loadBankBackup(timestamp: number): Promise<BankBackup | null> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE, "readonly");
      const req = tx.objectStore(BACKUP_STORE).get(timestamp);
      req.onsuccess = () => resolve((req.result as BankBackup) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
