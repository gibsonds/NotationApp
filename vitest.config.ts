import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts", "src/**/__tests__/**/*.test.tsx"],
    // Don't sweep up the Playwright e2e suite — it has a different test
    // runner and would otherwise complain about unsupported describe()
    // calls in the vitest context.
    exclude: ["node_modules", "e2e", ".next", "infra"],
    // Use happy-dom so window / document / localStorage / dispatchEvent
    // are available without booting a full browser. Faster than jsdom
    // for the bits the cloud-sync tests need.
    environment: "happy-dom",
    // Cloud env: set NEXT_PUBLIC_API_BASE so CLOUD_ENABLED is true at
    // module load. The base value doesn't matter for tests because we
    // mock fetch — it just needs to be non-empty.
    env: {
      NEXT_PUBLIC_API_BASE: "https://test.local",
    },
  },
});
