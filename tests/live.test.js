/**
 * The live view of the week in progress (issues #29, #30).
 *
 * The whole design claim of the scoreboard is that it is not a second opinion: what it
 * shows mid-week is what the week will actually award, because it makes the same three
 * engine calls finalize makes. These tests are that claim - most of them compare
 * projectCurrentPeriod against finalizeCurrentPeriod on the same state and demand they
 * agree, so a future change to one that does not reach the other fails here rather than
 * on a Sunday night.
 *
 * Deterministic: seeded rng, no clock.
 */

import { describe, it, expect } from "vitest";
import {
  finalizeCurrentPeriod,
  periodScoreRows,
  periodTeams,
  projectCurrentPeriod,
  seededRng,
  teamPeriodScore,
} from "../src/engine/index.js";
import { dealtState, fillStats, setStats, team } from "./helpers/fixtures.js";

const RNG = () => seededRng(1234);
const scored = (n = 4, seed = 3) => {
  const s = dealtState(n, seed);
  fillStats(s, s.teams.map((t) => t.id), seed + 1);
  s.currentPeriod.phase = "schemes-processed";
  return s;
};

describe("teamPeriodScore", () => {
  it("adds up exactly the six starters, and nothing else", () => {
    const s = dealtState(2, 5);
    setStats(s, "team_0", {
      Coach: { result: "Win" }, //  2
      QB: { yards: "250", tds: "2" }, // 25 + 10 = 35
      WR: { yards: "99", tds: "0" }, //  9
      RB: { yards: "40", tds: "1" }, //  4 +  5 =  9
      TE: { yards: "0", tds: "0" }, //  0
      FLEX: { yards: "15", tds: "0" }, //  1
    });
    expect(teamPeriodScore(s, team(s, "team_0"))).toBe(56);
  });

  it("is zero for a team with no roster, rather than throwing", () => {
    const s = dealtState(2, 5);
    team(s, "team_1").roster = null;
    expect(teamPeriodScore(s, team(s, "team_1"))).toBe(0);
  });

  it("counts a slot with no stat line as zero, which is what it will finalize as", () => {
    const s = dealtState(2, 5);
    setStats(s, "team_0", { QB: { yards: "100", tds: "0" } });
    expect(teamPeriodScore(s, team(s, "team_0"))).toBe(10);
  });
});

describe("periodTeams", () => {
  it("is everybody in the regular season", () => {
    const s = dealtState(4, 9);
    expect(periodTeams(s).map((t) => t.id)).toEqual(s.teams.map((t) => t.id));
  });

  it("is only the live bracket in a playoff round", () => {
    const s = dealtState(4, 9);
    s.currentPeriod = { type: "playoff", number: 1, phase: "dealt" };
    s.playoffConfig.activeTeamIds = ["team_1", "team_3"];
    expect(periodTeams(s).map((t) => t.id)).toEqual(["team_1", "team_3"]);
  });
});

describe("projectCurrentPeriod", () => {
  it("gives every team the score finalize gives it", () => {
    const s = scored(5, 11);
    const projected = projectCurrentPeriod(s);
    const { state } = finalizeCurrentPeriod(s, RNG());
    projected.rows.forEach((r) => {
      const actual = state.weeklyResults.find((w) => w.teamId === r.teamId);
      expect(actual.rawScore).toBe(r.rawScore);
    });
  });

  it("gives every team the rank and standings points finalize gives it", () => {
    const s = scored(6, 21);
    const projected = projectCurrentPeriod(s);
    const { state } = finalizeCurrentPeriod(s, RNG());
    projected.rows.forEach((r) => {
      const actual = state.weeklyResults.find((w) => w.teamId === r.teamId);
      expect(actual.rank).toBe(r.rank);
      expect(actual.standingsPoints).toBe(r.standingsPoints);
    });
  });

  it("hands back rows in the order the engine ranked them, not re-sorted", () => {
    /* Ties that rankTeamsWithTiebreak cannot separate keep INPUT order - that is OQ-A, and
     * a screen that re-sorted them would show a different order from the one the week is
     * scored in. */
    const s = scored(5, 33);
    const rows = projectCurrentPeriod(s).rows;
    const ranks = rows.map((r) => r.rank);
    expect(ranks).toEqual(ranks.slice().sort((a, b) => a - b));
  });

  it("respects a standings-points override, exactly as finalize does", () => {
    const s = scored(4, 44);
    s.standingsPointsOverride = [100, 50, 20, 5];
    const projected = projectCurrentPeriod(s);
    expect(projected.rows.map((r) => r.standingsPoints)).toEqual([100, 50, 20, 5]);
    const { state } = finalizeCurrentPeriod(s, RNG());
    projected.rows.forEach((r) => {
      expect(state.weeklyResults.find((w) => w.teamId === r.teamId).standingsPoints)
        .toBe(r.standingsPoints);
    });
  });

  it("only ranks the live bracket in a playoff round", () => {
    const s = scored(4, 55);
    s.currentPeriod = { type: "playoff", number: 1, phase: "schemes-processed" };
    s.playoffConfig.started = true;
    s.playoffConfig.activeTeamIds = ["team_0", "team_2"];
    expect(projectCurrentPeriod(s).rows.map((r) => r.teamId).sort())
      .toEqual(["team_0", "team_2"]);
  });

  it("READS. It does not finalize, and it does not touch the league.", () => {
    /* The one guarantee that matters most: a screen calling this on every render must not
     * be able to advance the week or bank a single standings point. */
    const s = scored(4, 66);
    const before = JSON.stringify(s);
    projectCurrentPeriod(s);
    periodScoreRows(s);
    expect(JSON.stringify(s)).toBe(before);
    expect(s.teams.every((t) => t.cumulative.standingsPoints === 0)).toBe(true);
    expect(s.currentPeriod.phase).toBe("schemes-processed");
    expect(s.weeklyResults).toEqual([]);
  });

  it("has nothing to show before a deal", () => {
    const s = dealtState(3, 77);
    s.teams.forEach((t) => { t.roster = null; });
    expect(projectCurrentPeriod(s).rows.every((r) => r.rawScore === 0)).toBe(true);
  });

  it("returns no rows when no team is playing", () => {
    const s = dealtState(3, 88);
    s.teams = [];
    expect(projectCurrentPeriod(s).rows).toEqual([]);
  });
});
