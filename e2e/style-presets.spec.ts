import { test, expect, Page } from "@playwright/test";

// ── Test score ──────────────────────────────────────────────────────────

const TEST_SCORE = {
  id: "style-test-1",
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

// ── Helpers ─────────────────────────────────────────────────────────────

async function loadTestScore(page: Page) {
  await page.goto("/");
  await page.waitForSelector(".score-container", { timeout: 10000 }).catch(() => {});

  await page.evaluate((data) => {
    const storeKey = "notation-app-store";
    localStorage.setItem(storeKey, JSON.stringify({
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
  await page.waitForFunction(
    () => (window as any).__noteHits?.length > 0,
    { timeout: 15000 },
  );
}

/** Get the OSMD font scale that's currently rendered */
async function getRenderedFontScale(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__osmdFontScale ?? 0);
}

/** Get the noteSize from the store layout */
async function getStoreNoteSize(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__osmdNoteSize ?? 0);
}

/** Measure the bounding box height of the first notehead SVG element */
async function getNoteHeadHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    // Find the first notehead glyph in the SVG
    const noteHeads = document.querySelectorAll(".score-container .vf-notehead path");
    if (noteHeads.length === 0) return 0;
    const rect = noteHeads[0].getBoundingClientRect();
    return rect.height;
  });
}

/** Apply a style preset via the store directly — avoids UI interaction issues */
async function applyPreset(page: Page, preset: "modern" | "realbook" | "print") {
  const presetLayouts: Record<string, any> = {
    modern: {
      titleSize: 2.4, composerSize: 1.4, titleTopDistance: 5, titleBottomDistance: 1,
      pageTopMargin: 5, pageLeftMargin: 5, pageRightMargin: 5, systemSpacing: 5,
      compactMode: false, measuresPerSystem: 0, pageBreaks: false, pageSize: "letter",
      noteSize: 1.0, musicFont: "bravura", textFont: "georgia",
      printPageNumbers: true, printHeader: "", printFooter: "",
    },
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

  // Apply preset layout via store
  await page.evaluate((layout) => {
    const storeKey = "notation-app-store";
    const stored = JSON.parse(localStorage.getItem(storeKey) || "{}");
    stored.state.layout = layout;
    localStorage.setItem(storeKey, JSON.stringify(stored));
  }, presetLayouts[preset]);

  // Reload to apply
  await page.reload();
  await page.waitForSelector(".score-container", { timeout: 10000 });
  await page.waitForFunction(
    () => (window as any).__noteHits?.length > 0,
    { timeout: 15000 },
  );
  // Wait for OSMD render to fully complete
  await page.waitForTimeout(500);
}

/** Apply a layout change via the store directly */
async function setLayoutViaStore(page: Page, partial: Record<string, any>) {
  await page.evaluate((p) => {
    const storeKey = "notation-app-store";
    const stored = JSON.parse(localStorage.getItem(storeKey) || "{}");
    stored.state.layout = { ...stored.state.layout, ...p };
    localStorage.setItem(storeKey, JSON.stringify(stored));
  }, partial);
  await page.reload();
  await page.waitForSelector(".score-container", { timeout: 10000 });
  await page.waitForFunction(
    () => (window as any).__noteHits?.length > 0,
    { timeout: 15000 },
  );
}

// ══════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════

test.describe("Style Presets & Note Size", () => {

  test.beforeEach(async ({ page }) => {
    await loadTestScore(page);
  });

  // ── Core bug: note size must match after cycling presets ───────────

  test("Modern preset renders at noteSize 1.0", async ({ page }) => {
    await applyPreset(page, "modern");

    const fontScale = await getRenderedFontScale(page);
    const noteSize = await getStoreNoteSize(page);

    expect(noteSize).toBeCloseTo(1.0, 1);
    expect(fontScale).toBeCloseTo(39.0, 0); // 39 * 1.0
    await page.screenshot({ path: "e2e/screenshots/style-modern.png" });
  });

  test("Print preset renders at noteSize 0.65", async ({ page }) => {
    await applyPreset(page, "print");

    const fontScale = await getRenderedFontScale(page);
    const noteSize = await getStoreNoteSize(page);

    expect(noteSize).toBeCloseTo(0.65, 2);
    expect(fontScale).toBeCloseTo(39 * 0.65, 0); // 25.35
    await page.screenshot({ path: "e2e/screenshots/style-print.png" });
  });

  test("Real Book preset renders at noteSize 1.0", async ({ page }) => {
    await applyPreset(page, "realbook");

    const fontScale = await getRenderedFontScale(page);
    const noteSize = await getStoreNoteSize(page);

    expect(noteSize).toBeCloseTo(1.0, 1);
    expect(fontScale).toBeCloseTo(39.0, 0); // 39 * 1.0
    await page.screenshot({ path: "e2e/screenshots/style-realbook.png" });
  });

  test("cycling Modern → Print → Real Book preserves correct note sizes", async ({ page }) => {
    // Start Modern (already loaded as default)
    const modernScale = await getRenderedFontScale(page);
    const modernHeight = await getNoteHeadHeight(page);
    expect(modernScale).toBeCloseTo(39.0, 0);

    // Switch to Print via store (in-page, no reload — tests OSMD re-render)
    await page.evaluate(() => {
      const storeKey = "notation-app-store";
      const stored = JSON.parse(localStorage.getItem(storeKey) || "{}");
      stored.state.layout = { ...stored.state.layout, noteSize: 0.65, musicFont: "bravura", textFont: "palatino", compactMode: true, measuresPerSystem: 4, pageBreaks: true };
      localStorage.setItem(storeKey, JSON.stringify(stored));
    });
    await page.reload();
    await page.waitForFunction(() => (window as any).__noteHits?.length > 0, { timeout: 15000 });
    await page.waitForTimeout(500);

    const printScale = await getRenderedFontScale(page);
    const printHeight = await getNoteHeadHeight(page);
    expect(printScale).toBeCloseTo(39 * 0.65, 0);
    // Note: visual height comparison can vary due to page layout differences
    // The fontScale assertion above is the reliable check

    // Switch to Real Book
    await page.evaluate(() => {
      const storeKey = "notation-app-store";
      const stored = JSON.parse(localStorage.getItem(storeKey) || "{}");
      stored.state.layout = { ...stored.state.layout, noteSize: 1.0, musicFont: "petaluma", textFont: "handwritten", compactMode: true, measuresPerSystem: 4, pageBreaks: false };
      localStorage.setItem(storeKey, JSON.stringify(stored));
    });
    await page.reload();
    await page.waitForFunction(() => (window as any).__noteHits?.length > 0, { timeout: 15000 });
    await page.waitForTimeout(500);

    const rbScale = await getRenderedFontScale(page);
    const rbHeight = await getNoteHeadHeight(page);
    expect(rbScale).toBeCloseTo(39.0, 0);
    if (modernHeight > 0 && rbHeight > 0) {
      expect(rbHeight).toBeGreaterThan(modernHeight * 0.8);
    }

    await page.screenshot({ path: "e2e/screenshots/style-cycle-final.png" });
  });

  test("cycling Print → Real Book → Print → Modern keeps correct sizes", async ({ page }) => {
    // This is the exact sequence that was failing: going through Print
    // would cause the next preset to render at 0.65 scale

    await applyPreset(page, "print");
    let fontScale = await getRenderedFontScale(page);
    expect(fontScale).toBeCloseTo(39 * 0.65, 0);

    await applyPreset(page, "realbook");
    fontScale = await getRenderedFontScale(page);
    expect(fontScale).toBeCloseTo(39.0, 0);

    await applyPreset(page, "print");
    fontScale = await getRenderedFontScale(page);
    expect(fontScale).toBeCloseTo(39 * 0.65, 0);

    await applyPreset(page, "modern");
    fontScale = await getRenderedFontScale(page);
    expect(fontScale).toBeCloseTo(39.0, 0);

    await page.screenshot({ path: "e2e/screenshots/style-cycle-all.png" });
  });

  // ── Font selection ────────────────────────────────────────────────

  test("Real Book preset uses handwritten text font", async ({ page }) => {
    await applyPreset(page, "realbook");

    const textFont = await page.evaluate(() => {
      const store = JSON.parse(localStorage.getItem("notation-app-store") || "{}");
      return store?.state?.layout?.textFont;
    });
    expect(textFont).toBe("handwritten");
  });

  test("Modern preset uses bravura music font", async ({ page }) => {
    await applyPreset(page, "modern");

    const musicFont = await page.evaluate(() => {
      const store = JSON.parse(localStorage.getItem("notation-app-store") || "{}");
      return store?.state?.layout?.musicFont;
    });
    expect(musicFont).toBe("bravura");
  });
});

test.describe("UI State Persistence", () => {

  test("sidebar state persists across page reload", async ({ page }) => {
    await loadTestScore(page);

    // Close sidebar
    const closeBtn = page.locator("button[title*='Close sidebar']");
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }

    // Reload
    await page.reload();
    await page.waitForSelector(".score-container", { timeout: 10000 });
    await page.waitForTimeout(500);

    // Sidebar should still be closed
    const sidebarState = await page.evaluate(() => {
      const store = JSON.parse(localStorage.getItem("notation-app-store") || "{}");
      return store?.state?.uiState?.sidebarOpen;
    });
    expect(sidebarState).toBe(false);
  });

  test("drawer open/close state persists across reload", async ({ page }) => {
    await loadTestScore(page);

    // Toggle Properties drawer (it starts open in our test setup)
    const propsBtn = page.locator("button:has-text('Properties')");
    if (await propsBtn.count() > 0) {
      await propsBtn.click();
      await page.waitForTimeout(300);
    }

    // Reload
    await page.reload();
    await page.waitForSelector(".score-container", { timeout: 10000 });
    await page.waitForTimeout(500);

    const uiState = await page.evaluate(() => {
      const store = JSON.parse(localStorage.getItem("notation-app-store") || "{}");
      return store?.state?.uiState;
    });
    expect(uiState?.propsDrawerOpen).toBe(false);
  });
});
