/**
 * Deployment configuration failure modes.
 *
 * Every one of these is a mistake that is easy to make in a hosting dashboard and,
 * without these guards, produces a site that looks fine or hangs with no explanation.
 * They are much cheaper to catch here than at 1pm on a Sunday.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createStore } from "../src/storage/index.js";

describe("createStore configuration", () => {
  /* This used to assert the opposite: with no configuration, development fell back to
     an in-memory demo league. That adapter is gone (see src/storage/index.js), so there
     is nothing left to fall back TO - and that is the point of deleting it. Working all
     afternoon against a store that cannot sign anyone in, and discovering what the real
     one does at deploy time, was the failure this now prevents. */
  it("REFUSES to start unconfigured in development, and says how to fix it", () => {
    expect(() => createStore({ PROD: false })).toThrow(/not configured/i);
    expect(() => createStore({ PROD: false })).toThrow(/npm run dev/);
  });

  it("REFUSES to start unconfigured in a production build, and says how to fix it", () => {
    // Silently serving a demo would deploy a site that looks entirely healthy but is
    // a throwaway per-tab copy that saves nothing.
    expect(() => createStore({ PROD: true })).toThrow(/not configured/i);
    expect(() => createStore({ PROD: true })).toThrow(/environment variables/);
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
    // Reads through PostgREST, writes through the function, live updates over Realtime.
    expect(typeof store.signInWithEmail).toBe("function");
    expect(typeof store.subscribe).toBe("function");
  });
});

/* GoTrue picks the sign-in email's template by whether the address already EXISTS:
 * an existing user gets Magic Link, a new one gets Confirm signup. Configuring only
 * Magic Link therefore leaves every first-time member receiving Supabase's unbranded
 * default - the people with the least reason to trust an email from us, and the ones
 * most likely to report it.
 *
 * It hides well. Anyone testing with their own already-registered address sees the
 * branded email and concludes it is fine. It was found only because a test to a fresh
 * address came back unbranded and looked like a paste that had not saved.
 *
 * This asserts the LOCAL config. The hosted project does not read config.toml - both
 * templates are pasted into the dashboard by hand - so this cannot prove production is
 * right. What it can do is keep the repo stating that there are two of them, so the
 * next person configuring a dashboard is told. docs/EMAIL-SETUP.md has the steps.
 */
describe("sign-in email templates", () => {
  const root = path.resolve(__dirname, "..");
  const toml = fs.readFileSync(path.join(root, "supabase", "config.toml"), "utf8");

  const contentPathFor = (template) => {
    const m = toml.match(
      new RegExp("\\[auth\\.email\\.template\\." + template + "\\][^[]*", "m")
    );
    if (!m) return null;
    const c = m[0].match(/^\s*content_path\s*=\s*"([^"]+)"/m);
    return c ? c[1] : null;
  };

  it("configures BOTH magic_link and confirmation", () => {
    expect(contentPathFor("magic_link")).toBeTruthy();
    expect(contentPathFor("confirmation")).toBeTruthy();
  });

  it("points both at the same file, so the two cannot drift apart", () => {
    expect(contentPathFor("confirmation")).toBe(contentPathFor("magic_link"));
  });

  it("and that file exists and uses a variable BOTH templates provide", () => {
    const rel = contentPathFor("magic_link").replace(/^\.\//, "");
    const body = fs.readFileSync(path.join(root, rel), "utf8");
    expect(body).toMatch(/\{\{\s*\.ConfirmationURL\s*\}\}/);
    // .Token and .TokenHash exist in both, but a template using anything Confirm signup
    // does not supply would render blank for exactly the first-time users this protects.
    expect(body).not.toMatch(/\{\{\s*\.(SiteURL|RedirectTo)\s*\}\}/);
  });
});
