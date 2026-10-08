import { test, expect, Page } from "@playwright/test";

const CHORDS = "     |Am | |G/B";
const score = {
  id: "chord-entry-test", title: "Sleepwalking entry test", composer: "", tempo: 120,
  timeSignature: "4/4", keySignature: "C", measures: 4, anacrusis: false,
  staves: [], chordSymbols: [], rehearsalMarks: [], repeats: [], measureChanges: [],
  sections: [
    { id: "chorus", label: "Chorus", lines: [
      { chords: CHORDS, lyrics: "I'm sleepwalking" },
      { chords: "", lyrics: "When I'm awake" },
    ] },
    { id: "verse", label: "Verse", lines: [{ chords: "| D", lyrics: "Next section" }] },
  ], form: [], metadata: {}, annotations: [],
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(score => localStorage.setItem("notation-app-store", JSON.stringify({
    state: { score, history: [score], historyIndex: 0, stepEntryHistory: [null],
      uiState: { performMode: false, sidebarOpen: false, aiDrawerOpen: false, propsDrawerOpen: false } },
    version: 14,
  })), score);
  await page.reload();
  await expect(page.locator('[data-bar-line="chorus-0"]')).toBeVisible();
});

async function chords(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("notation-app-store")!).state.score.sections[0].lines[0].chords);
}

async function clickColumn(page: Page, col: number, lyric = false) {
  await page.evaluate(() => document.fonts.ready);
  const row = page.locator('[data-bar-line="chorus-0"]');
  const span = row.locator(lyric ? 'div.text-gray-100 > span' : 'div.text-yellow-300 > span');
  const point = await span.evaluate((el, col) => {
    const rect = el.getBoundingClientRect();
    return { x: (col + 0.5) * rect.width / el.textContent!.length, y: rect.height / 2 };
  }, col);
  await span.click({ position: point });
}

test("selects and removes a bar using only keyboard navigation, with Undo", async ({ page }) => {
  const row = page.locator('[data-bar-line="chorus-0"]');
  await row.focus();
  await page.keyboard.press("Enter");
  const input = page.getByRole("textbox", { name: "Chord", exact: true });
  await expect(input).toHaveValue("|");
  await page.keyboard.press("Control+ArrowRight");
  await expect(input).toHaveValue("Am");
  await page.keyboard.press("Control+ArrowRight");
  await expect(input).toHaveValue("|");
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  await page.keyboard.press("Backspace");
  await expect.poll(() => chords(page)).toBe("     |Am   |G/B");
  await page.keyboard.press("Control+z");
  await expect.poll(() => chords(page)).toBe(CHORDS);
});

test("visiting adjacent bars and chords never relocates them", async ({ page }) => {
  await clickColumn(page, 5);
  await expect(page.getByRole("textbox", { name: "Chord", exact: true })).toHaveValue("|");
  await clickColumn(page, 6);
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Enter");
  await expect.poll(() => chords(page)).toBe(CHORDS);
});

test("empty drafts preserve bars on navigation and can explicitly delete with Enter", async ({ page }) => {
  const row = page.locator('[data-bar-line="chorus-0"]');
  await row.focus();
  await page.keyboard.press("Enter");
  const input = page.getByRole("textbox", { name: "Chord", exact: true });
  await input.fill("");
  await page.keyboard.press("Control+ArrowRight");
  await expect(input).toHaveValue("Am");
  await expect.poll(() => chords(page)).toBe(CHORDS);
  await page.keyboard.press("Control+ArrowLeft");
  await input.fill("");
  await page.keyboard.press("Enter");
  await expect.poll(() => chords(page)).toBe("      Am | |G/B");
  await expect(row).toBeFocused();
});

test("navigates blank lines and section boundaries without a mouse", async ({ page }) => {
  await page.locator('[data-bar-line="chorus-0"]').focus();
  await page.keyboard.press("Enter");
  const input = page.getByRole("textbox", { name: "Chord", exact: true });
  await page.keyboard.press("ArrowDown");
  await expect(input).toHaveValue("");
  await page.keyboard.press("Control+ArrowRight");
  await expect(input).toHaveValue("|");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-bar-line="verse-0"]')).toBeFocused();
  await expect.poll(() => chords(page)).toBe(CHORDS);
});

test("print wraps long lyric/chord pairs inside their own column", async ({ page }, testInfo) => {
  const lyrics = "I feel myself moving, and it just feels so wrong and this line needs to wrap within its print column";
  await page.evaluate(lyrics => {
    const stored = JSON.parse(localStorage.getItem("notation-app-store")!);
    stored.state.score.sections[0].lines[1] = { lyrics, chords: " ".repeat(41) + "F#m7" };
    localStorage.setItem("notation-app-store", JSON.stringify(stored));
  }, lyrics);
  await page.reload();
  await expect(page.locator('[data-bar-line="chorus-1"]')).toContainText(lyrics);
  await page.setViewportSize({ width: 816, height: 1056 });
  await page.emulateMedia({ media: "print" });
  const layout = await page.locator('[data-bar-line="chorus-1"] .print-chord-line').evaluate(el => {
    const bounds = el.getBoundingClientRect();
    const chars = Array.from(el.querySelectorAll(".print-pair-char"));
    return {
      overflowing: chars.some(c => c.getBoundingClientRect().right > bounds.right + 0.5 || c.getBoundingClientRect().left < bounds.left - 0.5),
      rowCount: new Set(chars.map(c => Math.round(c.getBoundingClientRect().top))).size,
      lyrics: chars.map(c => c.lastElementChild!.textContent).join(""),
      aligned: chars.every(c => Math.abs(c.firstElementChild!.getBoundingClientRect().left - c.lastElementChild!.getBoundingClientRect().left) < 0.5),
    };
  });
  expect(layout.overflowing).toBe(false);
  expect(layout.rowCount).toBeGreaterThan(1);
  expect(layout.lyrics).toBe(lyrics);
  expect(layout.aligned).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("print-columns.png"), fullPage: true });
});
