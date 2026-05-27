import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://localhost:3001",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "PORT=3001 npm run dev",
    port: 3001,
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    // Run the same specs against WebKit too. The user has reported
    // PerformView's cursor-to-top-on-resume regression only on iPad
    // Safari (chromium passes the scrollTop-preservation test). Having
    // CI exercise WebKit catches Safari-specific regressions going
    // forward — the engine differs in rAF throttling, scroll-anchoring,
    // and subpixel rounding, any of which could surface a bug chromium
    // misses.
    { name: "webkit", use: { browserName: "webkit" } },
    // WebKit at iPad-portrait dimensions — closer to what the user
    // actually sees. Catches viewport-dependent regressions
    // (toolbar wrap, scroll-anchoring at small widths, etc.) that
    // desktop-sized WebKit might miss.
    {
      name: "webkit-ipad",
      use: {
        browserName: "webkit",
        viewport: { width: 810, height: 1080 },
      },
    },
  ],
});
