/* OQ-28: bench and free-agent points, and season averages.
 *
 * Three promises, each tested here:
 *   - every pool player's line is kept, every week, and a week he did not play is NO
 *     ROW rather than a zero (server/stats.js planSeasonLines);
 *   - the average is by games played, over finished weeks only (src/engine/playerPoints.js);
 *   - none of it scores anything: a team's week is the same number with or without it.
 */

import { describe, expect, it } from "vitest";
import { fetchSeasonStats, seasonResultsFrom } from "../server/feed/nflverse.js";
import { planSeasonLines } from "../server/stats.js";
import {
  DEFAULT_SCORING,
  playerSeasonAverage,
  playerWeekLine,
  playerWeekPoints,
  teamPeriodScore,
} from "../src/engine/index.js";
import { hydrateLeague } from "../src/storage/hydrate.js";

const CSV = [
  "player_id,player_display_name,position,team,season,week,season_type,passing_yards,passing_tds,rushing_yards,rushing_tds,receiving_yards,receiving_tds",
  "00-0001,A QB,QB,BUF,2026,1,REG,250,2,10,0,0,0",
  "00-0001,A QB,QB,BUF,2026,3,REG,300,3,0,0,0,0",
  "00-0002,B WR,WR,BUF,2026,2,REG,0,0,0,0,91,1",
  "00-0002,B WR,WR,BUF,2026,4,REG,0,0,0,0,40,0",
  "00-0003,Pre QB,QB,BUF,2026,1,PRE,999,9,0,0,0,0",
].join("\n");

const textFetch = (text) => async () => ({ ok: true, text: async () => text });

describe("fetchSeasonStats", () => {
  it("keeps every regular-season week up to the one asked for, and nothing after", async () => {
    const { lines } = await fetchSeasonStats({ season: 2026, throughWeek: 3, fetchImpl: textFetch(CSV) });
    expect(lines.map((l) => [l.gsis, l.week])).toEqual([
      ["00-0001", 1],
      ["00-0001", 3],
      ["00-0002", 2],
    ]);
  });
});

describe("seasonResultsFrom", () => {
  it("splits the games file into one result map per week, skipping unplayed games", () => {
    const rows = [
      { season: "2026", week: "1", home_team: "BUF", away_team: "MIA", home_score: "24", away_score: "20" },
      { season: "2026", week: "2", home_team: "MIA", away_team: "BUF", home_score: "", away_score: "" },
    ];
    const byWeek = seasonResultsFrom(rows, { season: 2026, throughWeek: 2 });
    expect([...byWeek.keys()]).toEqual([1]);
    expect(byWeek.get(1).get("Buffalo Bills")).toBe("Win");
  });
});

describe("planSeasonLines", () => {
  const players = [
    { id: "p-qb", position: "QB", external_ids: { gsis: "00-0001" } },
    { id: "p-wr", position: "WR", external_ids: { gsis: "00-0002" } },
    { id: "p-none", position: "RB", external_ids: {} },
    { id: "p-coach", position: "Coach", nfl_team: "Buffalo Bills" },
  ];
  const feedLines = [
    { gsis: "00-0001", week: 1, passYards: 250, passTds: 2, rushYards: 10, rushTds: 0, recYards: 0, recTds: 0 },
    { gsis: "00-0001", week: 1, passYards: 250, passTds: 2, rushYards: 10, rushTds: 0, recYards: 0, recTds: 0 },
    { gsis: "00-0002", week: 2, passYards: 0, passTds: 0, rushYards: 0, rushTds: 0, recYards: 91, recTds: 1 },
  ];
  const byWeek = new Map([[1, new Map([["Buffalo Bills", "Win"]])]]);
  const rows = planSeasonLines({ players, feedLines, byWeek, leagueId: "L", seasonId: "S", at: "t" });

  it("writes one row per player per week he played - a duplicate in the file is one row", () => {
    expect(rows.map((r) => [r.player_id, r.nfl_week]).sort()).toEqual([
      ["p-coach", 1],
      ["p-qb", 1],
      ["p-wr", 2],
    ]);
  });

  it("writes NO row for a week he did not play, rather than a zero", () => {
    expect(rows.find((r) => r.player_id === "p-qb" && r.nfl_week === 2)).toBeUndefined();
    expect(rows.find((r) => r.player_id === "p-none")).toBeUndefined();
  });

  it("puts the numbers in the split columns, and a coach's result in coach_result", () => {
    const qb = rows.find((r) => r.player_id === "p-qb");
    expect(qb).toMatchObject({ season_id: "S", league_id: "L", pass_yards: 250, pass_tds: 2, rush_yards: 10, coach_result: null });
    expect(rows.find((r) => r.player_id === "p-coach").coach_result).toBe("Win");
  });
});

/* ------------------------------------------------------------ the engine -- */

function stateWith({ weeks, nflWeek, phase = "stats" }) {
  return {
    scoringConfig: { ...DEFAULT_SCORING },
    currentPeriod: { type: "week", number: 4, phase },
    teams: [],
    statsEntry: {},
    playerPool: [],
    _meta: { nflWeek, playerWeeks: weeks },
  };
}

const qb = { id: "qb", position: "QB" };
const line = (passYards, passTds) => ({ passYards, passTds, rushYards: 0, rushTds: 0, recYards: 0, recTds: 0 });

describe("playerSeasonAverage", () => {
  it("averages by games played - a missing week does not count as a zero", () => {
    // 250 yds 2 TD and 300 yds 3 TD, with week 2 a bye.
    const state = stateWith({ nflWeek: 4, weeks: { qb: { 1: line(250, 2), 3: line(300, 3) } } });
    const one = playerWeekPoints({ ...state, _meta: { ...state._meta, nflWeek: 1 } }, qb);
    const three = playerWeekPoints({ ...state, _meta: { ...state._meta, nflWeek: 3 } }, qb);
    expect(playerSeasonAverage(state, qb)).toEqual({ avg: Math.round(((one + three) / 2) * 10) / 10, games: 2 });
  });

  it("leaves the current week out until the league finalizes it", () => {
    const weeks = { qb: { 1: line(250, 2), 4: line(0, 0) } };
    expect(playerSeasonAverage(stateWith({ nflWeek: 4, weeks }), qb).games).toBe(1);
    expect(playerSeasonAverage(stateWith({ nflWeek: 4, weeks, phase: "finalized" }), qb).games).toBe(2);
  });

  it("is null for a player with no finished games, and for a league with no history at all", () => {
    expect(playerSeasonAverage(stateWith({ nflWeek: 1, weeks: { qb: { 1: line(250, 2) } } }), qb)).toBeNull();
    expect(playerSeasonAverage({ ...stateWith({ nflWeek: 1, weeks: {} }), _meta: {} }, qb)).toBeNull();
  });

  it("averages a coach on his results", () => {
    const coach = { id: "c", position: "Coach" };
    const state = stateWith({ nflWeek: 3, weeks: { c: { 1: { result: "Win" }, 2: { result: "Loss" } } } });
    const expected = (DEFAULT_SCORING.coachWin + DEFAULT_SCORING.coachLoss) / 2;
    expect(playerSeasonAverage(state, coach)).toEqual({ avg: Math.round(expected * 10) / 10, games: 2 });
  });
});

describe("playerWeekPoints", () => {
  it("prices this week's line, and is null when he has none", () => {
    const state = stateWith({ nflWeek: 3, weeks: { qb: { 3: line(300, 3) } } });
    expect(playerWeekLine(state, qb)).toEqual(line(300, 3));
    expect(playerWeekPoints(state, qb)).toBeGreaterThan(0);
    expect(playerWeekPoints(stateWith({ nflWeek: 2, weeks: { qb: { 3: line(300, 3) } } }), qb)).toBeNull();
  });
});

/* -------------------------------------------- nothing scores from it -- */

describe("hydrate", () => {
  const rows = (extra) => ({
    leagues: [{ id: "L", name: "Test" }],
    seasons: [{ id: "S", league_id: "L", year: 2026, lineup_lock: "gametime" }],
    teams: [{ id: "t1", league_id: "L", legacy_id: "team_1", name: "One", active: true }],
    players: [
      { id: "u-qb", league_id: "L", legacy_id: "qb", name: "Q", position: "QB", nfl_team: "Buffalo Bills", status: "Active", active: true },
      { id: "u-wr", league_id: "L", legacy_id: "wr", name: "W", position: "WR", nfl_team: "Buffalo Bills", status: "Active", active: true },
    ],
    periods: [{ id: "P", season_id: "S", type: "week", number: 1, phase: "stats", nfl_week: 1, roster_locked: true }],
    team_totals: [],
    roster_slots: [
      { period_id: "P", team_id: "t1", area: "starter", slot: "QB", player_id: "u-qb" },
      { period_id: "P", team_id: "t1", area: "bench", bench_index: 0, player_id: "u-wr" },
    ],
    stat_lines: [{ period_id: "P", team_id: "t1", slot: "QB", player_id: "u-qb", pass_yards: 200, pass_tds: 1 }],
    schemes: [],
    period_results: [],
    events: [],
    ...extra,
  });

  it("carries every player's week lines into _meta, by legacy id and week", () => {
    const view = hydrateLeague(
      rows({
        player_week_lines: [
          { season_id: "S", player_id: "u-wr", nfl_week: 1, rec_yards: 140, rec_tds: 2 },
          { season_id: "other", player_id: "u-wr", nfl_week: 1, rec_yards: 1 },
        ],
      })
    );
    expect(view._meta.playerWeeks.wr[1]).toMatchObject({ recYards: 140, recTds: 2, passYards: "" });
    expect(Object.keys(view._meta.playerWeeks.wr)).toEqual(["1"]);
  });

  it("loads with no week lines at all - a database without the table yet", () => {
    expect(hydrateLeague(rows({}))._meta.playerWeeks).toEqual({});
  });

  it("does not move the team's score - a bench player's big week counts for nothing", () => {
    const without = hydrateLeague(rows({}));
    const withBench = hydrateLeague(
      rows({ player_week_lines: [{ season_id: "S", player_id: "u-wr", nfl_week: 1, rec_yards: 140, rec_tds: 2 }] })
    );
    const team = (v) => v.teams.find((t) => t.id === "team_1");
    expect(playerWeekPoints(withBench, withBench.playerPool.find((p) => p.id === "wr"))).toBeGreaterThan(0);
    expect(teamPeriodScore(withBench, team(withBench))).toBe(teamPeriodScore(without, team(without)));
  });
});
