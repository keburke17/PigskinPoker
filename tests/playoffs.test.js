import { describe, it, expect } from "vitest";
import {
  dealRosters,
  finalizeCurrentPeriod,
  seededRng,
  startPlayoffs,
} from "../src/engine/index.js";
import { baseState, dealtState, fillStats, team } from "./helpers/fixtures.js";

const RNG = (n = 1) => seededRng(1000 + n);

/** Give teams distinct season standings so the bracket order is knowable. */
function withSeasonTotals(s, pointsByTeam) {
  Object.entries(pointsByTeam).forEach(([id, pts]) => {
    team(s, id).cumulative.standingsPoints = pts;
  });
  return s;
}

/** Deal, fill stats, finalize - one whole period. */
function playPeriod(s, seed) {
  const ids =
    s.currentPeriod.type === "playoff" ? s.playoffConfig.activeTeamIds : s.teams.map((t) => t.id);
  const dealt = dealRosters(s, ids, seededRng(seed));
  if (dealt.error) throw new Error(dealt.error);
  Object.entries(dealt.rosters).forEach(([id, roster]) => {
    team(s, id).roster = roster;
  });
  s.currentPeriod.phase = "dealt";
  fillStats(s, ids, seed + 1);
  const res = finalizeCurrentPeriod(s, seededRng(seed + 2));
  if (res.error) throw new Error(res.error);
  return res.state;
}

describe("startPlayoffs", () => {
  it("seeds the bracket by season standings, best first", () => {
    let s = baseState(6);
    s = withSeasonTotals(s, {
      team_0: 5,
      team_1: 40,
      team_2: 12,
      team_3: 33,
      team_4: 1,
      team_5: 27,
    });
    const next = startPlayoffs(s, 4, [4, 2, 1], RNG());
    expect(next.playoffConfig.activeTeamIds).toEqual(["team_1", "team_3", "team_5", "team_2"]);
    expect(next.playoffConfig.started).toBe(true);
    expect(next.playoffConfig.completed).toBe(false);
    expect(next.playoffConfig.champion).toBeNull();
  });

  it("moves to Playoff Round 1 and clears period working state", () => {
    const s = baseState(4);
    const next = startPlayoffs(s, 4, [4, 2, 1], RNG());
    expect(next.currentPeriod).toEqual({ type: "playoff", number: 1, phase: "pre-deal" });
    expect(next.schemes).toEqual({});
    expect(next.statsEntry).toEqual({});
    expect(next.lockedPlayerIds).toEqual({});
    expect(next.rosterLocked).toBe(false);
  });

  it("resets playoff cumulative totals for every team but keeps season totals", () => {
    let s = baseState(4);
    s = withSeasonTotals(s, { team_0: 20 });
    team(s, "team_0").playoffCumulative.standingsPoints = 99;
    const next = startPlayoffs(s, 4, [4, 2, 1], RNG());
    expect(team(next, "team_0").playoffCumulative.standingsPoints).toBe(0);
    expect(team(next, "team_0").cumulative.standingsPoints).toBe(20); // frozen, not wiped
  });

  it("logs the bracket", () => {
    const s = baseState(4);
    const next = startPlayoffs(s, 4, [4, 2, 1], RNG());
    const log = next.activityLog.find((e) => e.type === "playoffs-start");
    expect(log.text).toMatch(/Playoffs started!/);
    expect(log.text).toMatch(/Bracket \(4\)/);
  });
});

describe("playoff advancement", () => {
  it("cuts the field each round and crowns a champion (4 -> 2 -> 1)", () => {
    let s = dealtState(6, 20);
    s.teams.forEach((t) => (t.roster = null));
    s = withSeasonTotals(s, {
      team_0: 6,
      team_1: 5,
      team_2: 4,
      team_3: 3,
      team_4: 2,
      team_5: 1,
    });
    s = startPlayoffs(s, 4, [4, 2, 1], RNG());
    expect(s.playoffConfig.activeTeamIds).toHaveLength(4);

    // Round 1 -> 2 survivors
    s = playPeriod(s, 200);
    expect(s.playoffConfig.completed).toBe(false);
    expect(s.playoffConfig.activeTeamIds).toHaveLength(2);
    expect(s.playoffConfig.currentRoundIndex).toBe(1);
    expect(s.currentPeriod).toEqual({ type: "playoff", number: 2, phase: "pre-deal" });
    const advance = s.activityLog.find((e) => e.type === "advance");
    expect(advance.text).toMatch(/Advancing to Playoff Round 2/);

    // Round 2 -> champion (the last team never plays a round alone)
    s = playPeriod(s, 300);
    expect(s.playoffConfig.completed).toBe(true);
    expect(s.playoffConfig.champion).toBeTruthy();
    expect(s.playoffConfig.activeTeamIds).toHaveLength(2); // frozen at the final field

    const champLog = s.activityLog.find((e) => e.type === "champion");
    expect(champLog.text).toMatch(/wins the Pigskin Poker championship!/);
    const champ = team(s, s.playoffConfig.champion);
    expect(champLog.text).toContain(champ.name);
  });

  it("crowns the winner of the only round when advancement is [2, 1]", () => {
    let s = baseState(4);
    s = withSeasonTotals(s, { team_0: 9, team_1: 8, team_2: 2, team_3: 1 });
    s = startPlayoffs(s, 2, [2, 1], RNG());
    expect(s.playoffConfig.activeTeamIds).toEqual(["team_0", "team_1"]);
    s = playPeriod(s, 400);
    expect(s.playoffConfig.completed).toBe(true);
    expect(["team_0", "team_1"]).toContain(s.playoffConfig.champion);
  });

  it("scores playoff rounds into playoffCumulative, leaving season totals frozen", () => {
    let s = baseState(4);
    s = withSeasonTotals(s, { team_0: 50, team_1: 40, team_2: 30, team_3: 20 });
    s = startPlayoffs(s, 4, [4, 2, 1], RNG());
    const seasonBefore = s.teams.map((t) => t.cumulative.standingsPoints);
    s = playPeriod(s, 500);
    expect(s.teams.map((t) => t.cumulative.standingsPoints)).toEqual(seasonBefore);
    const anyPlayoffPoints = s.teams.some((t) => t.playoffCumulative.standingsPoints > 0);
    expect(anyPlayoffPoints).toBe(true);
  });

  it("labels playoff periods as rounds, not weeks", () => {
    let s = baseState(4);
    s = startPlayoffs(s, 4, [4, 2, 1], RNG());
    s = playPeriod(s, 600);
    const result = s.weeklyResults.find((r) => r.period.type === "playoff");
    expect(result.periodLabel).toBe("Playoff Round 1");
  });

  it("only finalizes the teams still alive in the bracket", () => {
    let s = baseState(6);
    s = withSeasonTotals(s, {
      team_0: 6, team_1: 5, team_2: 4, team_3: 3, team_4: 2, team_5: 1,
    });
    s = startPlayoffs(s, 4, [4, 2, 1], RNG());
    s = playPeriod(s, 700);
    const scored = s.weeklyResults.filter((r) => r.period.type === "playoff");
    expect(scored).toHaveLength(4); // the two eliminated teams produced no rows
    expect(scored.map((r) => r.teamId)).not.toContain("team_5");
  });
});
