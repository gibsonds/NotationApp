import { test, expect, Page } from "@playwright/test";

// ── Test: reproduce in-page preset cycling bug ──────────────────────────
// The original style-presets.spec.ts uses page.reload() between presets,
// which short-circuits the bug. Real users click preset buttons without
// reloading — that's the code path that renders at the PREVIOUS preset's
// noteSize. This file exercises that path.

const TEST_SCORE = {
  id: "style-test-in-page",
  title: "Style Test",
  composer: "Test",
  tempo: 120,
  timeSignature: "4/4",
  keySignature: "C",
  measures: 4,
  staves: [
    {
      id: "staff-treble",
      name: "Treble",
      clef: "treble",
      lyricsMode: "attached",
      voices: [{
        id: "voice-1",
        role: "general",
        notes: [
          { pitch: "C4", duration: "quarter", dots: 0, accidental: "none", tieStart: false, tieEnd: false, measure: 1, beat: 1 },
          { pitch: "D4", duration: "quarter", dots: 0, accidental: "none", tieStart: false, tieEnd: false, measure: 1, beat: 2 },
          { pitch: "E4", duration: "quarter", dots: 0, accidental: "none", tieStart: false, tieEnd: false, measure: 1, beat: 3 },
          { pitch: "F4", duration: "quarter", dots: 0, accidental: "none", tieStart: false, tieEnd: false, measure: 1, beat: 4 },
        ],
      }],
    },
  ],
  chordSymbols: [],
  rehearsalMarks: [],
  repeats: [],
  metadata: {},
};

const DEFAULT_LAYOUT = {
  titleSize: 2.4, composerSize: 1.4, titleTopDistance: 5, titleBottomDistance: 1,
  pageTopMargin: 5, pageLeftMargin: 5, pageRightMargin: 5, systemSpacing: 5,
  compactMode: false, measuresPerSystem: 0, pageBreaks: false, pageSize: "letter",
  noteSize: 1.0, musicFont: "bravura", textFont: "georgia",
  printPageNumbers: true, printHeader: "", printFooter: "",
};

const PRESETS = {
  modern: DEFAULT_LAYOUT,
  realbook: {
    titleSize: 3.2, composerSize: 1.0, titleTopDistance: 3, titleBottomDistance: 0.5,
    pageTopMargin: 3, pageLeftMargin: 4, pageRightMargin: 4, systemSpacing: 3,
    compactMode: true, measuresPerSystem: 4, pageBreaks: false, pageSize: "letter",
    noteSize: 1.0, musicFont: "petaluma", textFont: "handwritten",
    printPageNumbers: false, printHeader: "", printFooter: "",
  },
  print: {
    titleSize: 2, composerSize: 1.2, titleTopDistance: 2, titleBottomDistance: 1,
    pageTopMargin: 2, pageLeftMargin: 3, pageRightMargin: 3, systemSpacing: 3,
    compactMode: true, measuresPerSystem: 4, pageBreaks: true, pageSize: "letter",
    noteSize: 0.65, musicFont: "bravura", textFont: "palatino",
    printPageNumbers: true, printHeader: "", printFooter: "",
  },
};

async function seedAndLoad(page: Page) {
  await page.goto("/");
  await page.evaluate((data) => {
    localStorage.setItem("notation-app-store", JSON.stringify({
      state: {
        score: data.score,
        history: [data.score],
        historyIndex: 0,
        messages: [],
        warnings: [],
        isGenerating: false,
        selection: null,
        lastOperation: null,
        savedRevisions: [],
        layout: data.layout,
        uiState: { sidebarOpen: true, aiDrawerOpen: false, propsDrawerOpen: true },
        stepEntry: null,
        projectId: null,
      },
      version: 10,
    }));
  }, { score: TEST_SCORE, layout: DEFAULT_LAYOUT });
  await page.reload();
  await page.waitForSelector(".score-container", { timeout: 10000 });
  await page.waitForFunction(() => (window as any).__noteHits?.length > 0, { timeout: 15000 });
  await page.waitForTimeout(300);
}

/** Apply preset via the live Zustand store setLayout (no reload) — mimics clicking preset button. */
async function applyPresetInPage(page: Page, preset: "modern" | "realbook" | "print") {
  await page.evaluate((layout) => {
    // Access the Zustand store exposed on window, if any; fallback: click preset button
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === (layout as any).__label
    );
    if (btn) { (btn as HTMLButtonElement).click(); return; }
  }, { ...PRESETS[preset], __label: { modern: "Modern", realbook: "Real Book", print: "Print" }[preset] });

  // Wait for the store + component to settle. Since the ScoreRenderer has a
  // key prop on musicFont-noteSize-textFont, preset changes cause a full
  // remount + fresh OSMD — we wait for __noteHits to repopulate.
  await page.waitForTimeout(200);
  await page.waitForFunction(
    (expected) => {
      const fs = (window as any).__osmdFontScale;
      return typeof fs === "number" && Math.abs(fs - expected) < 0.1;
    },
    39 * PRESETS[preset].noteSize,
    { timeout: 8000 },
  );
  // Wait a bit longer to ensure VexFlow has fully rendered the SVG
  await page.waitForTimeout(400);
}

/** Measure the height of the first notehead in the SVG. */
async function getNoteheadHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const heads = document.querySelectorAll(".score-container svg .vf-notehead");
    if (heads.length === 0) return 0;
    const r = (heads[0] as SVGGElement).getBoundingClientRect();
    return r.height;
  });
}

test.describe("In-page preset cycling (no reload)", () => {
  test.beforeEach(async ({ page }) => {
    await seedAndLoad(page);
  });

  test("Modern → Print: notehead shrinks to ~65%", async ({ page }) => {
    const modernH = await getNoteheadHeight(page);
    expect(modernH).toBeGreaterThan(0);
    await page.screenshot({ path: "e2e/screenshots/in-page-1-modern.png" });

    await applyPresetInPage(page, "print");
    const printH = await getNoteheadHeight(page);
    await page.screenshot({ path: "e2e/screenshots/in-page-2-print.png" });

    const ratio = printH / modernH;
    console.log(`[test] modernH=${modernH.toFixed(1)} printH=${printH.toFixed(1)} ratio=${ratio.toFixed(3)}`);
    // Expected ratio ~0.65. Allow 0.55–0.80 to be lenient for page-layout differences.
    expect(ratio).toBeLessThan(0.80);
    expect(ratio).toBeGreaterThan(0.55);
  });

  test("Modern → Print → Real Book: real book grows back to ~modern size", async ({ page }) => {
    const modernH = await getNoteheadHeight(page);
    expect(modernH).toBeGreaterThan(0);

    await applyPresetInPage(page, "print");
    const printH = await getNoteheadHeight(page);

    await applyPresetInPage(page, "realbook");
    const rbH = await getNoteheadHeight(page);
    await page.screenshot({ path: "e2e/screenshots/in-page-3-realbook.png" });

    const rbRatio = rbH / modernH;
    console.log(`[test] modernH=${modernH.toFixed(1)} printH=${printH.toFixed(1)} rbH=${rbH.toFixed(1)} rbRatio=${rbRatio.toFixed(3)}`);
    // Real Book has noteSize 1.0 (same as Modern). Should NOT look like Print.
    expect(rbH).toBeGreaterThan(printH * 1.2);
    expect(rbRatio).toBeGreaterThan(0.80); // within ~20% of modern
  });
});
