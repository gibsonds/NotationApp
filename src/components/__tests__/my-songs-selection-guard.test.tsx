import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthSnapshot } from "@/lib/auth";
import type { SongBankEntry } from "@/lib/song-bank";
import { ScoreSchema } from "@/lib/schema";
import MySongsModal from "../MySongsModal";

const model = vi.hoisted(() => ({
  snapshot: null as AuthSnapshot | null, listeners: new Set<() => void>(), current: true,
  songs: [] as SongBankEntry[], sync: vi.fn(), adopt: vi.fn(),
  store: { score: null, uiState: { currentSongId: null, collapsedFolders: [] }, setScore: vi.fn(), setUIState: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({
  AUTH_ENABLED: true,
  getSnapshot: () => model.snapshot,
  subscribe: (callback: () => void) => { model.listeners.add(callback); return () => model.listeners.delete(callback); },
  setActiveSongbook: vi.fn(), beginSignIn: vi.fn(), legacyImportDone: () => true,
}));
vi.mock("@/lib/songbook-storage", () => ({ songbookScopeIsCurrent: () => model.current, songbookStorageKey: (key: string) => `${key}:synthetic` }));
vi.mock("@/lib/song-cloud", () => ({
  CLOUD_ENABLED: true, getDeviceId: () => "synthetic-device", syncSongbook: model.sync,
  cloudDeleteSong: vi.fn(), cloudPutSong: vi.fn(), enqueueOffline: vi.fn(),
  extractJoinCode: vi.fn(), isTransient: vi.fn(), switchToSongbook: vi.fn(),
}));
vi.mock("@/lib/song-bank", async () => ({ ...await vi.importActual<object>("@/lib/song-bank"), getSongs: () => model.songs }));
vi.mock("@/lib/open-song-sync", () => ({ adoptSyncedOpenSong: model.adopt }));
vi.mock("@/lib/analytics", () => ({ logEvent: vi.fn(), scoreTypeOf: vi.fn() }));
vi.mock("@/store/score-store", () => ({ useScoreStore: Object.assign(
  (selector: (state: typeof model.store) => unknown) => selector(model.store), { getState: () => model.store },
) }));

let root: Root, mount: HTMLDivElement;
const cached: SongBankEntry = { id: "cached", title: "Cached prior chart", savedAt: 1,
  score: ScoreSchema.parse({ id: "cached", title: "Cached prior chart", measures: 1, staves: [] }) };
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); model.current = true;
  model.snapshot = { status: "signed-in", claims: { sub: "synthetic-account" }, verifiedAccount: { sub: "synthetic-account" },
    activeSongbookId: "home", memberships: [{ songbookId: "home", name: "My Songs", role: "owner" }] };
  model.songs = [cached]; model.sync.mockReset(); model.adopt.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
});
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); model.listeners.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("shows the picker without cached rows or sync before a book is selected", async () => {
  model.snapshot = { ...model.snapshot!, activeSongbookId: null };
  await act(async () => root.render(<MySongsModal onClose={() => {}} />));
  expect(mount.textContent).toContain("Choose a songbook above");
  expect(mount.textContent).not.toContain(cached.title); expect(model.sync).not.toHaveBeenCalled();
});

it("rejects a late sync result as soon as session verification is lost", async () => {
  let finish!: (songs: SongBankEntry[]) => void;
  model.sync.mockImplementation(() => new Promise<SongBankEntry[]>(resolve => { finish = resolve; }));
  await act(async () => root.render(<MySongsModal onClose={() => {}} />));
  expect(model.sync).toHaveBeenCalledOnce();
  await act(async () => {
    model.snapshot = { ...model.snapshot!, verifiedAccount: null };
    model.listeners.forEach(callback => callback()); finish([{ ...cached, title: "Late chart" }]);
  });
  expect(mount.textContent).not.toContain(cached.title); expect(mount.textContent).not.toContain("Late chart");
  expect(model.adopt).not.toHaveBeenCalled(); expect(model.sync).toHaveBeenCalledOnce();
});

it("offers reload after a 401 clears the page scope and never displays cached rows", async () => {
  model.current = false;
  model.snapshot = { ...model.snapshot!, status: "signed-out", claims: null, verifiedAccount: null, activeSongbookId: null, memberships: [] };
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  await act(async () => root.render(<MySongsModal onClose={() => {}} />));
  expect(mount.textContent).not.toContain(cached.title); expect(model.sync).not.toHaveBeenCalled();
  const reload = Array.from(mount.querySelectorAll("button")).find(button => button.textContent === "Reload Charts")!;
  await act(async () => reload.click()); expect(window.location.reload).toHaveBeenCalledOnce();
});
