/**
 * Deployment configuration failure modes.
 *
 * Every one of these is a mistake that is easy to make in a hosting dashboard and,
 * without these guards, produces a site that looks fine or hangs with no explanation.
 * They are much cheaper to catch here than at 1pm on a Sunday.
 */

import { describe, it, expect } from "vitest";
import { createStore } from "../src/storage/index.js";

describe("createStore configuration", () => {
  it("falls back to the in-memory demo in development", async () => {
    const store = createStore({ PROD: false });
    const view = await store.loadLeague();
    expect(view.teams).toHaveLength(6); // the demo league, deliberately
  });

  it("REFUSES to fall back to the demo in a production build", () => {
    // Silently serving the demo would deploy a site that looks entirely healthy but is
    // a throwaway per-tab copy that saves nothing.
    expect(() => createStore({ PROD: true })).toThrow(/not configured/i);
  });

  it("names the specific variable that is missing", () => {
    expect(() => createStore({ PROD: true, VITE_SUPABASE_URL: "https://x.supabase.co" }))
      .toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY is missing/);
    expect(() => createStore({ PROD: true, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" }))
      .toThrow(/VITE_SUPABASE_URL is missing/);
    expect(() => createStore({ PROD: true })).toThrow(/are missing/);
  });

  it("uses Supabase when both variables are present", () => {
    const store = createStore({
      PROD: true,
      VITE_SUPABASE_URL: "https://x.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    });
    // The Supabase adapter exposes login; the memory one has no realtime channel setup.
    expect(typeof store.loginCommissioner).toBe("function");
    expect(typeof store.subscribe).toBe("function");
  });
});
