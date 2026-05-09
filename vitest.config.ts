import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts", "src/**/__tests__/**/*.test.tsx"],
    // Don't sweep up the Playwright e2e suite — it has a different test
    // runner and would otherwise complain about unsupported describe()
    // calls in the vitest context.
    exclude: ["node_modules", "e2e", ".next", "infra"],
  },
});
