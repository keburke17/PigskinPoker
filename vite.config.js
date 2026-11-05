import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { apiPlugin } from "./vite-plugin-api.js";

/* Which build this is (2026-11-05). Netlify sets COMMIT_REF on every deploy; anywhere
 * else the build time stands in. The id is baked into the bundle AND written to
 * /version.json, and a page whose id no longer matches the file is an old copy a phone
 * kept - src/hooks/useFreshVersion.js reloads it. */
const BUILD_ID = process.env.COMMIT_REF || "local-" + Date.now();

function versionFile() {
  return {
    name: "pigskin-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) + "\n" });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiPlugin(), versionFile()],
  define: { __APP_BUILD__: JSON.stringify(BUILD_ID) },
  server: { port: 5173 },
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    /* Several suites drive the same local Postgres. Running test FILES in parallel
     * lets them see each other's fixtures - and the demo seed deliberately refuses to
     * run where unexpected data exists. Sequential files keep them honest. */
    fileParallelism: false,
    /* Vitest's default is 5s, which was never right for the suites that drive Docker.
     * Individual tests in server.test.js already ran at 4.5s before anything was added
     * to it - each one resets and reseeds a real Postgres - so the file was one busy
     * machine away from failing on tests that were working perfectly. Adding four
     * database-backed tests for the deal's pool refresh (2026-09-06) was enough to tip
     * four unrelated neighbours over, which is the symptom of a timeout set too close,
     * not of a slow test. The engine suites are unaffected: they take milliseconds and
     * a timeout they never approach costs them nothing. */
    testTimeout: 20000,
  },
});
