import { beforeEach, describe, expect, it } from "vitest";
import {
  createSet,
  renameSet,
  deleteSet,
  addSongToSet,
  removeSongFromSet,
  reorderSong,
  getSets,
} from "../song-sets";

beforeEach(() => {
  localStorage.clear();
});

describe("createSet", () => {
  it("creates a set with a trimmed name and empty songIds", () => {
    const s = createSet("  Friday gig  ");
    expect(s.name).toBe("Friday gig");
    expect(s.songIds).toEqual([]);
    expect(getSets()).toHaveLength(1);
  });

  it("falls back to 'Untitled set' on empty name", () => {
    const s = createSet("");
    expect(s.name).toBe("Untitled set");
  });
});

describe("renameSet", () => {
  it("updates name + updatedAt", () => {
    const s = createSet("A");
    const renamed = renameSet(s.id, "B");
    expect(renamed?.name).toBe("B");
    expect(renamed!.updatedAt).toBeGreaterThanOrEqual(s.updatedAt);
  });

  it("rejects empty rename (no-op)", () => {
    const s = createSet("A");
    const renamed = renameSet(s.id, "   ");
    expect(renamed?.name).toBe("A");
  });

  it("returns null for unknown id", () => {
    expect(renameSet("missing", "X")).toBeNull();
  });
});

describe("deleteSet", () => {
  it("removes the set", () => {
    const a = createSet("A");
    createSet("B");
    deleteSet(a.id);
    expect(getSets().map((s) => s.name)).toEqual(["B"]);
  });
});

describe("addSongToSet / removeSongFromSet", () => {
  it("appends and dedupes", () => {
    const s = createSet("Set");
    addSongToSet(s.id, "song1");
    addSongToSet(s.id, "song2");
    addSongToSet(s.id, "song1"); // duplicate, ignored
    const after = getSets()[0];
    expect(after.songIds).toEqual(["song1", "song2"]);
  });

  it("removes by id", () => {
    const s = createSet("Set");
    addSongToSet(s.id, "song1");
    addSongToSet(s.id, "song2");
    removeSongFromSet(s.id, "song1");
    expect(getSets()[0].songIds).toEqual(["song2"]);
  });
});

describe("reorderSong", () => {
  it("moves a song to a different position", () => {
    const s = createSet("Set");
    addSongToSet(s.id, "a");
    addSongToSet(s.id, "b");
    addSongToSet(s.id, "c");
    reorderSong(s.id, 0, 2);
    expect(getSets()[0].songIds).toEqual(["b", "c", "a"]);
  });

  it("ignores out-of-range indices", () => {
    const s = createSet("Set");
    addSongToSet(s.id, "a");
    addSongToSet(s.id, "b");
    reorderSong(s.id, -1, 5);
    expect(getSets()[0].songIds).toEqual(["a", "b"]);
  });

  it("no-op for from===to", () => {
    const s = createSet("Set");
    addSongToSet(s.id, "a");
    addSongToSet(s.id, "b");
    reorderSong(s.id, 0, 0);
    expect(getSets()[0].songIds).toEqual(["a", "b"]);
  });
});

describe("getSets", () => {
  it("survives a corrupt localStorage value", () => {
    localStorage.setItem("notation-app-song-sets", "not json");
    expect(getSets()).toEqual([]);
  });
});
