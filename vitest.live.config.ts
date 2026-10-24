import { defineConfig } from "vitest/config";

// Only the tests that call a real, paid provider (`npm run eval:live`).
export default defineConfig({
  test: {
    include: ["tests/**/*.live.test.ts"],
    environment: "node",
    globals: true,
    testTimeout: 15_000,
  },
});
