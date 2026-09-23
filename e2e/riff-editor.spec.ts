import { test, expect, Page } from "@playwright/test";

// The authoring loop: long-press a line → "Add riff here…" → type tab → save →
// chip appears → tap it → Edit → the same tab comes back.
//
// That last part is the one worth pinning: `riffToAsciiTab` has to be a real
// inverse of `parseAsciiTab`, or reopening a riff would quietly show something
// other than what was typed.

const CHART = {
  id: "editor-demo",
  title: "Editor demo",
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
      id: "v",
      label: "Verse",
      lines: [
        { chords: "| Am | F |", lyrics: "way back then when we were young" },
        { chords: "| C | G |", lyrics: "i felt the foggy night" },
      ],
    },
  ],
  form: [],
  metadata: {},
  annotations: [],
};

const TAB = [
  "e|--------|--------|",
  "B|--------|--------|",
  "G|--------|--------|",
  "D|--------|--------|",
  "A|--2--5--|--------|",
  "E|--0-----|--3-----|",
].join("\n");

async function seed(page: Page) {
  await page.goto("/");
  await page.evaluate((score) => {
    localStorage.setItem(
      "notation-app-store",
      JSON.stringify({
        state: {
          score,
          history: [score],
          historyIndex: 0,
          stepEntryHistory: [null],
          messages: [],
          warnings: [],
          isGenerating: false,
          selection: null,
          lastOperation: null,
          savedRevisions: [],
          stepEntry: null,
          projectId: null,
          clipboard: null,
          uiState: {
            sidebarOpen: false,
            aiDrawerOpen: false,
            propsDrawerOpen: false,
            performMode: false,
            annotationMode: false,
            currentSongId: null,
            collapsedFolders: [],
            performFolder: null,
            activeSetId: null,
            openRiffId: null,
            riffEditor: null,
            annotationFilters: {
              showShared: true,
              showPersonal: true,
              hiddenLabels: [],
              hideInPerformance: false,
            },
          },
        },
        version: 14,
      }),
    );
  }, CHART);
  await page.reload();
  await page.waitForTimeout(1200);
}

const riffsIn = (page: Page) =>
  page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("notation-app-store")!).state.score;
    return (s.riffs ?? []).map(
      (r: {
        label: string;
        anchor: { sectionId: string | null; lineIdx: number };
        bars: { events: { notes: { string: number; fret: number }[] }[] }[];
      }) => ({
        label: r.label,
        anchor: r.anchor,
        frets: r.bars.flatMap((b) =>
          b.events.flatMap((e) => e.notes.map((n) => `${n.string}:${n.fret}`)),
        ),
      }),
    );
  });

/** Open the editor from the line context menu, on the second line. */
async function openEditorFromMenu(page: Page) {
  await page.locator("text=i felt the foggy night").first().click({ button: "right" });
  await page.locator("text=Add riff here").first().click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
}

test.describe("riff editor", () => {
  test("adds a riff anchored to the line the menu was opened on", async ({ page }) => {
    await seed(page);
    expect(await riffsIn(page)).toHaveLength(0);

    await openEditorFromMenu(page);
    await page.locator('input[aria-label="Riff name"]').fill("Signature lick");
    await page.locator('textarea[aria-label="ASCII tab"]').fill(TAB);
    await page.locator('button:has-text("Add riff")').last().click();

    const riffs = await riffsIn(page);
    expect(riffs).toHaveLength(1);
    expect(riffs[0].label).toBe("Signature lick");
    // The menu was opened on line index 1, so that's where it hangs.
    expect(riffs[0].anchor).toEqual({ sectionId: "v", lineIdx: 1 });
    expect(riffs[0].frets).toEqual(["5:2", "6:0", "5:5", "6:3"]);

    await expect(
      page.locator('button[aria-label="Show tab for Signature lick"]'),
      "chip appears on the anchored line",
    ).toBeVisible();
  });

  test("Save stays disabled until the tab actually has frets", async ({ page }) => {
    await seed(page);
    await openEditorFromMenu(page);
    // Opens on a blank six-string grid — nothing to save yet.
    const save = page.locator('button:has-text("Add riff")').last();
    await expect(save).toBeDisabled();

    await page.locator('textarea[aria-label="ASCII tab"]').fill("e|--3--|");
    await expect(save).toBeEnabled();
  });

  test("reopening a riff round-trips the tab back into the editor", async ({ page }) => {
    await seed(page);
    await openEditorFromMenu(page);
    await page.locator('input[aria-label="Riff name"]').fill("Signature lick");
    await page.locator('textarea[aria-label="ASCII tab"]').fill(TAB);
    await page.locator('button:has-text("Add riff")').last().click();

    await page.locator('button[aria-label="Show tab for Signature lick"]').first().click();
    await page.locator('button[aria-label="Edit Signature lick"]').click();

    const text = await page.locator('textarea[aria-label="ASCII tab"]').inputValue();
    // Same six strings, and the same frets in the same order. Spacing is
    // re-derived from beats rather than preserved verbatim, so compare content.
    expect(text.split("\n")).toHaveLength(6);
    expect(text.replace(/[^0-9]/g, "")).toBe("2503");

    await page.locator('input[aria-label="Riff name"]').fill("Solo lick");
    await page.locator('button:has-text("Save")').last().click();

    const riffs = await riffsIn(page);
    expect(riffs).toHaveLength(1);
    expect(riffs[0].label).toBe("Solo lick");
    expect(riffs[0].frets, "editing the name leaves the notes alone").toEqual([
      "5:2", "6:0", "5:5", "6:3",
    ]);
  });

  test("Esc closes without saving", async ({ page }) => {
    await seed(page);
    await openEditorFromMenu(page);
    await page.locator('textarea[aria-label="ASCII tab"]').fill("e|--7--|");
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toBeHidden();
    expect(await riffsIn(page)).toHaveLength(0);
  });

  test("Delete removes the riff", async ({ page }) => {
    await seed(page);
    await openEditorFromMenu(page);
    await page.locator('input[aria-label="Riff name"]').fill("Doomed");
    await page.locator('textarea[aria-label="ASCII tab"]').fill("e|--3--|");
    await page.locator('button:has-text("Add riff")').last().click();
    expect(await riffsIn(page)).toHaveLength(1);

    page.once("dialog", (d) => d.accept());
    await page.locator('button[aria-label="Show tab for Doomed"]').first().click();
    await page.locator('button[aria-label="Edit Doomed"]').click();
    await page.locator('button:has-text("Delete")').click();

    expect(await riffsIn(page)).toHaveLength(0);
    await expect(page.locator('button[aria-label="Show tab for Doomed"]')).toHaveCount(0);
  });
});
