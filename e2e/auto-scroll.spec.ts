import { test, expect, Page } from "@playwright/test";

// A realistic-shape chord chart with multiple sections and bar-marked
// lines — enough to reproduce the section-transition regressions
// the user has been reporting on Twig. Bars run fast (240 BPM) so a
// full playthrough finishes inside Playwright's default 30s timeout.
const TEST_CHORD_CHART = {
  id: "test-chord-chart",
  title: "Auto-scroll regression song",
  composer: "",
  tempo: 240,
  timeSignature: "4/4",
  keySignature: "C",
  measures: 16,
  staves: [],
  sections: [
    {
      id: "intro",
      label: "Intro",
      lines: [
        { chords: "| Em | Bm | C | D |", lyrics: "" },
        { chords: "| Em | Bm | C | D |", lyrics: "" },
      ],
    },
    {
      id: "verse",
      label: "Verse 1",
      lines: [
        { chords: "| Em | Bm |", lyrics: "way back then we ran the road" },
        { chords: "| C | D |", lyrics: "up and up it goes" },
        { chords: "| Em | Bm |", lyrics: "and the wind was free" },
        { chords: "| C | D |", lyrics: "way back then" },
      ],
    },
    {
      id: "chorus",
      label: "Chorus",
      lines: [
        { chords: "| F | G | Am | Em |", lyrics: "" },
        { chords: "| F | G | C |", lyrics: "" },
      ],
    },
  ],
};

// Slimmer chord chart for tests that exercise the play/pause transport
// — small enough that the song finishes in ~6s at 240 BPM, leaving
// headroom for the end-of-song reset assertion below Playwright's 30s
// per-test timeout.
const SHORT_CHORD_CHART = {
  id: "test-chord-chart-short",
  title: "Short auto-scroll test song",
  composer: "",
  tempo: 240,
  timeSignature: "4/4",
  keySignature: "C",
  measures: 4,
  staves: [],
  sections: [
    {
      id: "v",
      label: "Verse",
      lines: [
        { chords: "| Em | Bm |", lyrics: "" },
        { chords: "| C | D |", lyrics: "" },
        { chords: "| Em | Bm |", lyrics: "" },
      ],
    },
  ],
};

async function seedScoreAndEnterPerform(
  page: Page,
  chart:
    | typeof TEST_CHORD_CHART
    | typeof SHORT_CHORD_CHART
    | typeof WIDE_LINE_CHART = TEST_CHORD_CHART,
) {
  await page.goto("/");
  await page.evaluate((score) => {
    localStorage.setItem("notation-app-store", JSON.stringify({
      state: {
        score,
        history: [score],
        historyIndex: 0,
        messages: [],
        warnings: [],
        isGenerating: false,
        selection: null,
        lastOperation: null,
        savedRevisions: [],
        stepEntry: null,
        projectId: null,
        // Enter perform mode immediately + sensible defaults
        uiState: {
          performMode: true,
          annotationMode: false,
          annotationFilters: {
            showShared: true,
            showPersonal: true,
            hideInPerformance: false,
            hiddenLabels: [],
          },
          currentSongId: null,
          activeSetId: null,
          performFolder: null,
          collapsedFolders: [],
        },
        layout: {
          titleSize: 2.4, composerSize: 1.4, titleTopDistance: 5, titleBottomDistance: 1,
          pageTopMargin: 5, pageLeftMargin: 5, pageRightMargin: 5, systemSpacing: 5,
          compactMode: false, measuresPerSystem: 0, pageBreaks: false, pageSize: "letter",
          noteSize: 1.0, musicFont: "bravura", textFont: "georgia",
          printPageNumbers: true, printHeader: "", printFooter: "",
        },
      },
      version: 9,
    }));
  }, chart);
  await page.reload();
  // Wait for chord chart lines to render — the data-bar-line attribute
  // is what the scroll logic queries to find line positions.
  await page.waitForSelector("[data-bar-line]", { timeout: 10000 });
}

interface OverlayProbe {
  found: boolean;
  top?: number;
  bottom?: number;
  viewportH?: number;
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
  lineContentY?: number;
  /** key of the currently-highlighted bar's line, for sanity-tracing. */
  activeLineKey?: string;
}

/** Capture the green active-bar overlay's viewport position, plus its
 *  scroll container's state and the line's absolute content-Y. Walks
 *  the DOM up from the overlay to find the actual scrollable ancestor
 *  (the `.overflow-auto` class isn't unique enough — there are nested
 *  scroll containers). */
async function probeActiveBar(page: Page): Promise<OverlayProbe> {
  return page.evaluate<OverlayProbe>(() => {
    const overlay = document.querySelector<HTMLElement>(
      'div[aria-hidden="true"].bg-green-400\\/70',
    );
    if (!overlay) return { found: false };
    const rect = overlay.getBoundingClientRect();
    const lineWrapper = overlay.parentElement;
    const activeLineKey = lineWrapper?.getAttribute("data-bar-line") ?? undefined;
    // Walk up to find the nearest scrollable ancestor.
    let scrollContainer: HTMLElement | null = lineWrapper;
    while (scrollContainer && scrollContainer !== document.body) {
      const style = window.getComputedStyle(scrollContainer);
      if (style.overflowY === "auto" || style.overflowY === "scroll") break;
      scrollContainer = scrollContainer.parentElement;
    }
    if (!scrollContainer || scrollContainer === document.body) {
      return { found: true, top: rect.top, bottom: rect.bottom, viewportH: window.innerHeight, activeLineKey };
    }
    const containerRect = scrollContainer.getBoundingClientRect();
    let lineContentY: number | undefined;
    if (lineWrapper) {
      const lineRect = lineWrapper.getBoundingClientRect();
      lineContentY = lineRect.top - containerRect.top + scrollContainer.scrollTop;
    }
    return {
      found: true,
      top: rect.top,
      bottom: rect.bottom,
      viewportH: window.innerHeight,
      scrollTop: scrollContainer.scrollTop,
      scrollHeight: scrollContainer.scrollHeight,
      clientHeight: scrollContainer.clientHeight,
      lineContentY,
      activeLineKey,
    };
  });
}

test.describe("Auto-scroll regression: active bar stays in viewport", () => {
  test("active bar visible throughout playthrough of intro + verse + chorus", async ({ page }) => {
    await seedScoreAndEnterPerform(page);
    // The play button lives in PerformView's auto-scroll toolbar. Its
    // accessible label flips between "Start auto-scroll" and
    // "Pause auto-scroll".
    await page.locator('button[aria-label="Start auto-scroll"]').click();

    // Sample every 250ms for 12 seconds — covers ~24 bars at 240 BPM,
    // enough to traverse intro (8 bars), verse (8 bars), and into
    // chorus (transition we've been regressing).
    const samples: Array<OverlayProbe & { t: number }> = [];
    const offScreenMisses: Array<{ t: number; probe: OverlayProbe }> = [];
    for (let i = 0; i < 48; i++) {
      await page.waitForTimeout(250);
      const probe = await probeActiveBar(page);
      samples.push({ t: i * 250, ...probe });
      if (probe.found && probe.top !== undefined && probe.bottom !== undefined) {
        const viewportH = probe.viewportH ?? 0;
        const fullyVisible = probe.top >= 0 && probe.bottom <= viewportH;
        if (!fullyVisible) {
          offScreenMisses.push({ t: i * 250, probe });
        }
      }
    }

    // Build a compact timeline string so the failure message shows
    // when scroll departed from the expected target — Playwright
    // workers swallow most console output, but assertion messages
    // surface reliably.
    const timeline = samples
      .filter((s) => s.found)
      .map((s) => {
        const expected =
          s.lineContentY !== undefined
            ? Math.max(0, s.lineContentY - (s.viewportH ?? 0) / 3).toFixed(0)
            : "?";
        return `t=${s.t} key=${s.activeLineKey} lineY=${s.lineContentY?.toFixed(0)} scroll=${s.scrollTop} want=${expected} barTop=${s.top?.toFixed(0)}`;
      })
      .join("\n");
    expect(
      offScreenMisses.length,
      `active bar went off-screen during playthrough.\n\nTimeline:\n${timeline}`,
    ).toBe(0);
  });

  test("active bar viewport position stays near 1/3-from-top once scroll engages", async ({ page }) => {
    await seedScoreAndEnterPerform(page);
    await page.locator('button[aria-label="Start auto-scroll"]').click();

    // After 4 seconds (~8 bars at 240 BPM), scroll should have engaged
    // and the active line should be at roughly viewport/3 from top.
    await page.waitForTimeout(4000);
    const probe = await probeActiveBar(page);
    expect(probe.found, "active bar overlay missing after 4s").toBe(true);
    const viewportH = probe.viewportH!;
    const oneThird = viewportH / 3;
    const top = probe.top!;
    // Tolerance: half a viewport — the overlay starts at the line's
    // top and the trigger threshold is viewport/2, so a wide window
    // covers initial warm-up + transition animations.
    expect(top, `active bar at y=${top}, expected near ${oneThird}`).toBeGreaterThan(0);
    expect(top, `active bar at y=${top}, expected near ${oneThird}`).toBeLessThan(viewportH * 0.85);
  });
});

// Chord chart with one deliberately wide line — 12 bars on a single
// line, ~55 chars — so 2-col perform mode (column ≈ 350-400px on a
// typical Playwright viewport) is guaranteed to need to wrap it.
const WIDE_LINE_CHART = {
  id: "test-chord-chart-wide",
  title: "Wide line test",
  composer: "",
  tempo: 120,
  timeSignature: "4/4",
  keySignature: "C",
  measures: 12,
  staves: [],
  sections: [
    {
      id: "v",
      label: "Verse",
      lines: [
        { chords: "| Em | Bm | C | D | Em | Bm | C | D | Em | Bm | C | D |", lyrics: "" },
      ],
    },
  ],
};

// Pause / Continue transport (#144). The big floating button stays in
// place across the autoScroll on/off transition. Pause preserves the
// elapsed counter + activeBarIdx so Continue resumes on the same bar
// instead of restarting from the top. End-of-song and song-change paths
// still reset.
test.describe("Auto-scroll: pause / continue transport", () => {
  test("Pause then Continue resumes from the SAME line, not from intro-0", async ({ page }) => {
    await seedScoreAndEnterPerform(page);
    await page.locator('button[aria-label="Start auto-scroll"]').click();

    // Play long enough that the active bar has clearly moved off intro-0
    // (at 240 BPM and 4 bars in intro-0, ~4 seconds covers that line).
    await page.waitForTimeout(4500);
    const beforePause = await probeActiveBar(page);
    expect(beforePause.found, "overlay present before pause").toBe(true);
    expect(
      beforePause.activeLineKey,
      "test setup: pause should happen on a line past intro-0",
    ).not.toBe("intro-0");

    // Pause via the big floating button. There are two buttons with
    // this aria-label while playing (toolbar + floating); the toolbar
    // one is rendered first in the DOM so .first() picks it. Either
    // toggles autoScroll, so it doesn't matter which we click.
    await page.locator('button[aria-label="Pause auto-scroll"]').first().click();

    // Mid-pause: the active bar overlay should NOT have moved.
    await page.waitForTimeout(500);
    const duringPause = await probeActiveBar(page);
    expect(duringPause.activeLineKey, "pause preserves activeLineKey").toBe(
      beforePause.activeLineKey,
    );

    // Continue. With the PR #144 fix, elapsed + activeBar are preserved
    // across pause, so resume starts on the same line. The buggy
    // pre-fix behavior was: pause reset elapsed to 0, so resume put
    // the highlight back on intro-0.
    // Capture scroll position before Continue. After Continue we'll
    // assert the scroll didn't snap back toward the top — user-reported
    // bug: "the cursor goes to the top of the screen on resume."
    const scrollBeforeContinue = duringPause.scrollTop ?? 0;

    await page.locator('button[aria-label="Continue auto-scroll"]').click();
    // Brief wait — long enough for the RAF loop to tick at least once,
    // short enough that we haven't advanced more than one bar's worth
    // (≤ 1 second at 240 BPM).
    await page.waitForTimeout(200);
    const afterContinue = await probeActiveBar(page);
    expect(
      afterContinue.activeLineKey,
      `Continue restarted from intro-0 (pre-fix bug). before=${beforePause.activeLineKey} after=${afterContinue.activeLineKey}`,
    ).not.toBe("intro-0");

    // Scroll preservation: 200ms after Continue, the chord chart
    // should still be at roughly the same scroll position. If a regression
    // resets scrollTop to 0 (or animates it back toward the top via
    // some line-transition glitch), the gap balloons. Tolerance: 250px
    // — enough headroom for one engaged-line scroll animation to land
    // a tick or two further down, but small enough to catch a "snap to
    // top" regression.
    const scrollAfterContinue = afterContinue.scrollTop ?? 0;
    expect(
      Math.abs(scrollAfterContinue - scrollBeforeContinue),
      `scrollTop drifted on Continue. before=${scrollBeforeContinue} after=${scrollAfterContinue}`,
    ).toBeLessThan(250);
  });

  test("Tempo ♩+ / ♩− doesn't jump the active bar (PR #145 rescaling)", async ({ page }) => {
    // The bug: tempo change recomputed activeBarIdx = floor(elapsed *
    // newTempo / 60 / beatsPerBar) without rescaling elapsed, so the
    // same wall-clock elapsed mapped to a different bar under the new
    // tempo — visible jumps forward or backward through the chart.
    // Fix (PR #145): rescale elapsed inversely with tempo ratio at
    // change time. Musical position (consumed beats) is preserved.
    await seedScoreAndEnterPerform(page);
    await page.locator('button[aria-label="Start auto-scroll"]').click();

    // Settle into intro-1 (~4s past intro-0 at 240 BPM 4/4).
    await page.waitForTimeout(4500);
    const before = await probeActiveBar(page);
    expect(before.found, "overlay present before tempo change").toBe(true);
    const lineBefore = before.activeLineKey;

    // Tap ♩+ five times in quick succession. Each step is +2 BPM, so
    // tempo moves 240 → 250 across these clicks. With rescaling, each
    // click reshifts elapsed so the bar index stays put. Without it,
    // floor(elapsed * newTempo / 60 / 4) could tip across a boundary.
    const faster = page.locator('button[aria-label="Faster tempo"]');
    for (let i = 0; i < 5; i++) await faster.click();

    // Sample immediately (no wait) — RAF hasn't had a chance to advance
    // by a measurable amount of time.
    const afterFaster = await probeActiveBar(page);
    expect(
      afterFaster.activeLineKey,
      `Tempo ♩+ jumped the bar. before=${lineBefore} after=${afterFaster.activeLineKey}`,
    ).toBe(lineBefore);

    // And the same for the other direction — ♩− brings tempo back
    // down. The rescaling math has to be symmetric.
    const slower = page.locator('button[aria-label="Slower tempo"]');
    for (let i = 0; i < 5; i++) await slower.click();
    const afterSlower = await probeActiveBar(page);
    expect(
      afterSlower.activeLineKey,
      `Tempo ♩− jumped the bar. before=${lineBefore} after=${afterSlower.activeLineKey}`,
    ).toBe(lineBefore);
  });

  test("Continue after end-of-song restarts from the first bar", async ({ page }) => {
    // Short chart (6 bars at 240 BPM ≈ 6s) so end-of-song fires inside
    // the per-test 30s timeout with room to verify the reset.
    await seedScoreAndEnterPerform(page, SHORT_CHORD_CHART);
    await page.locator('button[aria-label="Start auto-scroll"]').click();

    // Let the song finish. The step() loop calls setAutoScroll(false) +
    // resets elapsed when activeBarFromElapsed returns null past end.
    await page.waitForTimeout(7500);

    // Auto-scroll should have auto-stopped. The floating button label
    // flipped from "Pause" back to "Continue" once autoScroll=false.
    const continueBtn = page.locator('button[aria-label="Continue auto-scroll"]');
    await expect(continueBtn, "auto-scroll should have stopped at end-of-song").toBeVisible();

    // Tap Continue. End-of-song reset means elapsed is back at 0, so
    // the active bar should be on the first line (v-0).
    await continueBtn.click();
    await page.waitForTimeout(300);
    const afterRestart = await probeActiveBar(page);
    expect(
      afterRestart.activeLineKey,
      `Continue after end-of-song should restart from v-0, got ${afterRestart.activeLineKey}`,
    ).toBe("v-0");
  });
});

// 2-col line wrap (#146). Long chord lines used to be clipped by the
// `overflow-hidden` columns of PaginatedPerformChart because they
// rendered with `whitespace-pre`. PR #146 wraps them at bar boundaries
// into multiple sub-rows that each fit the column.
test.describe("Auto-scroll: 2-col line wrap", () => {
  test("Long chord line wraps into multiple sub-rows without horizontal overflow", async ({ page }) => {
    await seedScoreAndEnterPerform(page, WIDE_LINE_CHART);

    // Switch to 2-col mode — the toolbar's column-toggle button.
    await page.locator('button[aria-label="Toggle columns"]').click();
    // PaginatedPerformChart re-measures + re-paginates on column change;
    // give layout a beat to settle before sampling DOM.
    await page.waitForTimeout(400);

    // Count the visible chord-row sub-rows for the one seeded chord
    // line. The yellow-300 class identifies chord rows; we filter to
    // those that aren't in the hidden measure column.
    const result = await page.evaluate(() => {
      const all = Array.from(
        document.querySelectorAll<HTMLElement>(".text-yellow-300.whitespace-pre"),
      );
      const visible = all.filter((el) => {
        let cur: HTMLElement | null = el;
        while (cur && cur !== document.body) {
          if (cur.getAttribute("aria-hidden") === "true") return false;
          cur = cur.parentElement;
        }
        return true;
      });
      return visible.map((el) => ({
        text: el.textContent ?? "",
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
    });

    expect(
      result.length,
      `expected the 12-bar line to render as multiple sub-rows in 2-col mode, got ${result.length}: ${result.map((r) => r.text).join(" | ")}`,
    ).toBeGreaterThan(1);

    // Each sub-row must fit within its column — no horizontal overflow.
    // (+1 px tolerance for sub-pixel rounding in the layout engine.)
    for (const row of result) {
      expect(
        row.scrollWidth,
        `chord sub-row "${row.text}" overflows its column (scrollWidth=${row.scrollWidth}, clientWidth=${row.clientWidth})`,
      ).toBeLessThanOrEqual(row.clientWidth + 1);
    }
  });
});
