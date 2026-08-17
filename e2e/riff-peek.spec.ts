import { test, expect, Page } from "@playwright/test";

// The riff peek card exists to answer "how does that riff go again?" WITHOUT
// losing your place. Its whole design rests on one property: opening it must
// not move the chart. The card is position:fixed precisely so it cannot be
// clipped by a scroll container and contributes nothing to scrollHeight — and
// that is what these tests pin. If someone later makes it inline or absolute,
// this is the spec that fails.

const RIFF = {
  id: "riff-1",
  label: "Intro riff",
  kind: "tab" as const,
  tuning: ["E4", "B3", "G3", "D3", "A2", "E2"],
  anchor: { sectionId: "v", lineIdx: 1 },
  bars: [
    {
      events: [
        { beat: 1, duration: "eighth", dots: 0, notes: [{ string: 6, fret: 0 }] },
        { beat: 2, duration: "eighth", dots: 0, notes: [{ string: 6, fret: 3 }] },
        { beat: 3, duration: "quarter", dots: 0, notes: [{ string: 5, fret: 2 }] },
      ],
    },
    {
      events: [
        { beat: 1, duration: "half", dots: 0, notes: [{ string: 6, fret: 12 }] },
        { beat: 3, duration: "quarter", dots: 0, notes: [] },
      ],
    },
  ],
  visibility: "shared" as const,
  source: "ascii" as const,
  createdAt: 1,
};

// Long enough that the 1-column view genuinely scrolls.
const LINES = Array.from({ length: 24 }, (_, i) => ({
  chords: "| Am | F | C | G |",
  lyrics: `line number ${i} of the long verse for scrolling`,
}));

const CHART = {
  id: "riff-demo",
  title: "Riff demo",
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
  sections: [{ id: "v", label: "Verse", lines: LINES }],
  form: [],
  metadata: {},
  annotations: [],
  riffs: [RIFF],
};

async function seed(page: Page, performMode: boolean, columns: 1 | 2) {
  await page.goto("/");
  await page.evaluate(
    ({ score, performMode, columns }) => {
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
              performMode,
              annotationMode: false,
              currentSongId: null,
              collapsedFolders: [],
              performFolder: null,
              activeSetId: null,
              openRiffId: null,
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
      localStorage.setItem(
        "notation-app-perform-prefs",
        JSON.stringify({
          fontSize: 1.4,
          lineHeight: 1.4,
          letterSpacing: 0.02,
          columns,
          scrollSpeed: 30,
        }),
      );
    },
    { score: CHART, performMode, columns },
  );
  await page.reload();
  await page.waitForTimeout(1200);
}

/**
 * The chip the user taps.
 *
 * Scoping matters. The editor's ChordChartView stays mounted UNDERNEATH the
 * perform overlay and renders its own chips, and 2-column perform renders every
 * block a second time in a hidden opacity-0 measurement column (which Playwright
 * still counts as visible). Both would otherwise be matched first.
 */
function chip(page: Page, performMode: boolean, columns: 1 | 2) {
  const root = !performMode
    ? page
    : columns === 2
      ? page.locator("div.snap-x")
      : page.locator("div.fixed.inset-0.z-50");
  return root.locator('button[aria-label="Show tab for Intro riff"]').first();
}

const PERFORM_SCROLLER = ".absolute.inset-0.overflow-auto";

test.describe("riff peek card", () => {
  for (const [label, performMode, columns] of [
    ["edit mode", false, 1],
    ["perform, 1 column", true, 1],
    ["perform, 2 columns", true, 2],
  ] as const) {
    test(`${label}: chip opens the card and the chart does not move`, async ({ page }) => {
      await seed(page, performMode, columns);

      const c = chip(page, performMode, columns);
      await expect(c, "riff chip renders inline").toBeVisible();

      const measure = () =>
        page.evaluate(
          (sel) => ({
            scrollTop: sel ? (document.querySelector(sel)?.scrollTop ?? 0) : window.scrollY,
            docHeight: document.body.scrollHeight,
          }),
          performMode && columns === 1 ? PERFORM_SCROLLER : null,
        );

      const before = await measure();
      await c.click();

      const card = page.locator('[role="dialog"]');
      await expect(card, "peek card opens").toBeVisible();
      await expect(page.locator("svg.riff-svg"), "exactly one tab staff renders").toHaveCount(1);

      const after = await measure();
      expect(after.scrollTop, "opening the card must not scroll the chart").toBe(before.scrollTop);
      expect(after.docHeight, "opening the card must not reflow the chart").toBe(before.docHeight);
    });
  }

  test("Esc closes the card without leaving perform mode", async ({ page }) => {
    // PerformView listens for Escape on the bubble phase to exit perform, so
    // the card's handler has to capture. Without that, the first Esc would
    // throw the user out of the song instead of closing the card.
    await seed(page, true, 1);
    await chip(page, true, 1).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toBeHidden();

    const stillPerforming = await page.evaluate(
      () => JSON.parse(localStorage.getItem("notation-app-store")!).state.uiState.performMode,
    );
    expect(stillPerforming, "first Esc closes the card, not perform mode").toBe(true);
  });

  test("only one card renders in perform mode", async ({ page }) => {
    // page.tsx keeps the editor chart mounted under the perform overlay and
    // PerformView mounts its own host; an ungated second host stacked two cards.
    await seed(page, true, 1);
    await chip(page, true, 1).click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  });
});
