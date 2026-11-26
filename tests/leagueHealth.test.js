/* The hourly league checker's rules (server/leagueHealth.js). Each case is a state that
 * really happened, or the shape of a step that stopped halfway. */
import { describe, expect, it } from "vitest";
import { findLeagueProblems, resultsFromSeasonGames } from "../server/leagueHealth.js";

const ET = "America/New_York";
const league = {
  id: "L1", name: "Sunday Crew", mode: "season", tz: ET,
  auto_process_schemes: true, auto_advance_week: true,
};
const season = { id: "S1", year: 2026, playoff_completed: false };

/* NFL weeks 11-13 of 2026, two games each, as fetchSeasonGames returns them. */
const g = (week, home, away, kickoff, hs = null, as = null) =>
  ({ week, home, away, kickoff, homeScore: hs, awayScore: as });
const games = [
  g(11, "DAL", "NYG", "2026-11-22T18:00:00Z", 24, 17),
  g(11, "KC", "DEN", "2026-11-24T01:15:00Z", 20, 20),
  g(12, "DAL", "NYG", "2026-11-26T01:15:00Z"), // Wed night
  g(12, "KC", "DEN", "2026-11-29T18:00:00Z"),
  g(13, "DAL", "NYG", "2026-12-04T01:15:00Z"),
  g(13, "KC", "DEN", "2026-12-06T18:00:00Z"),
];
const WED_NOON = Date.parse("2026-11-25T17:00:00Z");
const kickoffsWeek12 = {
  "Dallas Cowboys": { at: "2026-11-26T01:15:00Z" }, "New York Giants": { at: "2026-11-26T01:15:00Z" },
  "Kansas City Chiefs": { at: "2026-11-29T18:00:00Z" }, "Denver Broncos": { at: "2026-11-29T18:00:00Z" },
};

const week = (n, over = {}) => ({
  id: "P" + n, season_id: "S1", type: "week", number: n, nfl_week: n,
  phase: "finalized", dealt_at: "2026-11-1" + (n % 10) + "T11:00:00Z", deal_seed: "s" + n,
  finalized_at: null, ...over,
});
const kinds = (out) => out.map((p) => p.kind).sort();

describe("the Week 12 incident, exactly", () => {
  /* Week 12 finalized undealt, everyone on 0; Week 13 dealt against NFL week 13. */
  const periods = [
    week(11),
    week(12, { dealt_at: null, deal_seed: null }),
    week(13, { phase: "dealt", dealt_at: "2026-11-24T11:05:00Z" }),
  ];
  const out = findLeagueProblems({
    league, season, periods, current: periods[2],
    lastResults: [{ raw_score: 0 }, { raw_score: 0 }, { raw_score: 0 }],
    teamCount: 3, games, now: WED_NOON,
  });

  it("reports the empty week and the week dealt early", () => {
    expect(kinds(out)).toEqual(["ahead_of_nfl", "empty_week"]);
  });
  it("says so in words the admins can act on", () => {
    expect(out.find((p) => p.kind === "empty_week").message).toMatch(/Week 12 .*every team on 0.*never dealt/);
    expect(out.find((p) => p.kind === "ahead_of_nfl").message).toMatch(/Week 13 .*NFL week 12 still has 2 games/);
  });
  it("keys each problem to its week, so a later week is a new alert", () => {
    expect(out.find((p) => p.kind === "empty_week").key).toBe("P12");
    expect(out.find((p) => p.kind === "ahead_of_nfl").key).toBe("P13");
  });
});

describe("a healthy league says nothing", () => {
  it("Week 12 dealt Tuesday, mid-week", () => {
    const periods = [week(11), week(12, { phase: "dealt", dealt_at: "2026-11-24T11:05:00Z", kickoffs: kickoffsWeek12 })];
    const out = findLeagueProblems({
      league, season, periods, current: periods[1],
      lastResults: [{ raw_score: 101.2 }, { raw_score: 0 }], teamCount: 2, games,
      now: Date.parse("2026-11-25T06:00:00Z"), // 1am ET Wed, before the Wed 3am deadline
    });
    expect(out).toEqual([]);
  });
  it("one team on 0 is a bad week, not a broken one", () => {
    const periods = [week(11), week(12, { phase: "dealt", dealt_at: "2026-11-24T11:05:00Z" })];
    const out = findLeagueProblems({
      league: { ...league, auto_process_schemes: false }, season, periods, current: periods[1],
      lastResults: [{ raw_score: 0 }, { raw_score: 88 }], teamCount: 2, games, now: WED_NOON,
    });
    expect(kinds(out)).toEqual([]);
  });
  it("a Last Digit game is never checked - nothing is dealt there", () => {
    const out = findLeagueProblems({
      league: { ...league, mode: "lastdigit" }, season, periods: [week(1, { phase: "pre-deal" })],
      current: week(1, { phase: "pre-deal" }), games, now: WED_NOON,
    });
    expect(out).toEqual([]);
  });
});

describe("the clock stuck", () => {
  it("schemes not processed two hours after the deadline", () => {
    const periods = [week(11), week(12, { phase: "dealt", dealt_at: "2026-11-24T11:05:00Z", kickoffs: kickoffsWeek12 })];
    // Wednesday-game week: deadline Wed 3am ET (08:00Z). At 10:30Z it is 2.5 hours late.
    const out = findLeagueProblems({
      league, season, periods, current: periods[1], teamCount: 4, games,
      now: Date.parse("2026-11-25T10:30:00Z"),
    });
    expect(kinds(out)).toEqual(["schemes_overdue"]);
  });
  it("but not inside the two-hour grace", () => {
    const periods = [week(11), week(12, { phase: "dealt", dealt_at: "2026-11-24T11:05:00Z", kickoffs: kickoffsWeek12 })];
    const out = findLeagueProblems({
      league, season, periods, current: periods[1], teamCount: 4, games,
      now: Date.parse("2026-11-25T09:30:00Z"),
    });
    expect(out).toEqual([]);
  });
  it("a finished week not finalized by Tuesday morning", () => {
    const kick11 = { "Dallas Cowboys": { at: "2026-11-22T18:00:00Z" }, "Kansas City Chiefs": { at: "2026-11-24T01:15:00Z" } };
    const periods = [week(10), week(11, { phase: "stats", dealt_at: "2026-11-17T11:05:00Z", kickoffs: kick11 })];
    const out = findLeagueProblems({
      league, season, periods, current: periods[1], teamCount: 4, games,
      now: Date.parse("2026-11-24T14:30:00Z"), // 9:30am ET Tue
    });
    expect(kinds(out)).toEqual(["finalize_overdue"]);
  });
  it("no switch, no promise: a manual league is never 'overdue'", () => {
    const periods = [week(11), week(12, { phase: "dealt", dealt_at: "2026-11-24T11:05:00Z", kickoffs: kickoffsWeek12 })];
    const out = findLeagueProblems({
      league: { ...league, auto_process_schemes: false }, season, periods, current: periods[1],
      teamCount: 4, games, now: Date.parse("2026-11-26T12:00:00Z"),
    });
    expect(out).toEqual([]);
  });
});

describe("a step left halfway", () => {
  it("dealt with no deal time saved", () => {
    const periods = [week(11), week(12, { phase: "dealt", dealt_at: null })];
    const out = findLeagueProblems({
      league: { ...league, auto_process_schemes: false }, season, periods, current: periods[1],
      teamCount: 4, games, now: WED_NOON,
    });
    expect(kinds(out)).toEqual(["deal_unrecorded"]);
  });
  it("an open week with no NFL week", () => {
    const periods = [week(11), week(12, { phase: "dealt", nfl_week: null, dealt_at: "2026-11-24T11:05:00Z" })];
    const out = findLeagueProblems({
      league: { ...league, auto_process_schemes: false }, season, periods, current: periods[1],
      teamCount: 4, games, now: WED_NOON,
    });
    expect(kinds(out)).toEqual(["unmapped"]);
  });
  it("the roster email went out before the deal the league kept", () => {
    const periods = [week(11), week(12, { phase: "dealt", dealt_at: "2026-11-24T12:05:00Z" })];
    const out = findLeagueProblems({
      league: { ...league, auto_process_schemes: false }, season, periods, current: periods[1],
      teamCount: 4, games, now: WED_NOON, dealtEmailAt: "2026-11-24T11:05:00Z",
    });
    expect(kinds(out)).toEqual(["email_mismatch"]);
    expect(out[0].message).toMatch(/dealt twice/);
  });
  it("an email a few seconds before the deal is stamped is the same deal", () => {
    const periods = [week(11), week(12, { phase: "dealt", dealt_at: "2026-11-24T11:05:20Z" })];
    const out = findLeagueProblems({
      league: { ...league, auto_process_schemes: false }, season, periods, current: periods[1],
      teamCount: 4, games, now: WED_NOON, dealtEmailAt: "2026-11-24T11:05:00Z",
    });
    expect(out).toEqual([]);
  });
});

describe("behind the NFL", () => {
  it("still open on week 11 after week 12 is over", () => {
    const done = games.map((x) => (x.week === 12 ? { ...x, homeScore: 10, awayScore: 3 } : x));
    const periods = [week(10), week(11, { phase: "stats", dealt_at: "2026-11-17T11:05:00Z" })];
    const out = findLeagueProblems({
      league: { ...league, auto_advance_week: false }, season, periods, current: periods[1],
      teamCount: 4, games: done, now: Date.parse("2026-12-01T12:00:00Z"),
    });
    expect(kinds(out)).toEqual(["behind_nfl"]);
  });
});

describe("resultsFromSeasonGames", () => {
  it("names the teams the way kickoffs do, and leaves unplayed games out", () => {
    const r = resultsFromSeasonGames(games, 11);
    expect(r.get("Dallas Cowboys")).toBe("Win");
    expect(r.get("New York Giants")).toBe("Loss");
    expect(r.get("Kansas City Chiefs")).toBe("Tie");
    expect(resultsFromSeasonGames(games, 12).size).toBe(0);
  });
});
