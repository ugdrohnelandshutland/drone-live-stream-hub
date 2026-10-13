import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts", "test/web/**/*.test.{ts,tsx}"],
    testTimeout: 30_000,
  },
});
