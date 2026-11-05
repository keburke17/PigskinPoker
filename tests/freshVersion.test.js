/**
 * The stale-page fix (Scott, 2026-11-05): a phone brought back an old copy of the site,
 * Log Out and all, until he refreshed. The page now asks /version.json whether it is
 * still the current build, and reloads when it is not.
 *
 * What is pinned here is the one decision that matters - "is there a newer build?" -
 * and above all that every way of NOT knowing answers no. A reload nobody needed is a
 * lost page; a check that fails must cost nothing.
 */
import { describe, it, expect } from "vitest";
import { BUILD_ID, serverHasNewerBuild } from "../src/hooks/useFreshVersion.js";

const answer = (body, ok = true) => async () => ({ ok, json: async () => body });

describe("serverHasNewerBuild", () => {
  it("is true only when the server names a different build", async () => {
    expect(await serverHasNewerBuild(answer({ build: "def456" }), "abc123")).toBe(true);
    expect(await serverHasNewerBuild(answer({ build: "abc123" }), "abc123")).toBe(false);
  });

  it("is false for every way of not knowing", async () => {
    const cases = [
      answer({ build: "def456" }, false),          // 404 / 500
      answer({}),                                   // no build field
      answer({ build: "" }),                        // empty
      answer({ build: 42 }),                        // not a string
      async () => ({ ok: true, json: async () => { throw new Error("index.html, not JSON"); } }),
      async () => { throw new Error("offline"); },
    ];
    for (const f of cases) expect(await serverHasNewerBuild(f, "abc123")).toBe(false);
  });

  it("never asks when this page does not know its own build", async () => {
    let asked = false;
    const f = async () => { asked = true; return { ok: true, json: async () => ({ build: "x" }) }; };
    expect(await serverHasNewerBuild(f, null)).toBe(false);
    expect(asked).toBe(false);
  });

  it("asks past every cache", async () => {
    let seen;
    await serverHasNewerBuild(async (url, opts) => { seen = { url, opts }; return { ok: false }; }, "abc");
    expect(seen.url).toMatch(/^\/version\.json\?t=\d+$/);
    expect(seen.opts).toEqual({ cache: "no-store" });
  });

  it("is stamped into the bundle by vite.config.js", () => {
    expect(typeof BUILD_ID).toBe("string");
    expect(BUILD_ID.length).toBeGreaterThan(0);
  });
});
