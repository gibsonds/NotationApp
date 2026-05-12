import { beforeEach, describe, expect, it } from "vitest";
import type { Score } from "@/lib/schema";
import type { SongBankEntry } from "@/lib/song-bank";
import {
  addSongToSet,
  createSet,
  filterCandidatesForSheet,
  getSets,
} from "@/lib/song-sets";

beforeEach(() => {
  localStorage.clear();
});

// Minimal SongBankEntry factory. The schema in the bank carries plenty
// of fields, but the AddToSet flow only consults id + title — keep the
// fixtures terse so the assertions are easy to read.
function song(id: string, title: string): SongBankEntry {
  return { id, title, savedAt: 1_700_000_000_000, score: {} as Score };
}

describe("AddToSetSheet — pickSet flow (bulk add to a chosen set)", () => {
  it("adds every selected song id to the chosen set in one batch", () => {
    const s = createSet("Friday gig");
    // Simulate the sheet calling addSongToSet per id on Add click.
    addSongToSet(s.id, "song-1");
    addSongToSet(s.id, "song-2");
    addSongToSet(s.id, "song-3");
    expect(getSets()[0].songIds).toEqual(["song-1", "song-2", "song-3"]);
  });

  it("dedupes against existing membership when re-adding", () => {
    const s = createSet("Friday gig");
    addSongToSet(s.id, "song-1");
    // User opens the sheet again, picks the same song plus a new one.
    addSongToSet(s.id, "song-1"); // already there, no-op
    addSongToSet(s.id, "song-2");
    expect(getSets()[0].songIds).toEqual(["song-1", "song-2"]);
  });

  it("creates a new set then adds songs in one user motion", () => {
    // The "+ New set" inline-create branch: createSet returns the new
    // entry, then the caller batch-adds.
    const fresh = createSet("Tuesday rehearsal");
    addSongToSet(fresh.id, "a");
    addSongToSet(fresh.id, "b");
    const out = getSets();
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Tuesday rehearsal");
    expect(out[0].songIds).toEqual(["a", "b"]);
  });
});

describe("AddToSetSheet — pickSongs flow (candidate filter)", () => {
  const all: SongBankEntry[] = [
    song("a", "Anywhere"),
    song("b", "Friday Night"),
    song("c", "Foggy Night"),
    song("d", "Friday Night (snapped)"),       // alias — must hide
    song("e", "Anywhere (recovered 9:06 PM)"), // alias — must hide
    song("f", "Tuesday Blues (latest 1:00 AM)"), // alias — must hide
    song("g", "Sunday Morning"),
  ];

  it("hides songs already in the target set", () => {
    const out = filterCandidatesForSheet(all, ["a", "c"]);
    expect(out.map((s) => s.id).sort()).toEqual(["b", "g"]);
  });

  it("hides alias-titled songs (snapped / recovered / latest)", () => {
    const out = filterCandidatesForSheet(all, []);
    // Aliases d, e, f are dropped; a, b, c, g remain.
    expect(out.map((s) => s.id).sort()).toEqual(["a", "b", "c", "g"]);
  });

  it("applies case-insensitive substring search", () => {
    const out = filterCandidatesForSheet(all, [], "night");
    // "Friday Night" + "Foggy Night" — aliases excluded
    expect(out.map((s) => s.title).sort()).toEqual([
      "Foggy Night",
      "Friday Night",
    ]);
  });

  it("returns nothing when every song is already in the set", () => {
    const out = filterCandidatesForSheet(all, all.map((s) => s.id));
    expect(out).toEqual([]);
  });

  it("trims whitespace-only search to a no-op match-all", () => {
    const out = filterCandidatesForSheet(all, [], "   ");
    // Same as no search: 4 non-alias songs.
    expect(out).toHaveLength(4);
  });

  it("combines all three filters together", () => {
    // Target set has 'a' already; search "night" → only b and c (d is alias).
    const out = filterCandidatesForSheet(all, ["a"], "night");
    expect(out.map((s) => s.id).sort()).toEqual(["b", "c"]);
  });

  it("search is canonical-aware (smart quotes match straight)", () => {
    const iPadList: SongBankEntry[] = [
      song("p1", "Friday’s gig"),  // smart quote (iPad auto-correct)
      song("p2", "Tuesday Blues"),
    ];
    // Mac-typed straight-quote query matches iPad smart-quote song
    const out = filterCandidatesForSheet(iPadList, [], "friday's");
    expect(out.map((s) => s.id)).toEqual(["p1"]);
  });

  it("search is canonical-aware (NFD accents match NFC)", () => {
    const list: SongBankEntry[] = [
      song("p1", "Café Anthem"),       // precomposed é (NFC)
      song("p2", "Random other song"),
    ];
    // Decomposed query (e + combining acute) matches precomposed song
    const out = filterCandidatesForSheet(list, [], "café");
    expect(out.map((s) => s.id)).toEqual(["p1"]);
  });
});

describe("AddToSetSheet — end-to-end batch add through public lib API", () => {
  it("a user opens an empty set, search-filters, multi-selects, and adds", () => {
    const all: SongBankEntry[] = [
      song("rock-1", "Rocky Mountain"),
      song("rock-2", "Rocking Chair"),
      song("blues-1", "Blue Moon"),
      song("rock-3", "Rocky Top (snapped)"), // alias
    ];
    const target = createSet("Rock songs");

    const candidates = filterCandidatesForSheet(all, target.songIds, "rock");
    // Two real "rock" matches; alias dropped.
    expect(candidates.map((s) => s.id)).toEqual(["rock-1", "rock-2"]);

    // User checks both, clicks Add — the sheet calls addSongToSet per id.
    for (const c of candidates) addSongToSet(target.id, c.id);

    expect(getSets()[0].songIds).toEqual(["rock-1", "rock-2"]);
  });
});
