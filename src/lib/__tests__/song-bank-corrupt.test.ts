import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSongs, restoreBankIfLost, setSongs, type SongBankEntry } from "@/lib/song-bank";
import type { Score } from "@/lib/schema";

const STORAGE_KEY = "notation-app-songs";
const CORRUPT_KEY = "notation-app-songs-corrupt";

function entry(id: string, title: string): SongBankEntry {
  return { id, title, savedAt: Date.now(), score: { title } as unknown as Score };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("getSongs with a corrupt bank payload", () => {
  it("returns [] but preserves the raw payload under the corrupt key", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(getSongs()).toEqual([]);
    expect(localStorage.getItem(CORRUPT_KEY)).toBe("{not valid json");
  });

  it("treats a non-array payload as corrupt", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ oops: true }));
    expect(getSongs()).toEqual([]);
    expect(localStorage.getItem(CORRUPT_KEY)).toBe(JSON.stringify({ oops: true }));
  });

  it("keeps the FIRST corrupt payload (never overwritten by later garbage)", () => {
    localStorage.setItem(STORAGE_KEY, "first-garbage");
    getSongs();
    localStorage.setItem(STORAGE_KEY, "second-garbage");
    getSongs();
    expect(localStorage.getItem(CORRUPT_KEY)).toBe("first-garbage");
  });

  it("dispatches notation-persist-failed so the banner surfaces it", () => {
    const seen: string[] = [];
    const onFail = (e: Event) =>
      seen.push((e as CustomEvent<{ error?: string }>).detail?.error ?? "");
    window.addEventListener("notation-persist-failed", onFail);
    localStorage.setItem(STORAGE_KEY, "!!!");
    getSongs();
    window.removeEventListener("notation-persist-failed", onFail);
    expect(seen.length).toBe(1);
  });

  it("a later setSongs replaces the bank but the corrupt payload survives", () => {
    localStorage.setItem(STORAGE_KEY, "corrupted-bank-with-real-songs");
    getSongs(); // preserves payload
    expect(setSongs([entry("a", "New Song")])).toBe(true);
    expect(getSongs().map((s) => s.title)).toEqual(["New Song"]);
    expect(localStorage.getItem(CORRUPT_KEY)).toBe("corrupted-bank-with-real-songs");
  });
});

describe("restoreBankIfLost", () => {
  it("is a no-op when the bank has songs", async () => {
    setSongs([entry("a", "Kept")]);
    expect(await restoreBankIfLost()).toBe(0);
    expect(getSongs().map((s) => s.title)).toEqual(["Kept"]);
  });

  it("degrades to 0 when IndexedDB is unavailable", async () => {
    // happy-dom has no real IndexedDB persistence between calls in this
    // environment; the guard must swallow that rather than throw.
    expect(await restoreBankIfLost()).toBe(0);
  });
});
