/**
 * e2e coverage for ConflictModal's per-line drill-down (PR #116).
 *
 * Each delta row in the modal's "What's different" list is an
 * expandable button. Expanded view shows:
 *  - For lines-differ: the chord+lyric content of BOTH sides
 *    side-by-side (theirs in amber, yours in blue).
 *  - For only-mine / only-theirs: the full section content with
 *    a "section content (lost / gained …)" header.
 *
 * Uses the dev-only `?previewConflict=1` URL hook in src/app/page.tsx
 * (already shipped, tree-shaken in production via the NODE_ENV gate).
 * Sample data: Foggy Night with 3 sections — Verse 1 (1 line differs),
 * Bridge (only-mine), Outro (only-theirs).
 */
import { test, expect, Page } from "@playwright/test";

async function openConflictPreview(page: Page) {
  await page.goto("/?previewConflict=1");
  await page
    .getByText("This song was changed elsewhere")
    .waitFor({ state: "visible", timeout: 5000 });
}

test.describe("ConflictModal: per-line drill-down (PR #116)", () => {
  test("expanding a lines-differ row shows both sides with chord + lyric", async ({ page }) => {
    await openConflictPreview(page);

    // The first delta in the sample data is "Verse 1 — 1 line changed".
    // Find its button by aria-expanded=false.
    const verseRow = page.getByRole("button", { name: /Verse 1.*line changed/i });
    await expect(verseRow, "Verse 1 delta button is visible").toBeVisible();

    // Click to expand.
    await verseRow.click();
    await expect(verseRow).toHaveAttribute("aria-expanded", "true");

    // After expansion: "Line N" sub-header renders. In the sample
    // data only line index 1 differs (idx + 1 in the label = "Line 2").
    await expect(
      page.getByText("Line 2", { exact: true }),
      "expanded card shows Line 2 sub-header",
    ).toBeVisible();

    // BOTH sides are rendered as DiffLineSide cards. They carry the
    // lyric content from the sample data — "i felt" (theirs) and
    // "I HEARD" (yours) are unique enough to assert on.
    await expect(
      page.getByText(/i felt the foggy night/i),
      "theirs side shows the cloud version's lyric",
    ).toBeVisible();
    await expect(
      page.getByText(/I HEARD the foggy night/),
      "yours side shows the local version's lyric",
    ).toBeVisible();
  });

  test("expanding an only-mine row shows the lost-content header + section lines", async ({ page }) => {
    await openConflictPreview(page);

    const bridgeRow = page.getByRole("button", { name: /Bridge.*only in your version/i });
    await expect(bridgeRow, "Bridge delta button is visible").toBeVisible();
    await bridgeRow.click();
    await expect(bridgeRow).toHaveAttribute("aria-expanded", "true");

    await expect(
      page.getByText(/Section content \(lost if you discard mine\):/i),
      "only-mine expansion shows the lost-content header",
    ).toBeVisible();
    // Sample lyric from page.tsx's only-mine section.
    await expect(
      page.getByText(/this section only exists in YOUR version/),
      "expanded card shows the section's lyric content",
    ).toBeVisible();
  });

  test("expanding an only-theirs row shows the gained-content header", async ({ page }) => {
    await openConflictPreview(page);

    const outroRow = page.getByRole("button", { name: /Outro.*only in their version/i });
    await expect(outroRow, "Outro delta button is visible").toBeVisible();
    await outroRow.click();
    await expect(outroRow).toHaveAttribute("aria-expanded", "true");

    await expect(
      page.getByText(/Section content \(gained if you discard mine\):/i),
      "only-theirs expansion shows the gained-content header",
    ).toBeVisible();
    await expect(
      page.getByText(/this section only exists in THEIR version/),
      "expanded card shows the cloud-only section content",
    ).toBeVisible();
  });

  test("a second click on the same row collapses it again", async ({ page }) => {
    await openConflictPreview(page);

    const verseRow = page.getByRole("button", { name: /Verse 1.*line changed/i });
    await verseRow.click();
    await expect(verseRow).toHaveAttribute("aria-expanded", "true");

    // The Line 2 sub-header is now visible.
    await expect(page.getByText("Line 2", { exact: true })).toBeVisible();

    // Collapse.
    await verseRow.click();
    await expect(verseRow).toHaveAttribute("aria-expanded", "false");

    // Sub-header is gone.
    await expect(
      page.getByText("Line 2", { exact: true }),
      "Line 2 sub-header is gone after collapsing",
    ).toHaveCount(0);
  });
});
