import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MySongsModal from "../MySongsModal";
import AutosaveRecoveryDialog from "../AutosaveRecoveryDialog";
import { DEFAULT_UI_STATE, useScoreStore } from "@/store/score-store";
import { getSongs } from "@/lib/song-bank";
import { cloudGetVersion, cloudListVersions } from "@/lib/song-cloud";
import { listSnapshots, loadSnapshot } from "@/lib/autosave";
import type { Score } from "@/lib/schema";

vi.mock("@/lib/song-cloud", async (original) => ({
  ...await original<typeof import("@/lib/song-cloud")>(),
  syncSongbook: vi.fn(async () => getSongs()),
  cloudListVersions: vi.fn(async () => []),
  cloudGetVersion: vi.fn(),
}));
vi.mock("@/lib/autosave", () => ({
  listSnapshots: vi.fn(async () => []),
  loadSnapshot: vi.fn(),
  saveSnapshot: vi.fn(async () => {}),
  deleteSnapshot: vi.fn(),
}));

const score: Score = {
  id: "test-score", title: "Test song", composer: "", tempo: 120,
  timeSignature: "4/4", keySignature: "C", measures: 4, anacrusis: false,
  staves: [], chordSymbols: [], rehearsalMarks: [], repeats: [], measureChanges: [],
  sections: [{ id: "verse", label: "Verse", lines: [{ chords: "C", lyrics: "test" }] }],
  form: [], annotations: [], metadata: {},
};
const songs = [
  { id: "other-song", title: "Other song", score: { ...score, id: "other-score", title: "Other song" }, savedAt: 0 },
  { id: "test-song", title: score.title, score, folder: "Test folder", savedAt: 1 },
];
let container: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listSnapshots).mockResolvedValue([]);
  vi.mocked(cloudListVersions).mockResolvedValue([]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  localStorage.setItem("notation-app-songs", JSON.stringify(songs));
  useScoreStore.setState({ score: null, history: [], historyIndex: -1, uiState: { ...DEFAULT_UI_STATE, collapsedFolders: [] } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onClose = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function openSongs() {
  await act(async () => root.render(<MySongsModal onClose={onClose} />));
}
function button(name: string, scope: Element = container): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll("button")).find(el =>
    (el.getAttribute("aria-label") || el.textContent?.trim()) === name);
  expect(found, `button ${name}`).toBeDefined();
  return found!;
}
async function click(element: Element) {
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
function overlay(layer: "z-[110]" | "z-[100]") {
  const found = Array.from(container.firstElementChild!.children).find(el => el.classList.contains(layer));
  expect(found, layer).toBeDefined();
  return found!;
}
function expectSongsRemain() {
  expect(onClose).not.toHaveBeenCalled();
  expect(container.querySelector("h2")?.textContent).toBe("My Songs");
  expect(getSongs()).toEqual(songs);
}
function songActions() {
  const row = Array.from(container.querySelectorAll("li")).find(el => el.textContent?.includes(score.title));
  expect(row).toBeDefined();
  return button("More actions", row!);
}
async function openHistory() {
  await click(songActions());
  await click(button("View history"));
  return overlay("z-[100]");
}

describe("My Songs nested dismissal", () => {
  for (const menu of ["song actions", "folder actions", "folder picker"] as const) {
    it(`dismisses ${menu} without closing the song browser, including repeated use`, async () => {
      await openSongs();
      for (let attempt = 0; attempt < 2; attempt++) {
        await click(menu === "folder actions" ? button("Folder actions") : songActions());
        if (menu === "folder picker") await click(button("Move to folder…"));
        await click(overlay("z-[110]"));
        expectSongsRemain();
        expect(Array.from(container.firstElementChild!.children).some(el => el.classList.contains("z-[110]"))).toBe(false);
      }
    });
  }
  for (const method of ["close button", "backdrop"] as const) {
    it(`dismisses history via ${method} without closing the song browser`, async () => {
      await openSongs();
      const history = await openHistory();
      await click(method === "backdrop" ? history : button("Close", history));
      expectSongsRemain();
      expect(container.textContent).not.toContain("History —");
    });
  }
  it("still closes on the main backdrop", async () => {
    await openSongs();
    await click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("does not close on ordinary content clicks", async () => {
    await openSongs();
    await click(container.querySelector("h2")!);
    expectSongsRemain();
  });
  it("still closes via the explicit close button", async () => {
    await openSongs();
    await click(button("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  for (const source of ["local", "cloud"] as const) {
    it(`still closes the song browser after a successful ${source} restore`, async () => {
      if (source === "local") {
        const snapshot = { timestamp: 1, title: score.title, summary: "Saved test", score };
        vi.mocked(listSnapshots).mockResolvedValue([snapshot]);
        vi.mocked(loadSnapshot).mockResolvedValue(snapshot);
      } else {
        vi.mocked(cloudListVersions).mockResolvedValue([{ ts: 1, title: score.title, kind: "daily" }]);
        vi.mocked(cloudGetVersion).mockResolvedValue({ id: "test-song", title: score.title, score, savedAt: 1, updatedAt: 1, version: "v1" });
      }
      await openSongs();
      const history = await openHistory();
      await click(history.querySelector("li button")!);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(useScoreStore.getState().score?.id).toBe(score.id);
    });
  }
  it("still closes when explicitly loading a song", async () => {
    await openSongs();
    const row = songActions().closest("li")!;
    await click(button("Load", row));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useScoreStore.getState().score?.id).toBe(score.id);
  });
  for (const source of ["local", "cloud"] as const) {
    it(`keeps history open after a failed ${source} restore`, async () => {
      if (source === "local") {
        vi.mocked(listSnapshots).mockResolvedValue([{ timestamp: 1, title: score.title, summary: "Saved test" }]);
        vi.mocked(loadSnapshot).mockResolvedValue(null);
      } else {
        vi.mocked(cloudListVersions).mockResolvedValue([{ ts: 1, title: score.title, kind: "daily" }]);
        vi.mocked(cloudGetVersion).mockRejectedValue(new Error("Network unavailable"));
      }
      await openSongs();
      const history = await openHistory();
      await click(history.querySelector("li button")!);
      expectSongsRemain();
      expect(container.textContent).toContain("History —");
      expect(useScoreStore.getState().score).toBeNull();
    });
  }
  it("keeps the standalone recovery dialog close callback after restore", async () => {
    const snapshot = { timestamp: 1, title: score.title, summary: "Saved test", score };
    vi.mocked(listSnapshots).mockResolvedValue([snapshot]);
    vi.mocked(loadSnapshot).mockResolvedValue(snapshot);
    await act(async () => root.render(<AutosaveRecoveryDialog onClose={onClose} />));
    await click(container.querySelector("li button")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
