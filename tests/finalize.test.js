import { describe, it, expect } from "vitest";
import { finalizeCurrentPeriod, seededRng } from "../src/engine/index.js";
import { dealtState, fillStats, setStats, team } from "./helpers/fixtures.js";

const RNG = () => seededRng(1234);

/** Force a team's starters to a known set of stat lines. */
function scoreTeam(s, teamId, { coach, qb, wr, rb, te, flex }) {
  return setStats(s, teamId, {
    Coach: { result: coach },
    QB: qb,
    WR: wr,
    RB: rb,
    TE: te,
    FLEX: flex,
  });
}

describe("finalizeCurrentPeriod", () => {
  it("errors when there are no teams to finalize", () => {
    const s = dealtState(2, 1);
    s.teams = [];
    const res = finalizeCurrentPeriod(s, RNG());
    expect(res.state).toBeUndefined();
    expect(res.error).toMatch(/No teams to finalize/);
  });

  it("scores starters only, using the configured scoring", () => {
    const s = dealtState(2, 2);
    // yardsPerPoint 10, pointsPerTD 5, coachWin 2
    scoreTeam(s, "team_0", {
      coach: "Win", //  2
      qb: { yards: "250", tds: "2" }, // 25 + 10 = 35
      wr: { yards: "99", tds: "0" }, //  9
      rb: { yards: "40", tds: "1" }, //  4 +  5 =  9
      te: { yards: "0", tds: "0" }, //  0
      flex: { yards: "15", tds: "0" }, //  1
    }); // total 56
    scoreTeam(s, "team_1", {
      coach: "Loss",
      qb: { yards: "10", tds: "0" },
      wr: { yards: "10", tds: "0" },
      rb: { yards: "10", tds: "0" },
      te: { yards: "10", tds: "0" },
      flex: { yards: "10", tds: "0" },
    }); // total 5
    const { state } = finalizeCurrentPeriod(s, RNG());
    const res = state.weeklyResults.find((r) => r.teamId === "team_0");
    expect(res.rawScore).toBe(56);
    expect(res.rank).toBe(1);
    expect(state.weeklyResults.find((r) => r.teamId === "team_1").rawScore).toBe(5);
  });

  it("awards standings points by finish, highest to lowest", () => {
    const s = dealtState(4, 3);
    fillStats(s, s.teams.map((t) => t.id), 3);
    const { state } = finalizeCurrentPeriod(s, RNG());
    const byRank = state.weeklyResults.slice().sort((a, b) => a.rank - b.rank);
    // 4 teams -> [4,3,2,1]
    expect(byRank.map((r) => r.standingsPoints)).toEqual([4, 3, 2, 1]);
  });

  it("honours a standings points override", () => {
    const s = dealtState(3, 4);
    s.standingsPointsOverride = [10, 5, 1];
    fillStats(s, s.teams.map((t) => t.id), 4);
    const { state } = finalizeCurrentPeriod(s, RNG());
    const byRank = state.weeklyResults.slice().sort((a, b) => a.rank - b.rank);
    expect(byRank.map((r) => r.standingsPoints)).toEqual([10, 5, 1]);
  });

  describe("cumulative rollups", () => {
    it("accumulates standings points, week wins, coach wins, TDs and yards", () => {
      const s = dealtState(2, 5);
      scoreTeam(s, "team_0", {
        coach: "Win",
        qb: { yards: "100", tds: "1" },
        wr: { yards: "50", tds: "1" },
        rb: { yards: "30", tds: "0" },
        te: { yards: "20", tds: "0" },
        flex: { yards: "0", tds: "1" },
      });
      scoreTeam(s, "team_1", {
        coach: "Loss",
        qb: { yards: "0", tds: "0" },
        wr: { yards: "0", tds: "0" },
        rb: { yards: "0", tds: "0" },
        te: { yards: "0", tds: "0" },
        flex: { yards: "0", tds: "0" },
      });
      const { state } = finalizeCurrentPeriod(s, RNG());
      const cum = team(state, "team_0").cumulative;
      expect(cum.standingsPoints).toBe(2); // 2 teams -> winner gets 2
      expect(cum.weekWins).toBe(1);
      expect(cum.coachWins).toBe(1);
      expect(cum.totalTDs).toBe(3);
      expect(cum.totalYards).toBe(200);
      // the Coach contributes neither TDs nor yards
      expect(team(state, "team_1").cumulative.coachWins).toBe(0);
      expect(team(state, "team_1").cumulative.weekWins).toBe(0);
    });

    it("adds to existing totals rather than replacing them", () => {
      const s = dealtState(2, 6);
      team(s, "team_0").cumulative = {
        standingsPoints: 10,
        weekWins: 3,
        coachWins: 2,
        totalTDs: 7,
        totalYards: 900,
        bestPlayer: null,
      };
      fillStats(s, ["team_0", "team_1"], 6);
      const { state } = finalizeCurrentPeriod(s, RNG());
      const cum = team(state, "team_0").cumulative;
      expect(cum.standingsPoints).toBeGreaterThan(10);
      expect(cum.totalYards).toBeGreaterThan(900);
      expect(cum.weekWins).toBeGreaterThanOrEqual(3);
    });
  });

  describe("best-player tracking", () => {
    it("records the best single-player score with the period label", () => {
      const s = dealtState(2, 7);
      scoreTeam(s, "team_0", {
        coach: "Loss",
        qb: { yards: "400", tds: "4" }, // 40 + 20 = 60, clearly the best
        wr: { yards: "10", tds: "0" },
        rb: { yards: "10", tds: "0" },
        te: { yards: "10", tds: "0" },
        flex: { yards: "10", tds: "0" },
      });
      fillStats(s, ["team_1"], 7);
      const { state } = finalizeCurrentPeriod(s, RNG());
      const best = team(state, "team_0").cumulative.bestPlayer;
      expect(best.points).toBe(60);
      expect(best.position).toBe("QB");
      expect(best.periodLabel).toBe("Week 1");
      expect(typeof best.name).toBe("string");
    });

    it("only replaces the record when a later period beats it", () => {
      const s = dealtState(2, 8);
      team(s, "team_0").cumulative.bestPlayer = {
        name: "Incumbent",
        position: "WR",
        points: 999,
        periodLabel: "Week 0",
      };
      scoreTeam(s, "team_0", {
        coach: "Win",
        qb: { yards: "100", tds: "1" },
        wr: { yards: "10", tds: "0" },
        rb: { yards: "10", tds: "0" },
        te: { yards: "10", tds: "0" },
        flex: { yards: "10", tds: "0" },
      });
      fillStats(s, ["team_1"], 8);
      const { state } = finalizeCurrentPeriod(s, RNG());
      expect(team(state, "team_0").cumulative.bestPlayer.name).toBe("Incumbent");
      expect(team(state, "team_0").cumulative.bestPlayer.points).toBe(999);
    });
  });

  describe("resetting for the next period", () => {
    it("wipes rosters, stats, schemes and locks, and advances the week", () => {
      const s = dealtState(3, 9);
      s.rosterLocked = true;
      s.lockedPlayerIds = { p1: true };
      s.schemes = { team_0: { type: "noaction" } };
      fillStats(s, s.teams.map((t) => t.id), 9);
      const { state } = finalizeCurrentPeriod(s, RNG());
      expect(state.teams.every((t) => t.roster === null)).toBe(true);
      expect(state.statsEntry).toEqual({});
      expect(state.schemes).toEqual({});
      expect(state.lockedPlayerIds).toEqual({});
      expect(state.rosterLocked).toBe(false);
      expect(state.currentPeriod).toEqual({ type: "week", number: 2, phase: "pre-deal" });
    });

    it("logs a result line naming the winner", () => {
      const s = dealtState(3, 10);
      fillStats(s, s.teams.map((t) => t.id), 10);
      const { state } = finalizeCurrentPeriod(s, RNG());
      const log = state.activityLog.find((e) => e.type === "result");
      expect(log.text).toMatch(/^Week 1 final - /);
      expect(log.text).toMatch(/Winner: /);
    });
  });

  it("does not mutate the state passed in", () => {
    const s = dealtState(3, 11);
    fillStats(s, s.teams.map((t) => t.id), 11);
    const before = JSON.stringify(s);
    finalizeCurrentPeriod(s, RNG());
    expect(JSON.stringify(s)).toBe(before);
  });

  it("treats a missing stat line as zero rather than throwing", () => {
    const s = dealtState(2, 12);
    s.statsEntry = {}; // nobody entered anything
    const { state, error } = finalizeCurrentPeriod(s, RNG());
    expect(error).toBeUndefined();
    expect(state.weeklyResults.every((r) => r.rawScore === 0)).toBe(true);
  });
});
