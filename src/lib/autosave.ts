/**
 * Rolling IndexedDB autosave for the chord chart / notation editor.
 *
 * Why IndexedDB and not just localStorage:
 * - localStorage is already used by Zustand persist for "current state".
 *   IndexedDB is a separate storage area with much higher quota, used here
 *   for keeping a HISTORY of timestamped snapshots so the user can recover
 *   from a bad edit, a crash, or even (in some browsers) a localStorage wipe
 *   that didn't take down IndexedDB at the same time.
 * - Holds 20 most recent snapshots; older entries are pruned automatically.
 *
 * The Score type is treated as opaque JSON here — no Zod validation on
 * write, leniently parsed on read (callers handle malformed payloads).
 */

import type { Score } from "./schema";

const DB_NAME = "notationapp-autosave";
const STORE = "snapshots";
const VERSION = 1;
const MAX_SNAPSHOTS = 20;

export interface AutosaveSnapshot {
  /** ms since epoch, used as the IndexedDB key. */
  timestamp: number;
  /** Score title at the time of the snapshot, for display in the recovery list. */
  title: string;
  /** Brief summary (e.g. "5 sections" or "16 measures, 2 staves"). */
  summary: string;
  /** The full score JSON. */
  score: Score;
}

/** Open the database, creating the object store on first use. */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "timestamp" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Compute a short summary line for the snapshot list. */
function describeScore(score: Score): string {
  const isChordChart = score.sections && score.sections.length > 0;
  if (isChordChart) {
    const lineCount = score.sections.reduce((n, s) => n + s.lines.length, 0);
    return `${score.sections.length} section${score.sections.length === 1 ? "" : "s"}, ${lineCount} line${lineCount === 1 ? "" : "s"}`;
  }
  const totalNotes = score.staves.reduce(
    (n, st) => n + st.voices.reduce((m, v) => m + v.notes.length, 0),
    0,
  );
  return `${score.measures} bar${score.measures === 1 ? "" : "s"}, ${score.staves.length} staff${score.staves.length === 1 ? "" : "s"}, ${totalNotes} note${totalNotes === 1 ? "" : "s"}`;
}

/** Save a snapshot of the score. Auto-prunes to MAX_SNAPSHOTS keeping newest. */
export async function saveSnapshot(score: Score): Promise<void> {
  const db = await openDB();
  const snap: AutosaveSnapshot = {
    timestamp: Date.now(),
    title: score.title || "Untitled",
    summary: describeScore(score),
    score,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(snap);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await pruneOldSnapshots(db);
  db.close();
}

async function pruneOldSnapshots(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.openCursor(null, "prev"); // newest first
    let kept = 0;
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      kept += 1;
      if (kept > MAX_SNAPSHOTS) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Return all snapshots, newest first. The score field is omitted from
 *  the list payload to keep it small; call loadSnapshot() to fetch one. */
export async function listSnapshots(): Promise<Omit<AutosaveSnapshot, "score">[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out: Omit<AutosaveSnapshot, "score">[] = [];
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.openCursor(null, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        db.close();
        resolve(out);
        return;
      }
      const v = cursor.value as AutosaveSnapshot;
      out.push({ timestamp: v.timestamp, title: v.title, summary: v.summary });
      cursor.continue();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/** Load a single snapshot by its timestamp. */
export async function loadSnapshot(timestamp: number): Promise<AutosaveSnapshot | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.get(timestamp);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as AutosaveSnapshot) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/** Delete a snapshot. */
export async function deleteSnapshot(timestamp: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.delete(timestamp);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
