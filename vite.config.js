import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { apiPlugin } from "./vite-plugin-api.js";

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: { port: 5173 },
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    /* Several suites drive the same local Postgres. Running test FILES in parallel
     * lets them see each other's fixtures - and the demo seed deliberately refuses to
     * run where unexpected data exists. Sequential files keep them honest; the whole
     * suite is only a few seconds. */
    fileParallelism: false,
  },
});
