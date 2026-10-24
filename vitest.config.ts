import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The workspace packages' tests run here too (packages/mcp spawns its built server).
    include: ["tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    // A live test calls a paid provider whenever `.env` holds a key, so `npm test` never runs
    // one; `npm run eval:live` runs it through vitest.live.config.ts.
    exclude: [...configDefaults.exclude, "**/*.live.test.ts"],
    environment: "node",
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    // The first DOCX test pays for a cold `mammoth` import, which under parallel load passed 5s.
    testTimeout: 15_000,
  },
});
