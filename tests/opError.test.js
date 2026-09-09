/**
 * A refused write must always say something.
 *
 * This is the half of the 2026-09-09 rename bug that had nothing to do with renaming.
 * `handle()` in src/hooks/useLeague.js shaped its banner in a chain of else-ifs that
 * ended at `network` with no final else, so any reason not on that list fell off the
 * end: the write did not happen, the server's own view quietly replaced what was on
 * screen, and the person was told nothing at all. A manager renaming his own team hit
 * it through `forbidden`; entering a stat with the rosters unlocked hits it through
 * `unlocked`; an expired session hits it through `unauthorized`.
 *
 * So the property under test is coverage, not wording: EVERY failure the app can
 * produce - including one nobody has thought of yet - comes back with a headline.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { failureBanner } from "../src/hooks/opError.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Every `reason` the storage adapter mints, plus the ones the server sends in a 409
 * body. If a new one is added to either, this list is where it has to be added too -
 * and the last case below is the safety net for the day somebody forgets. */
const REASONS = [
  "network",     // fetch failed, or a 5xx
  "stale",       // 409, someone else moved first - handled as a conflict, not a banner
  "throttled",   // 429
  "unauthorized",// 401
  "forbidden",   // 403  <- the rename bug
  "invalid",     // 400, or any other 4xx
  "phase",       // 409 from guard(): the week has moved on
  "locked",      // schemes are closed
  "unlocked",    // 409 from setStatLine: lock the rosters first
];

describe("failureBanner", () => {
  it("is null for anything that is not a failure", () => {
    expect(failureBanner(null)).toBeNull();
    expect(failureBanner(undefined)).toBeNull();
    expect(failureBanner({ ok: true })).toBeNull();
    expect(failureBanner({ ok: true, view: {} })).toBeNull();
  });

  it("gives every known reason a headline", () => {
    for (const reason of REASONS) {
      const banner = failureBanner({ ok: false, reason, message: "The server said so." });
      expect(banner, reason).toBeTruthy();
      expect(typeof banner.headline, reason).toBe("string");
      expect(banner.headline.length, reason).toBeGreaterThan(0);
    }
  });

  it("gives a reason nobody has invented yet a headline too", () => {
    const banner = failureBanner({ ok: false, reason: "something-new-in-2027" });
    expect(banner.headline).toBe("Couldn't save that change.");
  });

  it("still speaks when there is no reason and no message at all", () => {
    expect(failureBanner({ ok: false }).headline).toBe("Couldn't save that change.");
  });

  /* The server's sentence knows what it refused; anything written in the client would
   * be a vaguer version of it. "You can only change your own team" is the whole
   * explanation of the rename refusal, and it should reach the screen unaltered. */
  it("leads with the server's own sentence", () => {
    expect(failureBanner({ ok: false, reason: "forbidden", message: "You can only change your own team." }))
      .toEqual({ headline: "You can only change your own team.", detail: null });
    expect(failureBanner({ ok: false, reason: "unlocked", message: "Lock the rosters before entering stats." }).headline)
      .toBe("Lock the rosters before entering stats.");
  });

  /* Except here: a network failure's message is a fetch error or a 500 body, which
   * reads like plumbing rather than like an answer. It goes in the detail line. */
  it("keeps a network failure's plumbing out of the headline", () => {
    expect(failureBanner({ ok: false, reason: "network", message: "Failed to fetch" }))
      .toEqual({ headline: "Couldn't save that change.", detail: "Failed to fetch" });
  });

  it("says how long to wait when the server said", () => {
    const banner = failureBanner({ ok: false, reason: "throttled", message: "Slow down.", retryAfter: 30 });
    expect(banner.detail).toBe("Try again in 30 seconds.");
    expect(failureBanner({ ok: false, reason: "throttled", message: "Slow down." }).detail).toBeNull();
  });

  it("tells a signed-out person what to do about it", () => {
    const banner = failureBanner({ ok: false, reason: "unauthorized", message: "Not signed in." });
    expect(banner.headline).toBe("Not signed in.");
    expect(banner.detail).toMatch(/log out and back in/i);
  });

  it("ignores a blank message rather than showing an empty banner", () => {
    expect(failureBanner({ ok: false, reason: "forbidden", message: "   " }).headline)
      .toBe("Couldn't save that change.");
  });
});

/* The regression itself, stated as the shape of the code rather than as a rendered
 * screen: there is no DOM in this project's tests and no library to add one for a
 * dependency budget of four. `handle()` must route through this module rather than
 * growing a second chain of its own. */
describe("useLeague's handle()", () => {
  const source = readFileSync(path.join(root, "src", "hooks", "useLeague.js"), "utf8");

  it("shapes its banner with failureBanner, not inline", () => {
    expect(source).toContain('import { failureBanner } from "./opError.js";');
    expect(source).toContain("setOpError(failureBanner(result));");
  });

  it("has no branch a failure can fall out of", () => {
    /* `stale` is the one refusal that is NOT a banner - it is a conflict, with its own
     * notice and its own dismissal - so it returns early. Everything after it reaches
     * the banner unconditionally, which is what the else-if chain did not. */
    const body = source.slice(source.indexOf("const handle = useCallback"), source.indexOf("const versions ="));
    expect(body).toMatch(/reason === "stale"[\s\S]*setConflict[\s\S]*return;/);
    expect(body).not.toMatch(/else if \(result\.reason/);
    expect(body.trimEnd().endsWith("setOpError(failureBanner(result));\n  }, []);")).toBe(true);
  });
});
