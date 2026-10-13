import { defineConfig } from "vitest/config";

/** `npm run test:scenarios`: short versions of the scenarios in CLAUDE.md §10.2. */
export default defineConfig({
  test: {
    include: ["test/scenarios/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // Each scenario runs several ffmpeg encoders; run them one at a time.
    fileParallelism: false,
    execArgv: ["--expose-gc"],
  },
});
