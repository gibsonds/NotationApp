import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ChordChartView from "../ChordChartView";
import { DEFAULT_UI_STATE, useScoreStore } from "@/store/score-store";
import type { Score } from "@/lib/schema";

const original = "|G G#11 | G6 G | D | D      |G G#11 |G6 G | D | D";
const score: Score = {
  id: "twig-test", title: "Twig", composer: "", tempo: 120, timeSignature: "4/4",
  keySignature: "D", measures: 1, anacrusis: false, staves: [], chordSymbols: [],
  rehearsalMarks: [], repeats: [], measureChanges: [], form: [], metadata: {}, annotations: [],
  sections: [{ id: "bridge", label: "Bridge", lines: [
    { chords: original, lyrics: "" }, { chords: "|Em | G |", lyrics: "" },
  ] }],
};
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useScoreStore.setState({ score: structuredClone(score), history: [structuredClone(score)],
    historyIndex: 0, uiState: { ...DEFAULT_UI_STATE } });
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ChordChartView score={score} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function button(name: string) {
  const found = [...container.querySelectorAll("button")].find(b => (b.getAttribute("aria-label") || b.textContent) === name);
  expect(found).toBeDefined(); return found!;
}
async function click(el: Element) { await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true }))); }

it("opens a selectable whole chord line without right clicking and cancels without mutation", async () => {
  await click(button("Edit chords: Bridge, line 1"));
  const field = container.querySelector("textarea")!;
  expect(field.value).toBe(original);
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(original.length);
  await click(button("Cancel"));
  expect(container.querySelector("textarea")).toBeNull();
  expect(useScoreStore.getState().score?.sections).toEqual(score.sections);
});
it("offers line actions by a visible button and keyboard", async () => {
  await click(button("Line actions: Bridge, line 1"));
  expect(button("Edit chord line (text)")).toBeDefined();
  await click(button("Edit chord line (text)"));
  await click(button("Cancel"));
  const row = container.querySelector('[data-bar-line="bridge-0"]')!;
  const event = new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true });
  await act(async () => row.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(button("Edit chord line (text)")).toBeDefined();
});
it("captures right click on the row gutter instead of Chrome's menu", async () => {
  const row = container.querySelector('[data-bar-line="bridge-0"]')!;
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  await act(async () => row.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(button("Edit chord line (text)")).toBeDefined();
});
it("does not show edit controls in perform mode", async () => {
  await act(async () => root.render(<ChordChartView score={score} performMode />));
  expect(container.querySelector('[aria-label="Edit chords: Bridge, line 1"]')).toBeNull();
  expect(container.querySelector('[aria-label="Line actions: Bridge, line 1"]')).toBeNull();
});
it("saves replacement of the duplicate only and supports undo", async () => {
  await click(button("Edit chords: Bridge, line 1"));
  const field = container.querySelector("textarea")!;
  const cleaned = "|G G#11 | G6 G | D | D";
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, cleaned);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button("Done"));
  expect(useScoreStore.getState().score!.sections[0].lines[0].chords.trim()).toBe(cleaned);
  expect(useScoreStore.getState().score!.sections[0].lines[1]).toEqual(score.sections[0].lines[1]);
  await act(async () => useScoreStore.getState().undo());
  expect(useScoreStore.getState().score!.sections).toEqual(score.sections);
});
