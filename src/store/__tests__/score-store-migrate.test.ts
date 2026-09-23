import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_UI_STATE, useScoreStore } from "../score-store";

/**
 * New UIState fields must reach existing users. zustand's persist only runs
 * migrate() — where uiState is reconciled with DEFAULT_UI_STATE — when the
 * stored version differs from the current one, so every field added to
 * UIState needs a version bump. This shipped once as a render crash
 * (hiddenInlineRiffIds undefined -> .includes on undefined).
 */
beforeEach(() => {
  localStorage.clear();
});

describe("persist migration", () => {
  it("fills every DEFAULT_UI_STATE field into a stored state from the previous version", async () => {
    const current = useScoreStore.persist.getOptions().version!;
    const stale = {
      state: {
        score: null,
        projectId: null,
        history: [],
        historyIndex: 0,
        messages: [],
        lastOperation: null,
        savedRevisions: [],
        layout: useScoreStore.getState().layout,
        uiState: { performMode: true, currentSongId: "song-x" },
      },
      version: current - 1,
    };
    localStorage.setItem("notation-app-store", JSON.stringify(stale));
    await useScoreStore.persist.rehydrate();
    const ui = useScoreStore.getState().uiState;
    for (const key of Object.keys(DEFAULT_UI_STATE) as (keyof typeof DEFAULT_UI_STATE)[]) {
      expect(ui[key], `uiState.${key}`).not.toBeUndefined();
    }
    expect(ui.performMode).toBe(true);
    expect(ui.currentSongId).toBe("song-x");
    expect(ui.hiddenInlineRiffIds).toEqual([]);
  });

  it("the stored version matches the code's version after rehydrate", async () => {
    await useScoreStore.persist.rehydrate();
    useScoreStore.getState().setUIState({ sidebarOpen: false });
    const stored = JSON.parse(localStorage.getItem("notation-app-store")!);
    expect(stored.version).toBe(useScoreStore.persist.getOptions().version);
  });
});
