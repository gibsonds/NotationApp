import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_UI_STATE, useScoreStore } from "@/store/score-store";
import { adoptMergedScore, adoptSyncedOpenSong } from "@/lib/open-song-sync";
import type { SongBankEntry } from "@/lib/song-bank";
import type { Score } from "@/lib/schema";

/**
 * "App sometimes loads the wrong song on first load."
 *
 * My Songs kicks off a songbook sync when it opens. When the sync finishes
 * it may replace the open score with the cloud copy of the current song. It
 * used to decide which song is "current" from values captured when the sync
 * STARTED — so picking a song while the sync was still running got that
 * pick overwritten, a beat later, by the previous song's cloud copy.
 */

function buildScore(overrides: Partial<Score> = {}): Score {
  return {
    id: "score-a",
    title: "Song A",
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
    sections: [{ id: "v1", label: "Verse 1", lines: [{ chords: "C", lyrics: "hello" }] }],
    form: [],
    annotations: [],
    metadata: {},
    ...overrides,
  };
}

function entry(id: string, score: Score, savedAt = 1): SongBankEntry {
  return { id, title: score.title, savedAt, score, cloudVersion: "v1" };
}

const songA = buildScore({ id: "score-a", title: "Song A" });
const songAFromCloud = buildScore({
  id: "score-a",
  title: "Song A",
  sections: [{ id: "v1", label: "Verse 1", lines: [{ chords: "Am", lyrics: "hello (edited on iPad)" }] }],
});
const songB = buildScore({ id: "score-b", title: "Song B" });

function openSong(songId: string, score: Score) {
  const { setScore, setUIState } = useScoreStore.getState();
  setScore(score);
  setUIState({ currentSongId: songId });
}

beforeEach(() => {
  localStorage.clear();
  useScoreStore.setState({
    score: null,
    history: [],
    stepEntryHistory: [],
    historyIndex: -1,
    stepEntry: null,
    uiState: { ...DEFAULT_UI_STATE },
  });
});

describe("adoptSyncedOpenSong", () => {
  it("adopts the cloud copy of the song that is open when the sync finishes", () => {
    const pre = new Map([["song-a", entry("song-a", songA)]]);
    openSong("song-a", songA);

    const merged = [entry("song-a", songAFromCloud, 2)];
    expect(adoptSyncedOpenSong(merged, pre)).toBe(true);
    expect(useScoreStore.getState().score?.sections[0].lines[0].lyrics).toContain("edited on iPad");
    expect(useScoreStore.getState().uiState.currentSongId).toBe("song-a");
  });

  it("does not replace a song the user opened while the sync was in flight", () => {
    // Sync started with Song A open …
    const pre = new Map([
      ["song-a", entry("song-a", songA)],
      ["song-b", entry("song-b", songB)],
    ]);
    openSong("song-a", songA);

    // … the user picked Song B from the list before it finished …
    openSong("song-b", songB);

    // … and the cloud had a newer Song A. The old code swapped Song B out
    // for Song A here.
    const merged = [entry("song-a", songAFromCloud, 2), entry("song-b", songB)];
    expect(adoptSyncedOpenSong(merged, pre)).toBe(false);
    expect(useScoreStore.getState().score?.title).toBe("Song B");
    expect(useScoreStore.getState().uiState.currentSongId).toBe("song-b");
  });

  it("adopts a newer cloud copy of the song picked during the sync", () => {
    const pre = new Map([
      ["song-a", entry("song-a", songA)],
      ["song-b", entry("song-b", songB)],
    ]);
    openSong("song-a", songA);
    openSong("song-b", songB);

    const songBFromCloud = buildScore({ id: "score-b", title: "Song B", tempo: 90 });
    const merged = [entry("song-a", songA), entry("song-b", songBFromCloud, 2)];
    expect(adoptSyncedOpenSong(merged, pre)).toBe(true);
    expect(useScoreStore.getState().score?.tempo).toBe(90);
    expect(useScoreStore.getState().uiState.currentSongId).toBe("song-b");
  });

  it("keeps unsaved local edits over the cloud copy", () => {
    const pre = new Map([["song-a", entry("song-a", songA)]]);
    openSong("song-a", buildScore({ id: "score-a", title: "Song A", tempo: 200 }));

    const merged = [entry("song-a", songAFromCloud, 2)];
    expect(adoptSyncedOpenSong(merged, pre)).toBe(false);
    expect(useScoreStore.getState().score?.tempo).toBe(200);
  });

  it("refuses when the synced entry holds a different score than the one open", () => {
    // currentSongId points at an entry whose content is another song —
    // the corruption case. Never put that on screen.
    const pre = new Map([["song-a", entry("song-a", songA)]]);
    openSong("song-a", songA);

    const merged = [entry("song-a", songB, 2)];
    expect(adoptSyncedOpenSong(merged, pre)).toBe(false);
    expect(useScoreStore.getState().score?.title).toBe("Song A");
  });

  it("is a no-op with nothing open", () => {
    expect(adoptSyncedOpenSong([entry("song-a", songAFromCloud)], new Map())).toBe(false);
    expect(useScoreStore.getState().score).toBeNull();
  });
});

describe("adoptMergedScore", () => {
  it("adopts a merge for the open song", () => {
    openSong("song-a", songA);
    expect(adoptMergedScore("song-a", songAFromCloud)).toBe(true);
    expect(useScoreStore.getState().score?.sections[0].lines[0].chords).toBe("Am");
    expect(useScoreStore.getState().uiState.currentSongId).toBe("song-a");
  });

  it("ignores a merge for a song the user has navigated away from", () => {
    openSong("song-a", songA);
    openSong("song-b", songB);
    expect(adoptMergedScore("song-a", songAFromCloud)).toBe(false);
    expect(useScoreStore.getState().score?.title).toBe("Song B");
    expect(useScoreStore.getState().uiState.currentSongId).toBe("song-b");
  });

  it("ignores a merge whose score id does not match the open score", () => {
    openSong("song-a", songA);
    expect(adoptMergedScore("song-a", songB)).toBe(false);
    expect(useScoreStore.getState().score?.title).toBe("Song A");
  });
});
