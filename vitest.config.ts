import { defineConfig } from "vitest/config";

/**
 * Vitest config kept separate from `vite.config.ts` (which roots the UI at
 * `ui/`). Without this, vitest would inherit that root and find no tests.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.ts"],
  },
});
