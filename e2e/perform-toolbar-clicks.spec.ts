/**
 * User reported: in perform mode, the "Songs" button does nothing
 * when tapped, and sometimes tapping "Edit" opens MySongs instead.
 * Looks like a layout / z-index regression after #157 widened the
 * Songs button into a labeled pill.
 *
 * These tests open perform mode, click each toolbar button by
 * accessible name, and assert the right thing happens:
 *  - Songs → MySongs modal visible, still in perform mode.
 *  - Edit → MySongs NOT visible, performMode flips off.
 *
 * They also assert by HIT TESTING — picking a click point inside the
 * visible bounds of each button and using `page.mouse.click()` with
 * pixel coordinates. That's what an iPad touch does; an aria-label
 * locator bypasses overlap by name and would miss the regression.
 */
import { test, expect, Page } from "@playwright/test";

const CHART = {
  id: "test-toolbar-clicks",
  title: "Toolbar test song",
  composer: "",
  tempo: 120,
  timeSignature: "4/4",
  keySignature: "C",
  measures: 4,
  staves: [],
  sections: [
    {
      id: "v",
      label: "Verse",
      lines: [{ chords: "| C | G |", lyrics: "" }],
    },
  ],
};

async function seedPerformMode(page: Page) {
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
  }, CHART);
  await page.reload();
  await page.waitForSelector("[data-bar-line]", { timeout: 10000 });
}

test.describe("Perform toolbar click targets (regression for #157)", () => {
  // The user hit this on iPad. Run the suite at iPad-portrait dimensions
  // so toolbar-flex-wrap behaviour matches what they actually see.
  test.use({ viewport: { width: 810, height: 1080 } });

  test("Songs button click opens the MySongs modal ABOVE PerformView", async ({ page }) => {
    await seedPerformMode(page);

    // Find the Songs button by its aria-label so the locator is stable.
    const songsBtn = page.locator('button[aria-label="Open My Songs"]');
    await expect(songsBtn, "Songs button is rendered").toBeVisible();

    // Click via pixel coordinates — what a real tap does. If another
    // element is layered on top at the same coords, this catches it.
    const box = await songsBtn.boundingBox();
    if (!box) throw new Error("Songs button has no bounding box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // MySongs modal should appear. Identify by its "My Songs" heading.
    const modal = page.locator('text=/My Songs/i').first();
    await expect(modal, "MySongs modal should open").toBeVisible({ timeout: 2000 });

    // Regression: the modal must be Z-STACKED ABOVE PerformView. The
    // original bug was both at z-50 — modal opened, but DOM order kept
    // PerformView on top, so the user saw nothing. Use
    // elementFromPoint at the modal's center: it must return an
    // element inside the modal, not PerformView's chrome.
    const isOnTop = await page.evaluate(() => {
      const modalRoot = Array.from(document.querySelectorAll<HTMLElement>(".fixed.inset-0"))
        .find((el) => /z-\[60\]|z-60/.test(el.className));
      if (!modalRoot) return { onTop: false, reason: "no modal root found" };
      const r = modalRoot.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        onTop: !!(hit && (modalRoot === hit || modalRoot.contains(hit))),
        reason: hit ? hit.tagName + "." + (hit.className?.toString().slice(0, 80) ?? "") : "no hit",
      };
    });
    expect(
      isOnTop.onTop,
      `MySongs modal is not the topmost element at its center. hit=${isOnTop.reason}`,
    ).toBe(true);
  });

  test("toolbar buttons don't visually overlap at iPad portrait", async ({ page }) => {
    await seedPerformMode(page);
    const songsBox = await page.locator('button[aria-label="Open My Songs"]').boundingBox();
    const editBox = await page.locator('button[aria-label="Edit (exit perform mode)"]').boundingBox();
    const annotateBox = await page.locator('button[aria-label*="Annotate"]').first().boundingBox().catch(() => null);
    expect(songsBox).not.toBeNull();
    expect(editBox).not.toBeNull();
    if (songsBox && editBox) {
      const songsRight = songsBox.x + songsBox.width;
      const editLeft = editBox.x;
      const songsBottom = songsBox.y + songsBox.height;
      const editTop = editBox.y;
      const noOverlap =
        songsRight <= editLeft || songsBottom <= editTop || editBox.x + editBox.width <= songsBox.x || editBox.y + editBox.height <= songsBox.y;
      expect(
        noOverlap,
        `Songs and Edit buttons overlap! songs=${JSON.stringify(songsBox)} edit=${JSON.stringify(editBox)} annotate=${JSON.stringify(annotateBox)}`,
      ).toBe(true);
    }
  });

  test("Edit button click exits perform mode (does NOT open MySongs)", async ({ page }) => {
    await seedPerformMode(page);

    const editBtn = page.locator('button[aria-label="Edit (exit perform mode)"]');
    await expect(editBtn, "Edit button is rendered").toBeVisible();

    const box = await editBtn.boundingBox();
    if (!box) throw new Error("Edit button has no bounding box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // After clicking Edit: perform mode is gone (no [data-bar-line]
    // in perform-mode chord chart) and MySongs is NOT visible.
    await page.waitForTimeout(300);
    // The perform-mode wrapper has the dark "#0f0f1f" bg and is fixed
    // inset-0 z-50. After exit, it unmounts; assert via the absence of
    // the perform-mode Songs button.
    const stillInPerform = await page.locator('button[aria-label="Open My Songs"]').isVisible().catch(() => false);
    expect(stillInPerform, "should have exited perform mode").toBe(false);
  });
});
