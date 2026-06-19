import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Score } from "../schema";
import type { SongDTO } from "../song-cloud-types";

// ── Score factory ─────────────────────────────────────────────────────

function buildScore(overrides: Partial<Score> = {}): Score {
  return {
    id: "test-score",
    title: "Test",
    composer: "",
    tempo: 120,
    timeSignature: "4/4",
    keySignature: "C",
    measures: 4,
    anacrusis: false,
    staves: [],
    chordSymbols: [],
    rehearsalMarks: [],
    repeats: [],
    measureChanges: [],
    sections: [
      {
        id: "v1",
        label: "Verse 1",
        lines: [{ chords: "C", lyrics: "hello" }],
      },
    ],
    form: [],
    annotations: [],
    metadata: {},
    ...overrides,
  };
}

// ── Test setup ────────────────────────────────────────────────────────

beforeEach(() => {
  // Each test gets a fresh localStorage and a fresh fetch mock.
  localStorage.clear();
  // Stable device id keeps the x-device-id header predictable across calls.
  localStorage.setItem("notation-app-device-id", "test-device-id");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Build a fetch mock that responds based on URL+method. Each handler
 *  returns either a parsed body or a tuple [status, body]. */
function mockFetch(handlers: Record<string, (req: { method: string; body: unknown }) => unknown | [number, unknown]>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const path = new URL(url).pathname;
    const key = `${method} ${path}`;
    const handler = handlers[key];
    if (!handler) {
      // Unmatched calls are a test bug — surface explicitly.
      throw new Error(`unhandled fetch: ${key}`);
    }
    const result = handler({ method, body });
    if (Array.isArray(result) && typeof result[0] === "number") {
      const [status, payload] = result as [number, unknown];
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

// Helper: build a SongDTO matching a Score, with a fixed version.
function dto(score: Score, version = "v1", folder?: string): SongDTO {
  return {
    id: score.id,
    title: score.title,
    savedAt: 1_000,
    updatedAt: 1_000,
    version,
    score,
    ...(folder ? { folder } : {}),
  };
}

// ── autosaveToCloud — happy path ───────────────────────────────────────

describe("autosaveToCloud", () => {
  it("PUTs the score and updates local entry with new cloudVersion", async () => {
    const { autosaveToCloud } = await import("../cloud-autosave");
    const { saveSong, getSongs } = await import("../song-bank");

    const score = buildScore({ id: "abc", title: "Hello" });
    saveSong("Hello", score);
    const local = getSongs();
    expect(local).toHaveLength(1);
    const songId = local[0].id;

    mockFetch({
      [`PUT /songs/${songId}`]: () => dto({ ...score, id: songId }, "fresh-version"),
    });

    const ok = await autosaveToCloud(songId, score);
    expect(ok).toBe(true);

    const refreshed = getSongs();
    expect(refreshed[0].cloudVersion).toBe("fresh-version");
  });

  it("sends expectedVersion when local entry has cloudVersion", async () => {
    const { autosaveToCloud } = await import("../cloud-autosave");
    const { saveSong, getSongs, updateSong } = await import("../song-bank");

    const score = buildScore({ id: "v" });
    saveSong("V", score);
    const songId = getSongs()[0].id;
    updateSong(songId, { cloudVersion: "v0" });

    let receivedExpected: string | undefined;
    mockFetch({
      [`PUT /songs/${songId}`]: ({ body }) => {
        receivedExpected = (body as { expectedVersion?: string }).expectedVersion;
        return dto({ ...score, id: songId }, "v1");
      },
    });

    await autosaveToCloud(songId, score);
    expect(receivedExpected).toBe("v0");
  });
});

// ── 409 → auto-merge path ──────────────────────────────────────────────

describe("autosaveToCloud — 409 auto-merge", () => {
  it("merges and silently re-saves when the conflict is non-overlapping", async () => {
    const { autosaveToCloud, CloudSaveEvents } = await import("../cloud-autosave");
    const { saveSong, getSongs, updateSong } = await import("../song-bank");

    const baseScore = buildScore({
      id: "song",
      sections: [
        {
          id: "v1",
          label: "Verse 1",
          lines: [
            { chords: "C", lyrics: "line a" },
            { chords: "G", lyrics: "line b" },
          ],
        },
      ],
    });
    saveSong("Song", baseScore);
    const songId = getSongs()[0].id;
    updateSong(songId, { cloudVersion: "v0" });

    // Mine: edit line 0 chord.
    const mine = buildScore({
      ...baseScore,
      id: songId,
      sections: [
        {
          id: "v1",
          label: "Verse 1",
          lines: [
            { chords: "Am", lyrics: "line a" },
            { chords: "G", lyrics: "line b" },
          ],
        },
      ],
    });

    // Theirs (cloud): edit line 1 chord.
    const theirs = buildScore({
      ...baseScore,
      id: songId,
      sections: [
        {
          id: "v1",
          label: "Verse 1",
          lines: [
            { chords: "C", lyrics: "line a" },
            { chords: "Em", lyrics: "line b" },
          ],
        },
      ],
    });

    let putCalls = 0;
    let mergedScoreSent: Score | undefined;
    mockFetch({
      [`PUT /songs/${songId}`]: ({ body }) => {
        putCalls++;
        if (putCalls === 1) {
          // First PUT → 409 with theirs as current.
          return [409, { error: "conflict", current: dto(theirs, "v1") }];
        }
        // Second PUT (the merge retry) → success.
        mergedScoreSent = (body as { score: Score }).score;
        return dto((body as { score: Score }).score, "v2");
      },
    });

    const mergedEvents: Score[] = [];
    const onMerged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { score: Score };
      mergedEvents.push(detail.score);
    };
    window.addEventListener(CloudSaveEvents.Merged, onMerged);

    const ok = await autosaveToCloud(songId, mine);

    window.removeEventListener(CloudSaveEvents.Merged, onMerged);

    expect(ok).toBe(true);
    expect(putCalls).toBe(2);
    // The merged score sent up should have BOTH edits.
    expect(mergedScoreSent?.sections[0].lines[0].chords).toBe("Am");
    expect(mergedScoreSent?.sections[0].lines[1].chords).toBe("Em");
    // Toast event fired.
    expect(mergedEvents).toHaveLength(1);
    // Local cloudVersion advanced to the merge result's version.
    expect(getSongs()[0].cloudVersion).toBe("v2");
  });

  it("falls through to the conflict modal when same-line chords disagree", async () => {
    const { autosaveToCloud, CloudSaveEvents } = await import("../cloud-autosave");
    const { saveSong, getSongs, updateSong } = await import("../song-bank");

    const base = buildScore({ id: "x" });
    saveSong("X", base);
    const songId = getSongs()[0].id;
    updateSong(songId, { cloudVersion: "v0" });

    const mine = buildScore({
      ...base,
      id: songId,
      sections: [{ id: "v1", label: "Verse 1", lines: [{ chords: "Am", lyrics: "hello" }] }],
    });
    const theirs = buildScore({
      ...base,
      id: songId,
      sections: [{ id: "v1", label: "Verse 1", lines: [{ chords: "Em", lyrics: "hello" }] }],
    });

    mockFetch({
      [`PUT /songs/${songId}`]: () => [409, { error: "conflict", current: dto(theirs, "v1") }],
    });

    const conflicts: { current: SongDTO }[] = [];
    const onConflict = (e: Event) => {
      conflicts.push((e as CustomEvent).detail);
    };
    window.addEventListener(CloudSaveEvents.Conflict, onConflict);

    const ok = await autosaveToCloud(songId, mine);

    window.removeEventListener(CloudSaveEvents.Conflict, onConflict);

    expect(ok).toBe(false);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].current.score.sections[0].lines[0].chords).toBe("Em");
  });
});

// ── syncSongbook — tombstone respect ───────────────────────────────────

describe("syncSongbook — tombstone deletion", () => {
  it("drops a local entry when cloud lists nothing AND cloudVersion is set", async () => {
    const { syncSongbook } = await import("../song-cloud");
    const { saveSong, getSongs, updateSong } = await import("../song-bank");

    saveSong("Tombstoned", buildScore({ title: "Tombstoned" }));
    const id = getSongs()[0].id;
    updateSong(id, { cloudVersion: "v9" });

    mockFetch({
      "GET /songs": () => ({ songs: [] }),
    });

    const merged = await syncSongbook();
    expect(merged).toHaveLength(0);
    expect(getSongs()).toHaveLength(0);
  });

  it("does NOT tombstone an entry with unpushed local edits — re-pushes it instead", async () => {
    // Regression: a song edited on this device (pendingSync) whose id is
    // missing from the cloud list must be re-pushed, not dropped. Otherwise
    // an edit-then-vanish happens when a prior push didn't land.
    const { syncSongbook } = await import("../song-cloud");
    const { saveSong, getSongs, updateSong } = await import("../song-bank");

    saveSong("Dirty", buildScore({ title: "Dirty" }));
    const id = getSongs()[0].id;
    updateSong(id, { cloudVersion: "v9", pendingSync: true });

    let pushed = false;
    mockFetch({
      "GET /songs": () => ({ songs: [] }),
      [`PUT /songs/${id}`]: () => {
        pushed = true;
        return dto(buildScore({ id, title: "Dirty" }), "rescued");
      },
    });

    const merged = await syncSongbook();
    expect(pushed).toBe(true);
    expect(merged).toHaveLength(1);
    expect(merged[0].cloudVersion).toBe("rescued");
    expect(merged[0].pendingSync).toBe(false);
  });

  it("pushes a never-synced local entry up (legacy migration)", async () => {
    const { syncSongbook } = await import("../song-cloud");
    const { saveSong, getSongs } = await import("../song-bank");

    saveSong("Legacy", buildScore({ title: "Legacy" }));
    const id = getSongs()[0].id;

    let pushed: { score: Score } | undefined;
    mockFetch({
      "GET /songs": () => ({ songs: [] }),
      [`PUT /songs/${id}`]: ({ body }) => {
        pushed = body as { score: Score };
        return dto(buildScore({ id, title: "Legacy" }), "freshly-pushed");
      },
    });

    const merged = await syncSongbook();
    expect(pushed).toBeTruthy();
    expect(merged).toHaveLength(1);
    expect(merged[0].cloudVersion).toBe("freshly-pushed");
  });

  it("pulls a cloud entry when local doesn't have it", async () => {
    const { syncSongbook } = await import("../song-cloud");
    const { getSongs } = await import("../song-bank");

    const cloudScore = buildScore({ id: "remote", title: "Remote" });
    mockFetch({
      "GET /songs": () => ({
        songs: [
          {
            id: "remote",
            title: "Remote",
            savedAt: 5_000,
            updatedAt: 5_000,
            version: "rv1",
          },
        ],
      }),
      "GET /songs/remote": () => dto(cloudScore, "rv1"),
    });

    const merged = await syncSongbook();
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("Remote");
    expect(merged[0].cloudVersion).toBe("rv1");
    // Local mirror also written.
    expect(getSongs()).toHaveLength(1);
  });

  it("uses local for entries newer than cloud (push-up path)", async () => {
    const { syncSongbook } = await import("../song-cloud");
    const { saveSong, getSongs, updateSong } = await import("../song-bank");

    saveSong("Edited", buildScore({ title: "Edited" }));
    const id = getSongs()[0].id;
    updateSong(id, { cloudVersion: "old", savedAt: 9_000 });

    let putBody: { score: Score; expectedVersion?: string } | undefined;
    mockFetch({
      "GET /songs": () => ({
        songs: [
          {
            id,
            title: "Edited",
            savedAt: 5_000,
            updatedAt: 5_000,
            version: "old",
          },
        ],
      }),
      [`PUT /songs/${id}`]: ({ body }) => {
        putBody = body as { score: Score; expectedVersion?: string };
        return dto(buildScore({ id, title: "Edited" }), "new");
      },
    });

    const merged = await syncSongbook();
    expect(putBody?.expectedVersion).toBe("old");
    expect(merged[0].cloudVersion).toBe("new");
  });
});

// ── enqueueOffline / hasPendingOps / flushQueue ────────────────────────

describe("offline queue", () => {
  it("collapses repeated enqueues for the same id", async () => {
    const { enqueueOffline, hasPendingOps } = await import("../song-cloud");
    expect(hasPendingOps()).toBe(false);
    enqueueOffline({ type: "put", id: "a", title: "A1", score: buildScore() });
    enqueueOffline({ type: "put", id: "a", title: "A2", score: buildScore() });
    enqueueOffline({ type: "delete", id: "b" });
    expect(hasPendingOps()).toBe(true);
    const raw = JSON.parse(localStorage.getItem("notation-app-cloud-queue") ?? "[]");
    expect(raw).toHaveLength(2);
    // Latest 'a' wins
    expect(raw[0].title).toBe("A2");
    expect(raw[1].id).toBe("b");
  });
});
