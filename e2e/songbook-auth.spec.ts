import { test, expect, Page } from "@playwright/test";

test.skip(!process.env.NEXT_PUBLIC_OAUTH_CLIENT_ID, "Run with OAuth environment variables to exercise authenticated build");

async function openSongs(page: Page) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByText("My Songs…", { exact: true }).click();
  await expect(page.getByLabel("Active songbook")).toBeVisible();
}

test("creates and switches books without moving cached songs or editor drafts", async ({ page }, testInfo) => {
  const books = [{ songbookId: "book-a", name: "Personal", role: "owner" }];
  await page.addInitScript(() => {
    if (localStorage.getItem("auth-test-seeded")) return;
    localStorage.setItem("auth-test-seeded", "1");
    localStorage.setItem("notation-app-auth", JSON.stringify({ access_token: "test-token", expires_at: Date.now() + 3600000, claims: { sub: "test-user", email: "test@example.test" } }));
    localStorage.setItem("notation-app-active-songbook", "book-a");
    const score = { id: "sleepwalking-test", title: "Sleepwalking test draft", composer: "", tempo: 120, timeSignature: "4/4", keySignature: "C", measures: 4, anacrusis: false, staves: [], chordSymbols: [], rehearsalMarks: [], repeats: [], measureChanges: [], sections: [{ id: "chorus", label: "Chorus", lines: [{ chords: "|Am", lyrics: "Test lyric" }] }], form: [], metadata: {}, annotations: [] };
    localStorage.setItem("notation-app-store:test-user:book-a", JSON.stringify({ version: 14, state: { score, history: [score], historyIndex: 0, stepEntryHistory: [null] } }));
    localStorage.setItem("notation-app-songs:test-user:book-a", JSON.stringify([{ id: "song-a", title: "Sleepwalking test draft", score, savedAt: 1 }]));
  });
  const writes: string[] = [];
  await page.route("http://127.0.0.1:9999/**", async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (path === "/me") return route.fulfill({ json: { sub: "test-user", email: "test@example.test", memberships: books } });
    if (path === "/songbooks" && req.method() === "POST") {
      const book = { songbookId: "book-b", name: req.postDataJSON().name, role: "owner" }; books.push(book);
      return route.fulfill({ json: book });
    }
    if (path.endsWith("/invites") && req.method() === "POST") return route.fulfill({ json: { token: "test-invite", expiresAt: Date.now() + 86400000 } });
    if (req.method() === "PUT") {
      writes.push(path);
      return route.fulfill({ json: { ...req.postDataJSON(), id: "song-a", version: "v1" } });
    }
    if (path.endsWith("/songs")) return route.fulfill({ json: { songs: [] } });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sleepwalking test draft" })).toBeVisible();
  await openSongs(page);
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  await expect(page.getByLabel("Invitation link", { exact: true })).toHaveValue(/invite=test-invite/);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Active songbook")).toBeVisible();
  await page.getByRole("button", { name: "New book", exact: true }).click();
  await page.getByLabel("Songbook name").fill("Band rehearsal");
  await page.getByRole("button", { name: "Create songbook", exact: true }).click();
  await expect(page.getByText("No score yet", { exact: true })).toBeVisible();
  await openSongs(page);
  await expect(page.getByLabel("Active songbook")).toHaveValue("book-b");
  await expect(page.getByText("Sleepwalking test draft", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("separate-songbook.png"), fullPage: true });
  await page.getByLabel("Active songbook").selectOption("book-a");
  await expect(page.getByRole("heading", { name: "Sleepwalking test draft" })).toBeVisible();
  expect(writes.every(path => path.startsWith("/songbooks/book-a/"))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("notation-app-store:test-user:book-a"))).toContain("Sleepwalking test draft");
});
