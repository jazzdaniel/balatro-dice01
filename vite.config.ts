import { defineConfig } from "vite";

/**
 * Dev/build config for the playable UI (`npm run play-ui`). The UI lives under
 * `ui/` and imports the engine straight from `src/` — no build step between
 * them. Library packaging stays with tsup (`npm run build`); this is separate.
 */
export default defineConfig({
  root: "ui",
  server: { open: true },
  build: { outDir: "../dist-ui", emptyOutDir: true },
});
