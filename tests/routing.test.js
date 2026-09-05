/**
 * The hand-written router.
 *
 * Written by hand rather than pulled in, per CLAUDE.md's rule that dependencies stay
 * boring - which makes these tests the thing standing in for a library's own test suite.
 * They run anywhere; no DOM, no stack, no network.
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_TAB, TABS, buildPath, parsePath } from "../src/routing/index.js";

describe("parsePath", () => {
  it("reads the landing page", () => {
    expect(parsePath("/")).toEqual({ name: "landing" });
    expect(parsePath("")).toEqual({ name: "landing" });
  });

  it("reads a league, defaulting to the scoreboard", () => {
    /* The default moved from "home" (season standings) to "results" (the week in
     * progress) with issues #29 and #30. Asserted through DEFAULT_TAB so the constant is
     * the single place the decision lives, and pinned literally on the line below so
     * changing it back is a deliberate edit to a test rather than a silent one. */
    expect(DEFAULT_TAB).toBe("results");
    expect(parsePath("/l/abc")).toEqual({ name: "league", leagueId: "abc", tab: DEFAULT_TAB });
  });

  it("reads a named tab", () => {
    expect(parsePath("/l/abc/comm")).toEqual({ name: "league", leagueId: "abc", tab: "comm" });
  });

  it("falls back to the default tab for one that does not exist", () => {
    // A stale bookmark or a typo should land somewhere real, not on a blank screen.
    expect(parsePath("/l/abc/not-a-tab").tab).toBe(DEFAULT_TAB);
  });

  it("falls back to the landing page for anything unrecognised", () => {
    expect(parsePath("/nonsense")).toEqual({ name: "landing" });
    expect(parsePath("/l")).toEqual({ name: "landing" }); // no league id
  });

  it("reads an invite link, with and without a code", () => {
    // The texted-to-you flow. /join with no code is still the redeem screen.
    expect(parsePath("/join/ABC123-DEF4567890")).toEqual({ name: "join", code: "ABC123-DEF4567890" });
    expect(parsePath("/join")).toEqual({ name: "join", code: "" });
  });

  it("decodes a percent-encoded code", () => {
    expect(parsePath("/join/AB%20CD").code).toBe("AB CD");
  });

  it("ignores trailing and doubled slashes", () => {
    expect(parsePath("/l/abc/comm/")).toEqual({ name: "league", leagueId: "abc", tab: "comm" });
    expect(parsePath("//l//abc//")).toEqual({ name: "league", leagueId: "abc", tab: DEFAULT_TAB });
  });
});

describe("buildPath", () => {
  it("is the inverse of parsePath for every shape", () => {
    // The two live next to each other precisely so they cannot drift; this is the check.
    const paths = ["/", "/join", "/join/ABC123-DEF4567890", "/l/abc", "/l/abc/comm", "/l/abc/rules", "/l/abc/home"];
    for (const p of paths) expect(buildPath(parsePath(p))).toBe(p);
  });

  it("omits the default tab, so the tidy URL is the one people copy", () => {
    expect(buildPath({ name: "league", leagueId: "abc", tab: DEFAULT_TAB })).toBe("/l/abc");
  });

  it("still names every non-default tab, including the old default", () => {
    /* /l/<id> used to mean the standings. It now means the scoreboard, and the standings
     * need their segment spelled out - which is the one URL this change alters the
     * meaning of, so it is asserted rather than assumed. */
    expect(buildPath({ name: "league", leagueId: "abc", tab: "home" })).toBe("/l/abc/home");
  });

  it("handles a missing route rather than throwing", () => {
    expect(buildPath(null)).toBe("/");
  });

  it("round-trips every tab the app has", () => {
    for (const tab of TABS) {
      expect(parsePath(buildPath({ name: "league", leagueId: "x", tab })).tab).toBe(tab);
    }
  });

  it("knows the tab keys App actually uses, including the one that does not match its label", () => {
    /* REGRESSION. This list started out as the tab LABELS lowercased, so "rosters" was
     * in it and `hub` - the real key behind the "Rosters" button - was not. The URL was
     * written as /hub quite happily and then parsed back as "home", so the address bar
     * and the screen disagreed and a shared link landed on the wrong tab. Nothing threw.
     *
     * Pinned literally rather than imported from App, which would make the two agree by
     * construction and prove nothing. If a tab is added, this fails and asks for both. */
    expect(TABS).toEqual(["home", "myteam", "hub", "results", "rules", "help", "comm"]);
    expect(parsePath("/l/x/hub").tab).toBe("hub");
    /* `help` joined the list with issue #25. It is a real route, not just a nav pill,
     * because the welcome overlay deep-links to it and a link people are told to follow
     * should survive being shared. */
    expect(parsePath("/l/x/help").tab).toBe("help");
  });
});
