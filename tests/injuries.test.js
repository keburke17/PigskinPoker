/* OQ-29: the NFL injury report on every player.
 *
 * Four promises, each tested here:
 *   - a reading is dated by when nflverse PUBLISHED it, and only counts as a practice day
 *     if that date is one of the player's three practice days (src/engine/injuries.js);
 *   - a pull replaces the game status, MERGES the practice days, and moves `updated_at`
 *     only when something a manager can see changed (server/injuries.js);
 *   - last week's final report stands in until this week's first one arrives;
 *   - none of it touches the game: the deal still reads `status`, and a team's score is
 *     the same number with or without the report.
 */

import { describe, expect, it } from "vitest";
import { fetchInjuries, parseInjuries } from "../server/feed/nflverse.js";
import * as fixture from "../server/feed/fixture.js";
import { planInjuryRows } from "../server/injuries.js";
import {
  dayLabel,
  gameStatusOf,
  isPlayerAvailable,
  playerInjury,
  practiceCode,
  practiceDays,
  reportDateOf,
  teamPeriodScore,
} from "../src/engine/index.js";
import { hydrateLeague } from "../src/storage/hydrate.js";

/* ------------------------------------------------------------- dating -- */

describe("reportDateOf", () => {
  it("files a morning copy under YESTERDAY'S report - the 2026-10-17 publish held Friday's", () => {
    // 11:33 UTC on Saturday 17 October is 7:33am Eastern.
    expect(reportDateOf("2026-10-17T11:33:31Z")).toBe("2026-10-16");
  });

  it("files an evening copy under today's", () => {
    // 21:30 UTC is 5:30pm Eastern.
    expect(reportDateOf("2026-10-15T21:30:00Z")).toBe("2026-10-15");
  });

  it("works in Eastern time across the clock change, not in UTC", () => {
    // 03:00 UTC on 5 November is 10pm Eastern on the 4th (EST) - still the 4th's report.
    expect(reportDateOf("2026-11-05T03:00:00Z")).toBe("2026-11-04");
  });

  it("says nothing for a time it cannot read", () => {
    expect(reportDateOf(null)).toBeNull();
    expect(reportDateOf("not a time")).toBeNull();
  });
});

describe("practiceDays", () => {
  it("is Wed / Thu / Fri for a Sunday game", () => {
    // Sunday 18 October, 1pm Eastern.
    const days = practiceDays("2026-10-18T17:00:00Z");
    expect(days).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(days.map(dayLabel)).toEqual(["Wed", "Thu", "Fri"]);
  });

  it("is Thu / Fri / Sat for a Monday night game", () => {
    // Monday 19 October 8:15pm Eastern is 00:15 UTC on the 20th - the Eastern date decides.
    expect(practiceDays("2026-10-20T00:15:00Z").map(dayLabel)).toEqual(["Thu", "Fri", "Sat"]);
  });

  it("is Mon / Tue / Wed for a Thursday night game", () => {
    expect(practiceDays("2026-10-16T00:15:00Z").map(dayLabel)).toEqual(["Mon", "Tue", "Wed"]);
  });

  it("is null when the kickoff is not known, which callers read as 'do not filter'", () => {
    expect(practiceDays(null)).toBeNull();
  });
});

describe("the report's own words", () => {
  it("shortens the practice wording, whatever its capitals", () => {
    expect(practiceCode("Did Not Participate In Practice")).toBe("DNP");
    expect(practiceCode("did not participate in practice")).toBe("DNP");
    expect(practiceCode("Limited Participation in Practice")).toBe("LP");
    expect(practiceCode("Full Participation in Practice")).toBe("FP");
    expect(practiceCode("")).toBeNull();
    expect(practiceCode("Out (Definitely Will Not Play)")).toBeNull();
  });

  it("knows the three game statuses and nothing else", () => {
    expect(gameStatusOf("Questionable")).toBe("Questionable");
    expect(gameStatusOf("out")).toBe("Out");
    expect(gameStatusOf("")).toBeNull();
    expect(gameStatusOf("Probable")).toBeNull();
  });
});

/* -------------------------------------------------------------- feed -- */

const CSV = [
  "season,season_type,game_type,team,week,gsis_id,position,full_name,first_name,last_name,report_primary_injury,report_secondary_injury,report_status,practice_primary_injury,practice_secondary_injury,practice_status",
  "2026,REG,REG,BAL,6,00-0034796,QB,Lamar Jackson,Lamar,Jackson,Ankle,,Out,Ankle,,Did Not Participate In Practice",
  "2026,REG,REG,ATL,6,00-0037238,WR,Drake London,Drake,London,,,,Hip,,Limited Participation in Practice",
  "2026,REG,REG,ARI,6,00-0034381,LB,Josh Sweat,Josh,Sweat,,,,Knee,,Full Participation in Practice",
  "2026,REG,REG,BAL,5,00-0034796,QB,Lamar Jackson,Lamar,Jackson,Ankle,,Questionable,Ankle,,Limited Participation in Practice",
].join("\n");

describe("parseInjuries", () => {
  it("keeps the pool's four positions, and the practice injury when there is no game one", () => {
    const rows = parseInjuries(CSV);
    expect(rows.map((r) => r.name)).toEqual(["Lamar Jackson", "Drake London", "Lamar Jackson"]);
    expect(rows[1]).toMatchObject({ week: 6, gameStatus: null, injury: "Hip" });
  });

  it("can be limited to some weeks", () => {
    expect(parseInjuries(CSV, { weeks: [5] }).map((r) => r.week)).toEqual([5]);
  });
});

describe("fetchInjuries", () => {
  it("returns the publish time from Last-Modified", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: (h) => (h === "last-modified" ? "Sat, 17 Oct 2026 11:33:31 GMT" : null) },
      text: async () => CSV,
    });
    const file = await fetchInjuries({ season: 2026, fetchImpl });
    expect(file.publishedAt).toBe("2026-10-17T11:33:31.000Z");
    expect(file.rows).toHaveLength(3);
  });

  it("treats a 404 - no report yet this season - as nobody on it", async () => {
    const file = await fetchInjuries({ season: 2027, fetchImpl: async () => ({ ok: false, status: 404 }) });
    expect(file.rows).toEqual([]);
  });

  it("is an error for anything else", async () => {
    await expect(fetchInjuries({ season: 2026, fetchImpl: async () => ({ ok: false, status: 500 }) })).rejects.toThrow(/500/);
  });
});

describe("the recorded report", () => {
  it("dates a copy for the week asked as that week's Friday evening, so the days land", async () => {
    const file = await fixture.fetchInjuries({ season: 2026, weeks: [1, 2] });
    expect(file.rows.length).toBeGreaterThan(0);
    expect(file.rows.every((r) => r.week === 1 || r.week === 2)).toBe(true);
    expect(dayLabel(reportDateOf(file.publishedAt))).toBe("Fri");
  });
});

/* -------------------------------------------------------------- plan -- */

const lamar = { id: "u-lamar", position: "QB", nfl_team: "Baltimore Ravens", external_ids: { gsis: "00-0034796" } };
const london = { id: "u-london", position: "WR", nfl_team: "Atlanta Falcons", external_ids: { gsis: "00-0037238" } };
const coach = { id: "u-coach", position: "Coach", nfl_team: "Baltimore Ravens", external_ids: {} };
// Week 6: both teams play Sunday 18 October.
const KICKOFFS = {
  6: {
    "Baltimore Ravens": { at: "2026-10-18T17:00:00Z", opp: "CLE", home: false },
    "Atlanta Falcons": { at: "2026-10-18T17:00:00Z", opp: "CHI", home: true },
  },
};
const reading = (overrides) => ({
  week: 6, gsis: "00-0034796", team: "BAL", position: "QB", name: "Lamar Jackson",
  gameStatus: null, injury: "Ankle", practice: "Did Not Participate In Practice", ...overrides,
});
const plan = (over) =>
  planInjuryRows({
    players: [lamar, london, coach],
    feedRows: [],
    existing: [],
    weeks: [5, 6],
    kickoffsByWeek: KICKOFFS,
    publishedAt: "2026-10-15T21:30:00Z", // Thursday evening: Thursday's report
    at: "2026-10-15T22:00:00Z",
    leagueId: "L",
    seasonId: "S",
    ...over,
  });

describe("planInjuryRows", () => {
  it("writes a row for a player on the report, dated on the report's day", () => {
    const { rows, report } = plan({ feedRows: [reading()] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      player_id: "u-lamar", nfl_week: 6, game_status: null, injury: "Ankle",
      practice: { "2026-10-15": "DNP" }, report_date: "2026-10-15", updated_at: "2026-10-15T22:00:00Z",
    });
    expect(report).toMatchObject({ matched: 1, changed: 1, reportDate: "2026-10-15" });
  });

  it("never writes a head coach, and never a player the report does not name", () => {
    const { rows } = plan({ feedRows: [reading()] });
    expect(rows.map((r) => r.player_id)).toEqual(["u-lamar"]);
  });

  it("KEEPS Wednesday when Thursday's reading arrives - the file only holds the latest day", () => {
    const wednesday = {
      season_id: "S", player_id: "u-lamar", league_id: "L", nfl_week: 6, game_status: null,
      injury: "Ankle", practice: { "2026-10-14": "DNP" }, report_date: "2026-10-14", updated_at: "2026-10-14T22:00:00Z",
    };
    const { rows } = plan({ feedRows: [reading({ practice: "Limited Participation in Practice" })], existing: [wednesday] });
    expect(rows[0].practice).toEqual({ "2026-10-14": "DNP", "2026-10-15": "LP" });
  });

  it("REPLACES the game status - a Saturday downgrade turns QUES into OUT", () => {
    const friday = {
      season_id: "S", player_id: "u-lamar", league_id: "L", nfl_week: 6, game_status: "Questionable",
      injury: "Ankle", practice: { "2026-10-16": "LP" }, report_date: "2026-10-16", updated_at: "2026-10-16T22:00:00Z",
    };
    const { rows } = plan({
      feedRows: [reading({ gameStatus: "Out", practice: "Limited Participation in Practice" })],
      existing: [friday],
      publishedAt: "2026-10-17T21:00:00Z",
      at: "2026-10-17T21:30:00Z",
    });
    expect(rows[0].game_status).toBe("Out");
    expect(rows[0].updated_at).toBe("2026-10-17T21:30:00Z");
  });

  it("records no practice day for a reading dated outside his three days - a Sunday republish", () => {
    const { rows } = plan({ feedRows: [reading()], publishedAt: "2026-10-18T11:30:00Z", at: "2026-10-18T12:00:00Z" });
    // 7:30am Sunday is Saturday's report, and a Sunday game's days are Wed-Fri.
    expect(rows[0].practice).toEqual({});
  });

  it("does not filter at all when the week's kickoffs are not known", () => {
    const { rows } = plan({ feedRows: [reading()], kickoffsByWeek: {} });
    expect(rows[0].practice).toEqual({ "2026-10-15": "DNP" });
  });

  it("leaves updated_at alone when the same report is read again - the dot must not relight", () => {
    const first = plan({ feedRows: [reading()] }).rows[0];
    const again = plan({ feedRows: [reading()], existing: [first], at: "2026-10-16T01:00:00Z" });
    expect(again.rows[0].updated_at).toBe(first.updated_at);
    expect(again.report.changed).toBe(0);
  });

  it("uses the time it looked when the file has no publish time", () => {
    const { rows } = plan({ feedRows: [reading()], publishedAt: null, at: "2026-10-15T22:00:00Z" });
    expect(rows[0].report_date).toBe("2026-10-15");
  });

  it("only writes the weeks asked for", () => {
    const { rows } = plan({ feedRows: [reading({ week: 4 })] });
    expect(rows).toEqual([]);
  });
});

/* --------------------------------------------------------- the screen -- */

const KO = { "Baltimore Ravens": { at: "2026-10-18T17:00:00Z", opp: "CLE", home: false } };
const stateWith = ({ nflWeek = 6, injuries = {}, kickoffs = KO } = {}) => ({
  _meta: { nflWeek, injuries, kickoffs },
});
const view = { id: "lamar", position: "QB", team: "Baltimore Ravens" };

describe("playerInjury", () => {
  it("is null for a player not on the report, and for a coach", () => {
    expect(playerInjury(stateWith(), view)).toBeNull();
    expect(playerInjury(stateWith({ injuries: { c: { 6: { status: "Out" } } } }), { id: "c", position: "Coach" })).toBeNull();
  });

  it("draws his three practice days, with a dash for one not reported yet", () => {
    const info = playerInjury(
      stateWith({ injuries: { lamar: { 6: { status: null, injury: "Ankle", practice: { "2026-10-14": "DNP", "2026-10-15": "LP" }, reportDate: "2026-10-15" } } } }),
      view
    );
    expect(info.days.map((d) => [d.label, d.code])).toEqual([["Wed", "DNP"], ["Thu", "LP"], ["Fri", null]]);
    expect(info).toMatchObject({ status: null, pill: null, isFinal: false, lastWeek: false });
  });

  it("puts QUES / DOUBT / OUT on the pill once there is a game status", () => {
    const at = (status) =>
      playerInjury(stateWith({ injuries: { lamar: { 6: { status, practice: {} } } } }), view).pill;
    expect([at("Questionable"), at("Doubtful"), at("Out")]).toEqual(["QUES", "DOUBT", "OUT"]);
  });

  it("stands last week's final report in until this week's first one exists", () => {
    const state = stateWith({ injuries: { lamar: { 5: { status: "Out", injury: "Ankle", practice: { "2026-10-09": "DNP" } } } } });
    expect(playerInjury(state, view)).toMatchObject({ status: "Out", lastWeek: true, nflWeek: 5 });
  });

  it("drops last week's the moment ANYONE is on this week's - he is off the new report", () => {
    const state = stateWith({
      injuries: {
        lamar: { 5: { status: "Out", practice: {} } },
        other: { 6: { status: "Questionable", practice: {} } },
      },
    });
    expect(playerInjury(state, view)).toBeNull();
  });
});

/* --------------------------------------------- nothing plays from it -- */

describe("hydrate", () => {
  const rows = (extra) => ({
    leagues: [{ id: "L", name: "Test" }],
    seasons: [{ id: "S", league_id: "L", year: 2026, lineup_lock: "gametime" }],
    teams: [{ id: "t1", league_id: "L", legacy_id: "team_1", name: "One", active: true }],
    players: [
      { id: "u-qb", league_id: "L", legacy_id: "qb", name: "Q", position: "QB", nfl_team: "Buffalo Bills", status: "Active", active: true },
    ],
    periods: [{ id: "P", season_id: "S", type: "week", number: 1, phase: "stats", nfl_week: 1, roster_locked: true }],
    team_totals: [],
    roster_slots: [{ period_id: "P", team_id: "t1", area: "starter", slot: "QB", player_id: "u-qb" }],
    stat_lines: [{ period_id: "P", team_id: "t1", slot: "QB", player_id: "u-qb", pass_yards: 200, pass_tds: 1 }],
    schemes: [],
    period_results: [],
    events: [],
    ...extra,
  });
  const OUT = {
    player_injuries: [
      { season_id: "S", player_id: "u-qb", nfl_week: 1, game_status: "Out", injury: "Knee", practice: { "2026-09-11": "DNP" }, report_date: "2026-09-11", updated_at: "2026-09-11T22:00:00Z" },
      { season_id: "other", player_id: "u-qb", nfl_week: 1, game_status: "Questionable" },
    ],
  };

  it("carries the report into _meta, by legacy id and week", () => {
    const v = hydrateLeague(rows(OUT));
    expect(v._meta.injuries.qb[1]).toMatchObject({ status: "Out", injury: "Knee", practice: { "2026-09-11": "DNP" } });
    expect(Object.keys(v._meta.injuries.qb)).toEqual(["1"]);
  });

  it("loads with no report at all - a database without the table yet", () => {
    expect(hydrateLeague(rows({}))._meta.injuries).toEqual({});
  });

  it("does not change who can be dealt, or anybody's score", () => {
    const without = hydrateLeague(rows({}));
    const withOut = hydrateLeague(rows(OUT));
    const qb = (v) => v.playerPool.find((p) => p.id === "qb");
    expect(qb(withOut).status).toBe("Active");
    expect(isPlayerAvailable(withOut, qb(withOut))).toBe(isPlayerAvailable(without, qb(without)));
    const team = (v) => v.teams.find((t) => t.id === "team_1");
    expect(teamPeriodScore(withOut, team(withOut))).toBe(teamPeriodScore(without, team(without)));
  });
});
