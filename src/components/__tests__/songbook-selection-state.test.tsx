import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthSnapshot } from "@/lib/auth";
import SongbookSelectionState from "../SongbookSelectionState";
import { SongbookSwitcher } from "../SongbookSwitcher";

const model = vi.hoisted(() => ({
  snapshot: null as AuthSnapshot | null, listeners: new Set<() => void>(),
  setActive: vi.fn(), signIn: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({
  AUTH_ENABLED: true,
  getSnapshot: () => model.snapshot,
  subscribe: (callback: () => void) => { model.listeners.add(callback); return () => model.listeners.delete(callback); },
  setActiveSongbook: model.setActive, beginSignIn: model.signIn,
}));

let root: Root, mount: HTMLDivElement, trigger: HTMLButtonElement;
const close = vi.fn();
beforeEach(() => {
  model.snapshot = { status: "signed-in", claims: { sub: "synthetic-account" }, verifiedAccount: { sub: "synthetic-account" },
    activeSongbookId: null, memberships: [
      { songbookId: "a-test", name: "TestBook", role: "owner" },
      { songbookId: "z-other", name: "Rehearsals", role: "owner" },
    ] };
  model.setActive.mockClear(); model.signIn.mockClear(); close.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  trigger = document.createElement("button"); trigger.textContent = "My Songs";
  mount = document.createElement("div"); document.body.append(trigger, mount); trigger.focus(); root = createRoot(mount);
});
afterEach(async () => {
  await act(async () => root.unmount()); mount.remove(); trigger.remove();
  model.listeners.clear(); vi.unstubAllGlobals();
});

it("shows an explicit placeholder and no owner actions for an unselected book", async () => {
  await act(async () => root.render(<SongbookSelectionState onClose={close} signedIn verified hasBooks />));
  const picker = mount.querySelector<HTMLSelectElement>("select")!;
  expect(picker.value).toBe(""); expect(picker.selectedOptions[0].textContent).toBe("Choose a songbook…");
  expect(mount.textContent).toContain("Choose a songbook above to see its songs.");
  expect(Array.from(mount.querySelectorAll("button")).some(button => ["Invite", "Access"].includes(button.textContent ?? ""))).toBe(false);
  expect(document.activeElement).toBe(picker);
  await act(async () => { picker.value = "z-other"; picker.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(model.setActive).toHaveBeenCalledWith("z-other", true, { reopenMySongs: true });
});

it("supports Escape and restores focus to the visible My Songs trigger", async () => {
  await act(async () => root.render(<SongbookSelectionState onClose={close} signedIn verified hasBooks />));
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.render(null)); expect(document.activeElement).toBe(trigger);
});

it("offers sign-in instead of a book choice before an authenticated session", async () => {
  model.snapshot = { ...model.snapshot!, status: "signed-out", claims: null, verifiedAccount: null, memberships: [] };
  await act(async () => root.render(<SongbookSelectionState onClose={close} signedIn={false} verified={false} hasBooks={false} />));
  expect(mount.querySelector("select")).toBeNull(); expect(mount.textContent).toContain("Sign in to see your songbooks.");
  const signIn = mount.querySelector<HTMLButtonElement>('[aria-label="Sign in to Charts"]')!;
  expect(document.activeElement).toBe(signIn);
  await act(async () => signIn.click()); expect(model.signIn).toHaveBeenCalledOnce();
});

it("distinguishes identically named owned and shared books by their verified roles", async () => {
  model.snapshot = { ...model.snapshot!, activeSongbookId: "shared", memberships: [
    { songbookId: "owned", name: "My Songs", role: "owner" },
    { songbookId: "shared", name: "My Songs", role: "editor" },
  ] };
  await act(async () => root.render(<SongbookSwitcher onSwitched={() => {}} />));
  const picker = mount.querySelector<HTMLSelectElement>("select")!;
  expect(picker.value).toBe("shared");
  expect(Array.from(picker.options).slice(1).map(option => option.textContent)).toEqual(["My Songs — Owner", "My Songs — Editor"]);
});

it("keeps keyboard focus inside the picker dialog", async () => {
  await act(async () => root.render(<SongbookSelectionState onClose={close} signedIn verified hasBooks />));
  const dialog = mount.querySelector('[role="dialog"]')!;
  const controls = dialog.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled)");
  const first = controls[0], last = controls[controls.length - 1]; last.focus();
  await act(async () => last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(first);
});
