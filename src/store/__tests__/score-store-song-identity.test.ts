import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_UI_STATE, useScoreStore } from "../score-store";
import type { Score } from "@/lib/schema";

/**
 * setScore must drop a stale `currentSongId` when a DIFFERENT song replaces
 * the open score.
 *
 * The bug this guards: currentSongId points at whatever was last loaded from
 * My Songs. Creating a new song (New Score dialog, project/MusicXML import,
 * AI create) swaps the open score but used to leave currentSongId pointing at
 * the previous entry — so cloud autosave then pushed the NEW score into the
 * OLD entry, keeping that entry's original title. The entry titled "Love
 * Seeking Missile" ended up holding the score for "Look What I Made".
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

describe("setScore — song identity", () => {
  it("clears a stale currentSongId when a different song replaces the open score", () => {
    const { setScore, setUIState } = useScoreStore.getState();

    // A song is loaded from My Songs.
    const loaded = buildScore({ id: "score-lsm", title: "Love Seeking Missile" });
    setScore(loaded);
    setUIState({ currentSongId: "song-lsm-entry" });
    expect(useScoreStore.getState().uiState.currentSongId).toBe("song-lsm-entry");

    // A brand-new song is created while that one is still loaded.
    setScore(buildScore({ id: "score-lwim", title: "Look What I Made" }));

    // The link to the OLD entry must be gone, or autosave would push the new
    // score into the old entry under the old title.
    expect(useScoreStore.getState().uiState.currentSongId).toBeNull();
    expect(useScoreStore.getState().score?.title).toBe("Look What I Made");
  });

  it("keeps currentSongId for a same-song replacement (edit / replace_score / restore)", () => {
    const { setScore, setUIState } = useScoreStore.getState();

    setScore(buildScore({ id: "score-lsm", title: "Love Seeking Missile" }));
    setUIState({ currentSongId: "song-lsm-entry" });

    // An edit produces a new object with the SAME score id — still this song.
    setScore(
      buildScore({
        id: "score-lsm",
        title: "Love Seeking Missile",
        sections: [{ id: "v1", label: "Verse 1", lines: [{ chords: "Am", lyrics: "hello" }] }],
      })
    );

    expect(useScoreStore.getState().uiState.currentSongId).toBe("song-lsm-entry");
  });

  it("leaves the loader's currentSongId intact — loaders set it after setScore", () => {
    const { setScore, setUIState } = useScoreStore.getState();

    setScore(buildScore({ id: "score-a", title: "Song A" }));
    setUIState({ currentSongId: "song-a-entry" });

    // My Songs / Sets / perform-picker order: setScore(entry.score) then
    // setUIState({ currentSongId: entry.id }). The clear must not survive it.
    setScore(buildScore({ id: "score-b", title: "Song B" }));
    setUIState({ currentSongId: "song-b-entry" });

    expect(useScoreStore.getState().uiState.currentSongId).toBe("song-b-entry");
  });

  it("keeps other uiState fields when clearing currentSongId", () => {
    const { setScore, setUIState } = useScoreStore.getState();

    setScore(buildScore({ id: "score-a" }));
    setUIState({ currentSongId: "song-a-entry", performMode: true, activeSetId: "set-1" });

    setScore(buildScore({ id: "score-b" }));

    const ui = useScoreStore.getState().uiState;
    expect(ui.currentSongId).toBeNull();
    expect(ui.performMode).toBe(true);
    expect(ui.activeSetId).toBe("set-1");
  });

  it("does not clear when the incoming score has no id (legacy score)", () => {
    const { setScore, setUIState } = useScoreStore.getState();

    setScore(buildScore({ id: "score-a" }));
    setUIState({ currentSongId: "song-a-entry" });

    const legacy = buildScore();
    delete (legacy as { id?: string }).id;
    setScore(legacy);

    // Can't tell it apart — leave the link alone rather than silently
    // detaching a song the user is still editing.
    expect(useScoreStore.getState().uiState.currentSongId).toBe("song-a-entry");
  });
});
