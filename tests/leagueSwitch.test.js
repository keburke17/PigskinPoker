/**
 * Moving between leagues - the blank screen of 2026-09-08.
 *
 * THE BUG, because these assertions only make sense next to it.
 *
 * Scott reported a white screen when he signed in, cured by a reload. It was a crash:
 * React unmounted the whole tree, and `body` has no background of its own - the felt is
 * on `.pp-root` - so what is left is the browser's blank page. Three things had to line
 * up, and getting a second league lined the last one up for him:
 *
 *   1. The store is BUILT from the URL you arrived at (App.jsx, useMemo with no deps).
 *      Arrive at `/` and it has no league pinned, so `loadLeague` falls back to scanning
 *      - and with two leagues visible it cannot choose. It says so, and that answer is
 *      not a league.
 *   2. On the landing page there is no league for `whoami` to ask about, so it 401s and
 *      App keeps the role it already had - correct for a blip, and here it means the
 *      role left in localStorage by the last league is still on screen.
 *   3. Tapping a league re-renders BEFORE the effect that repoints the store has run.
 *      The URL says league B, the state in hand is A's or nobody's, and a truthy role
 *      walks the render past the sign-in gate into `state.teams.find(...)`.
 *
 * `state.teams` was undefined. As commissioner it died one line further on, in
 * `currentPeriod.phase`, which is the same bug wearing a different stack.
 *
 * WHAT IS COVERED HERE: the two predicates the fix turns on, and the store no longer
 * naming a league it has not read yet. The render gate in App.jsx that consumes the
 * first predicate is NOT covered - this suite has no DOM (vite.config.js sets
 * `environment: "node"`), and it is not worth a jsdom dependency in a bug fix. It was
 * checked by hand against the real stack, both roles, before and after.
 */

import { describe, it, expect, afterEach } from "vitest";
import { isAmbiguousRead, viewLeagueId } from "../src/storage/types.js";
import { createSupabaseStore } from "../src/storage/supabase.js";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountBar, LeagueSwitcher } from "../src/components/atoms.jsx";

const LEAGUE = "8ea81188-8bb6-5aae-bef2-fba50410aa24";

describe("an ambiguous read is not a league", () => {
  it("recognises the shape the store returns when it cannot choose", () => {
    const read = { _ambiguous: [{ id: "a", name: "One" }, { id: "b", name: "Two" }] };
    expect(isAmbiguousRead(read)).toBe(true);
  });

  it("does not mistake a real league for one", () => {
    /* The field that killed it. A view always has teams; the refusal never does. */
    expect(isAmbiguousRead({ teams: [], _meta: { leagueId: LEAGUE } })).toBe(false);
  });

  it("does not mistake nothing for one - that is the no-league screen's answer", () => {
    expect(isAmbiguousRead(null)).toBe(false);
    expect(isAmbiguousRead(undefined)).toBe(false);
  });
});

describe("a view knows which league it describes", () => {
  it("reports the league it was hydrated from", () => {
    expect(viewLeagueId({ teams: [], _meta: { leagueId: LEAGUE } })).toBe(LEAGUE);
  });

  it("reports null for an empty view, so an unloaded screen never claims a league", () => {
    expect(viewLeagueId(null)).toBe(null);
  });

  it("reports null for a refusal to choose", () => {
    /* This is the comparison the render gate makes. Anything but the league in the URL
     * has to mean "not yet", or the crash is back. */
    expect(viewLeagueId({ _ambiguous: [{ id: "a", name: "One" }] })).toBe(null);
    expect(viewLeagueId({ _ambiguous: [] }) === LEAGUE).toBe(false);
  });
});

describe("the store names its league from the moment it is built", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  /** Capture what the next server call posts, without letting it leave the machine. */
  function captureOneCall() {
    const sent = [];
    globalThis.fetch = async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    return sent;
  }

  it("asks whoami about the pinned league without waiting for the first read", async () => {
    /* THE RACE. `call()` reads the league synchronously, and the id used to be assigned
     * only once the league read came back - so on a fresh /l/<id> load, whoami went out
     * naming no league about half the time. verifySession cannot resolve a role without
     * one, so the answer was 401, which App reads as "a blip, keep what we had". What it
     * kept was the previous league's role. No read is performed here on purpose: that is
     * exactly the window this is about. */
    const store = createSupabaseStore({
      url: "http://127.0.0.1:54321",
      publishableKey: "sb_publishable_not_a_real_key",
      leagueId: LEAGUE,
    });
    const sent = captureOneCall();

    await store.whoami();

    expect(sent).toHaveLength(1);
    expect(sent[0].action).toBe("whoami");
    expect(sent[0].params.leagueId).toBe(LEAGUE);
  });

  it("still names nothing when nothing was pinned - the landing page has no league", async () => {
    const store = createSupabaseStore({
      url: "http://127.0.0.1:54321",
      publishableKey: "sb_publishable_not_a_real_key",
    });
    const sent = captureOneCall();

    await store.whoami();

    expect(sent[0].params.leagueId).toBe(null);
  });
});

/* The switcher in the header (2026-10-28). Before it, Log Out was the only way from one
 * league to another, and signing back in costs a magic link. No DOM here, so the select's
 * own onChange is called directly - that is the whole of what a pick does. */
describe("the league switcher", () => {
  const leagues = [
    { id: "a", name: "Sunday Crew", role: "manager", teamName: "Gridiron Gang" },
    { id: "b", name: "Weekly Table", role: "commissioner" },
  ];

  it("lists every league by the team held there, with the current one chosen", () => {
    const html = renderToStaticMarkup(
      React.createElement(LeagueSwitcher, { leagues, currentLeagueId: "b", onSwitchLeague: () => {} }),
    );
    expect(html).toContain("Sunday Crew - Gridiron Gang");
    expect(html).toContain("Weekly Table - Commissioner");
    expect(html).toContain("All leagues...");
    expect(html).toMatch(/<option value="b" selected="">/);
  });

  it("draws nothing with one league, since there is nowhere to switch to", () => {
    const el = LeagueSwitcher({ leagues: leagues.slice(0, 1), currentLeagueId: "a", onSwitchLeague: () => {} });
    expect(el).toBeNull();
  });

  it("moves to the league picked, and to the landing page for All leagues", () => {
    const went = [];
    let home = 0;
    const el = LeagueSwitcher({ leagues, currentLeagueId: "a", onSwitchLeague: (id) => went.push(id), onAllLeagues: () => { home++; } });
    el.props.onChange({ target: { value: "b" } });
    el.props.onChange({ target: { value: "a" } }); // already here - no reload
    el.props.onChange({ target: { value: "__all__" } });
    expect(went).toEqual(["b"]);
    expect(home).toBe(1);
  });

  it("rides in the account bar, which still says whose account it is", () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountBar, {
        account: { email: "scott@example.test" }, accountChecked: true,
        leagues, currentLeagueId: "a", onSwitchLeague: () => {},
      }),
    );
    expect(html).toContain("Signed in as scott@example.test");
    expect(html).toContain('aria-label="Switch league"');
  });
});
