import { describe, expect, it } from "vitest";
import { songSetMembership, type SongSet } from "@/lib/song-sets";

function set(id: string, name: string, songIds: string[]): SongSet {
  return { id, name, songIds, createdAt: 0, updatedAt: 0 };
}

describe("songSetMembership", () => {
  it("returns an empty map for an empty sets list", () => {
    expect(songSetMembership([]).size).toBe(0);
  });

  it("maps each songId to the single set it belongs to", () => {
    const a = set("set-a", "Friday gig", ["song-1", "song-2"]);
    const b = set("set-b", "Tuesday rehearsal", ["song-3"]);
    const out = songSetMembership([a, b]);
    expect(out.get("song-1")?.map((s) => s.id)).toEqual(["set-a"]);
    expect(out.get("song-2")?.map((s) => s.id)).toEqual(["set-a"]);
    expect(out.get("song-3")?.map((s) => s.id)).toEqual(["set-b"]);
  });

  it("collects multiple sets when a song belongs to several", () => {
    const a = set("set-a", "Friday gig", ["song-1"]);
    const b = set("set-b", "Tuesday rehearsal", ["song-1"]);
    const c = set("set-c", "Solo", ["song-1"]);
    const out = songSetMembership([a, b, c]);
    expect(out.get("song-1")?.map((s) => s.id)).toEqual(["set-a", "set-b", "set-c"]);
  });

  it("preserves the input set order across each song's list", () => {
    // Different input order → different output order. Important so
    // the UI sees stable chip/pill ordering matching the user's
    // saved set order.
    const a = set("set-a", "Friday gig", ["song-1"]);
    const b = set("set-b", "Tuesday rehearsal", ["song-1"]);
    const c = set("set-c", "Solo", ["song-1"]);
    const out1 = songSetMembership([c, a, b]);
    expect(out1.get("song-1")?.map((s) => s.id)).toEqual(["set-c", "set-a", "set-b"]);
  });

  it("omits songIds that no set references", () => {
    const a = set("set-a", "Friday gig", ["song-1"]);
    const out = songSetMembership([a]);
    expect(out.has("song-1")).toBe(true);
    expect(out.has("song-unknown")).toBe(false);
  });

  it("handles empty songIds inside a set without crashing", () => {
    const a = set("set-a", "Empty set", []);
    const b = set("set-b", "Has one", ["song-1"]);
    const out = songSetMembership([a, b]);
    expect(out.size).toBe(1);
    expect(out.get("song-1")?.map((s) => s.id)).toEqual(["set-b"]);
  });
});
