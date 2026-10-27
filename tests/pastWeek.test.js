/**
 * Going back a week on the Rosters tab (Scott, 2026-10-27).
 *
 * A finished week's rosters and stat lines are kept by the database; these tests pin that
 * hydrate hands them over in `_meta.pastPeriods`, and that pastWeekState turns one back
 * into a view that scores exactly as the week did when it was being played.
 */

import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { createDemoLeague } from "../src/storage/demoLeague.js";
import { decomposeLeague } from "../src/storage/decompose.js";
import { hydrateLeague } from "../src/storage/hydrate.js";
import { teamPeriodScore } from "../src/engine/index.js";
import { isPastWeek, pastRosterPeriods, pastWeekState } from "../src/components/pastWeek.js";

const hashCode = (c) => crypto.createHash("sha256").update("test:" + c).digest("hex");

/* The demo league's week, finalized, with the next week opened and not yet dealt - the
 * Tuesday morning the screen is for. */
function weekFinalizedAndNextOpened() {
  const original = createDemoLeague();
  const db = decomposeLeague(original, { leagueKey: "test", year: 2026, hashCode });
  const played = db.periods.find(
    (p) => p.type === original.currentPeriod.type && p.number === original.currentPeriod.number
  );
  played.phase = "finalized";
  played.nfl_week = 7;
  played.kickoffs = { "Detroit Lions": { at: "2026-10-18T17:00:00Z", opp: "MIN", home: true } };
  db.periods.push({
    ...played,
    id: "00000000-0000-4000-8000-00000000abcd",
    number: played.number + 1,
    phase: "pre-deal",
    nfl_week: 8,
    kickoffs: {},
  });
  return { original, state: hydrateLeague(db) };
}

describe("past weeks on the Rosters tab", () => {
  const { original, state } = weekFinalizedAndNextOpened();

  it("hydrate keeps the finished week's rosters and stat lines", () => {
    expect(state.currentPeriod.number).toBe(original.currentPeriod.number + 1);
    expect(state.teams.every((t) => t.roster === null)).toBe(true);
    const pages = pastRosterPeriods(state);
    expect(pages.map((p) => p.number)).toEqual([original.currentPeriod.number]);
    original.teams.forEach((t) => {
      expect(pages[0].rosters[t.id]).toEqual(t.roster);
    });
    expect(pages[0].nflWeek).toBe(7);
  });

  it("a past week scores exactly as it did when it was played", () => {
    const past = pastWeekState(state, pastRosterPeriods(state)[0]);
    expect(isPastWeek(past)).toBe(true);
    expect(isPastWeek(state)).toBe(false);
    expect(past.currentPeriod).toEqual({ ...original.currentPeriod, phase: "finalized" });
    expect(past._meta.nflWeek).toBe(7);
    expect(past._meta.kickoffs["Detroit Lions"].opp).toBe("MIN");
    original.teams.forEach((t) => {
      const back = past.teams.find((x) => x.id === t.id);
      expect(back.roster).toEqual(t.roster);
      expect(teamPeriodScore(past, back)).toBe(teamPeriodScore(original, t));
    });
  });

  it("leaves the live view alone", () => {
    pastWeekState(state, pastRosterPeriods(state)[0]);
    expect(state.teams.every((t) => t.roster === null)).toBe(true);
    expect(state._meta.nflWeek).toBe(8);
    expect(state._meta.pastWeek).toBeUndefined();
  });

  it("offers nothing to go back to before a week has finished", () => {
    const fresh = hydrateLeague(decomposeLeague(createDemoLeague(), { leagueKey: "test", year: 2026, hashCode }));
    expect(pastRosterPeriods(fresh)).toEqual([]);
    expect(pastWeekState(fresh, fresh.currentPeriod)).toBeNull();
  });
});
