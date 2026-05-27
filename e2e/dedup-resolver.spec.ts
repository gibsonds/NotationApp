/**
 * e2e coverage for the duplicate-song resolver (PRs #154–#156).
 *
 * Flow exercised:
 *  1. Seed localStorage with two same-titled songs.
 *  2. Open My Songs via File menu.
 *  3. Confirm the "N duplicate titles — Resolve" banner appears.
 *  4. Click Resolve → right pane shows the resolver.
 *  5. Click Compare → full-screen overlay opens with both entries
 *     in their own columns; diff rows are highlighted.
 *  6. Toggle "Only diffs" → unchanged-run gap placeholders appear,
 *     same-rows are no longer in the visible-row set.
 *
 * Seeds two Foggy Night entries with one matching line and one
 * differing line so the diff/gap behaviour exercises both code
 * paths in chord-chart-diff.ts.
 */
import { test, expect, Page } from "@playwright/test";

const STORAGE_KEY = "notation-app-songs";

// Two same-titled entries. Sections / lines crafted so the diff
// engine sees one "same" row (the section header), one "diff" row
// (the lyric differs), and a stable comparison pair.
const DUP_SONGS = [
  {
    id: "song-foggy-A",
    title: "Foggy Night",
    savedAt: Date.now() - 60_000,
    score: {
      id: "song-foggy-A",
      title: "Foggy Night",
      composer: "",
      tempo: 96,
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
          id: "v1",
          label: "Verse 1",
          lines: [
            { chords: "| Am | F |", lyrics: "way back then" },
            { chords: "| C | G |", lyrics: "I HEARD the foggy night" },
          ],
        },
      ],
      form: [],
      metadata: {},
      annotations: [],
    },
  },
  {
    id: "song-foggy-B",
    title: "Foggy Night",
    savedAt: Date.now() - 30_000,
    score: {
      id: "song-foggy-B",
      title: "Foggy Night",
      composer: "",
      tempo: 96,
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
          id: "v1",
          label: "Verse 1",
          lines: [
            { chords: "| Am | F |", lyrics: "way back then" }, // SAME
            { chords: "| C | G |", lyrics: "i felt the foggy night" }, // DIFFERS
          ],
        },
      ],
      form: [],
      metadata: {},
      annotations: [],
    },
  },
];

async function seedDuplicatesAndOpenMySongs(page: Page) {
  await page.goto("/");
  await page.evaluate(([key, songs]) => {
    localStorage.setItem(key as string, JSON.stringify(songs));
  }, [STORAGE_KEY, DUP_SONGS] as const);
  await page.reload();
  // Open the File menu, then click "My Songs…".
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByText(/My Songs/).click();
}

test.describe("Duplicate-song resolver (PRs #154–#156)", () => {
  test("banner appears when duplicates exist + opens the resolver pane", async ({ page }) => {
    await seedDuplicatesAndOpenMySongs(page);

    // The amber banner identifies itself by the "duplicate titles" copy.
    await expect(
      page.getByText(/duplicate title.*Resolve/i),
      "amber duplicate-titles banner appears in My Songs",
    ).toBeVisible();

    // Click the Resolve link inside the banner.
    await page.getByRole("button", { name: /^Resolve$/ }).click();

    // Right pane heading.
    await expect(
      page.getByRole("heading", { name: /Resolve duplicates/i }),
      "resolver pane heading is visible",
    ).toBeVisible();

    // Each entry is a radio under name=keep-<canonical>. Two entries → 2 radios.
    const radios = page.locator('input[type="radio"][name^="keep-"]');
    await expect(radios, "one radio per entry").toHaveCount(2);
  });

  test("Compare overlay opens full-screen with both entries", async ({ page }) => {
    await seedDuplicatesAndOpenMySongs(page);
    await page.getByRole("button", { name: /^Resolve$/ }).click();
    await page.getByRole("button", { name: /^Compare$/ }).click();

    // The "Compare \"Foggy Night\"" heading is the overlay header.
    await expect(
      page.getByRole("heading", { name: /Compare.*Foggy Night/i }),
      "full-screen Compare overlay header is visible",
    ).toBeVisible();

    // "N rows differ" subtitle confirms classification ran (the
    // diff helper found exactly one differing row in this fixture).
    await expect(page.getByText(/1 row differs/i)).toBeVisible();

    // Both entries' lyric content visible side-by-side. "I HEARD"
    // is unique to entry A's lyric; "i felt" is unique to entry B.
    await expect(page.getByText(/I HEARD the foggy night/)).toBeVisible();
    await expect(page.getByText(/i felt the foggy night/)).toBeVisible();
  });

  test('"Only diffs" toggle collapses unchanged runs into gap placeholders', async ({ page }) => {
    await seedDuplicatesAndOpenMySongs(page);
    await page.getByRole("button", { name: /^Resolve$/ }).click();
    await page.getByRole("button", { name: /^Compare$/ }).click();

    // Before toggle: identical rows (e.g. "way back then" lyric and
    // the section header) are rendered as plain row divs.
    await expect(
      page.getByText(/way back then/).first(),
      "matching row is visible before toggling",
    ).toBeVisible();

    // Toggle on. The label "Only diffs" wraps a checkbox.
    await page.getByText("Only diffs").click();

    // After toggle: the diff (1 row) still renders, but the
    // matching rows collapse into ··· N unchanged ··· spacers.
    await expect(
      page.getByText(/unchanged row/i).first(),
      "gap placeholder text appears for the collapsed run",
    ).toBeVisible();
    // The "diff" row (the lyric that differs) is still visible.
    await expect(page.getByText(/i felt the foggy night/).first()).toBeVisible();
  });
});
