/* The pool refresh (OQ-4b, 2026-08-28).
 *
 * Two halves, both tested here without a network:
 *   - server/feed/nflverse.js  - parsing the depth chart and building the 224-row pool
 *   - server/pool.js           - deciding what a refresh may and may not change
 *
 * The rule under test throughout: A REFRESH MAY CORRECT ITS OWN WORK AND NOTHING A
 * PERSON DECIDED. See docs/PHASE-4-PLAN.md section 4.
 */

import { describe, expect, it } from "vitest";
import {
  NFL_TEAMS,
  POOL_DEPTH,
  buildPool,
  coachesFromGames,
  currentRosterWeek,
  fetchDepthChart,
  parseCsv,
  parseCsvLine,
  poolStatusOf,
  readLatestSnapshot,
  statusOf,
} from "../server/feed/nflverse.js";
import { POOL_WRITE_CHUNK, normalizeName, planPoolRefresh, poolWriteRows } from "../server/pool.js";

/* A depth chart shaped exactly like nflverse's, newest snapshot first. */
const DEPTH_CSV = [
  "dt,team,player_name,espn_id,gsis_id,pos_grp_id,pos_grp,pos_id,pos_name,pos_abb,pos_slot,pos_rank",
  "2026-08-28T19:13:13Z,BUF,Josh Allen,3918298,00-0034857,21,3WR 1TE,8,Quarterback,QB,9,1",
  "2026-08-28T19:13:13Z,BUF,Mitchell Trubisky,3039707,00-0033869,21,3WR 1TE,8,Quarterback,QB,9,2",
  "2026-08-28T19:13:13Z,BUF,James Cook III,4379399,00-0037248,21,3WR 1TE,9,Running Back,RB,11,1",
  "2026-08-28T19:13:13Z,BUF,Ray Davis,4429501,00-0039875,21,3WR 1TE,9,Running Back,RB,11,2",
  "2026-08-28T19:13:13Z,BUF,Ty Johnson,3122133,00-0035325,21,3WR 1TE,9,Running Back,RB,11,3",
  "2026-08-28T19:13:13Z,BUF,DJ Moore,3915416,00-0034827,21,3WR 1TE,1,Wide Receiver,WR,1,1",
  "2026-08-28T19:13:13Z,BUF,Khalil Shakir,4373678,00-0037261,21,3WR 1TE,1,Wide Receiver,WR,2,2",
  "2026-08-28T19:13:13Z,BUF,Dalton Kincaid,4385690,00-0038933,21,3WR 1TE,7,Tight End,TE,10,1",
  "2026-08-28T19:13:13Z,BUF,Ed Oliver,3929937,00-0035657,16,Base 4-3 D,24,Left Defensive Tackle,LDT,2,1",
  // An older snapshot, which must be ignored entirely.
  "2026-08-21T07:00:00Z,BUF,Somebody Stale,1,00-0000001,21,3WR 1TE,8,Quarterback,QB,9,1",
  "2026-08-21T07:00:00Z,BUF,Also Stale,2,00-0000002,21,3WR 1TE,9,Running Back,RB,11,1",
  "", // real CSV files end with a newline, and the early abort depends on seeing one
].join("\n");

const streamOf = (text) => {
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return {
    getReader() {
      return {
        read: async () => (sent ? { done: true } : ((sent = true), { value: bytes, done: false })),
        cancel: async () => {},
      };
    },
  };
};

describe("reading the depth chart", () => {
  it("parses quoted fields and doubled quotes", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
    expect(parseCsvLine('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
    expect(parseCsvLine("a,,c")).toEqual(["a", "", "c"]);
  });

  it("keeps only the newest snapshot and stops there", async () => {
    let aborted = false;
    const { snapshotAt, rows } = await readLatestSnapshot(streamOf(DEPTH_CSV), {
      onEnough: () => {
        aborted = true;
      },
    });
    expect(snapshotAt).toBe("2026-08-28T19:13:13Z");
    expect(rows.every((r) => r.dt === "2026-08-28T19:13:13Z")).toBe(true);
    expect(rows.some((r) => r.player_name === "Somebody Stale")).toBe(false);
    // The whole point: it does not read the remaining 45MB of the season.
    expect(aborted).toBe(true);
  });

  it("keeps only offensive skill positions, with their ids", async () => {
    const res = { ok: true, body: streamOf(DEPTH_CSV) };
    const { players } = await fetchDepthChart({ season: 2026, fetchImpl: async () => res });
    expect(players.map((p) => p.position).sort()).toEqual(
      ["QB", "QB", "RB", "RB", "RB", "TE", "WR", "WR"].sort()
    );
    expect(players.find((p) => p.name === "Ed Oliver")).toBeUndefined();
    const allen = players.find((p) => p.name === "Josh Allen");
    expect(allen.team).toBe("Buffalo Bills");
    expect(allen.depthRank).toBe(1);
    expect(allen.externalIds).toEqual({ gsis: "00-0034857", espn: "3918298" });
  });

  it("refuses to guess at an NFL team it does not recognise", async () => {
    const csv = DEPTH_CSV.replace(/,BUF,Josh Allen/, ",ZZZ,Josh Allen");
    const res = { ok: true, body: streamOf(csv) };
    const { players } = await fetchDepthChart({ season: 2026, fetchImpl: async () => res });
    expect(players.find((p) => p.name === "Josh Allen")).toBeUndefined();
  });

  it("reports an HTTP failure rather than returning an empty pool", async () => {
    await expect(
      fetchDepthChart({ season: 2026, fetchImpl: async () => ({ ok: false, status: 404 }) })
    ).rejects.toThrow(/404/);
  });
});

describe("head coaches, which depth charts do not carry", () => {
  const GAMES = parseCsv(
    [
      "season,week,away_team,home_team,away_coach,home_coach",
      "2025,1,BUF,NYJ,Old Coach,Jets Coach",
      "2026,1,BUF,NYJ,Sean McDermott,Aaron Glenn",
      "2026,9,BUF,NYJ,Sean McDermott,Interim Guy",
    ].join("\n")
  );

  it("reads them off the requested season", () => {
    const { season, coaches } = coachesFromGames(GAMES, 2026);
    expect(season).toBe("2026");
    expect(coaches.get("Buffalo Bills")).toBe("Sean McDermott");
  });

  it("takes the latest week, so a mid-season replacement is picked up", () => {
    const { coaches } = coachesFromGames(GAMES, 2026);
    expect(coaches.get("New York Jets")).toBe("Interim Guy");
  });

  it("falls back to the newest season present when the schedule is not out yet", () => {
    const { season } = coachesFromGames(GAMES, 2027);
    expect(season).toBe("2026");
  });
});

/* CHANGED 2026-09-04. buildPool used to emit 224 rows including a head coach per team,
 * taken from the coach columns of nflverse's games.csv. It emits 192 now and no coaches
 * at all: Scott read that file's answers on 2026-09-04 - John Harbaugh with the Giants,
 * Todd Monken at Cleveland, Klint Kubiak spelled "Kubliak" - and made head coaches
 * commissioner-maintained (OQ-4d). A league still holds 224 players. The feed is
 * responsible for 192 of them and must not touch the other 32. */
describe("building the pool", () => {
  const everyTeamToDepth = (extra = 2) => {
    const depthPlayers = [];
    for (const team of new Set(Object.values(NFL_TEAMS))) {
      for (const [pos, n] of Object.entries(POOL_DEPTH)) {
        for (let r = 1; r <= n + extra; r++) {
          depthPlayers.push({ name: team + " " + pos + r, position: pos, team, depthRank: r, externalIds: {} });
        }
      }
    }
    return depthPlayers;
  };

  it("takes the designer's depth: 1 QB, 2 RB, 2 WR and 1 TE per team", () => {
    expect(POOL_DEPTH).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1 });
    const { players, gaps } = buildPool({ depthPlayers: everyTeamToDepth() });
    const byPos = players.reduce((a, p) => ({ ...a, [p.position]: (a[p.position] || 0) + 1 }), {});
    expect(byPos).toEqual({ QB: 32, RB: 64, WR: 64, TE: 32 });
    expect(players.length).toBe(192);
    expect(gaps).toEqual([]);
  });

  it("produces no head coaches at all - they are the commissioner's", () => {
    const { players, gaps } = buildPool({ depthPlayers: everyTeamToDepth() });
    expect(players.some((p) => p.position === "Coach")).toBe(false);
    expect(gaps.some((g) => g.position === "Coach")).toBe(false);
  });

  it("takes the lowest depth ranks, not whatever order the file was in", () => {
    const depthPlayers = [
      { name: "Backup", position: "QB", team: "Buffalo Bills", depthRank: 2, externalIds: {} },
      { name: "Starter", position: "QB", team: "Buffalo Bills", depthRank: 1, externalIds: {} },
    ];
    const { players } = buildPool({ depthPlayers });
    const bufQb = players.filter((p) => p.team === "Buffalo Bills" && p.position === "QB");
    expect(bufQb.map((p) => p.name)).toEqual(["Starter"]);
  });

  it("reports a hole rather than quietly dealing a short pool", () => {
    const { players, gaps } = buildPool({ depthPlayers: [] });
    expect(players).toEqual([]);
    // 32 teams x (1 QB + 2 RB + 2 WR + 1 TE)
    expect(gaps.length).toBe(192);
    expect(gaps[0].reason).toMatch(/depth chart/);
  });

  it("treats everyone as healthy when there is no roster status to read", () => {
    const { players } = buildPool({ depthPlayers: everyTeamToDepth(), rosterStatus: null });
    expect(players.every((p) => p.status === "Active")).toBe(true);
  });
});

/* The injury half, added 2026-09-04. Scott's question was the right one: the depth chart
 * has twelve columns and none of them is injury status, so the "IR" ESPN shows beside a
 * name never reaches us. Rank catches most of it - Jayden Higgins was Houston's WR7 the
 * day after his season ended - but it lags, so roster status is read separately. */
describe("injured starters", () => {
  const statusFor = (map) => ({
    byGsis: new Map(),
    byName: new Map(Object.entries(map).map(([k, v]) => [k, { status: v }])),
  });

  const houston = [
    { name: "Nico Collins", position: "WR", team: "Houston Texans", depthRank: 1, externalIds: {} },
    { name: "Jayden Higgins", position: "WR", team: "Houston Texans", depthRank: 2, externalIds: {} },
    { name: "Xavier Hutchinson", position: "WR", team: "Houston Texans", depthRank: 3, externalIds: {} },
  ];

  it("maps the NFL's roster designations onto the game's statuses", () => {
    expect(poolStatusOf("ACT")).toBe("Active");
    expect(poolStatusOf("RES")).toBe("IR"); // reserve/injured is the only one that means hurt
    expect(poolStatusOf("CUT")).toBe("OUT");
    expect(poolStatusOf("DEV")).toBe("OUT"); // practice squad: not playing, but not hurt
  });

  it("treats a status it has never seen as Active, rather than benching a starter", () => {
    expect(poolStatusOf("SOMETHING_NEW")).toBe("Active");
    expect(poolStatusOf("")).toBe("Active");
    expect(poolStatusOf(undefined)).toBe("Active");
  });

  /* The decision, taken by Scott on 2026-09-04: skip him and promote the next healthy
   * man, so every NFL team always contributes a full 1/2/2/1 and the dealable pool does
   * not thin out every time somebody gets hurt. */
  it("skips a hurt starter and promotes the next healthy man", () => {
    const { players, gaps } = buildPool({
      depthPlayers: houston,
      rosterStatus: statusFor({ "jayden higgins|WR": "RES" }),
    });
    const wr = players.filter((p) => p.team === "Houston Texans" && p.position === "WR");
    const dealable = wr.filter((p) => p.status === "Active").map((p) => p.name);
    expect(dealable).toEqual(["Nico Collins", "Xavier Hutchinson"]);
    // The team is not left a receiver short. (The other 31 teams have no depth chart in
    // this fixture, so they gap as they should - Houston is the one under test.)
    expect(gaps.filter((g) => g.team === "Houston Texans" && g.position === "WR")).toEqual([]);
  });

  it("still returns the hurt player, marked IR, so the pool can explain his absence", () => {
    const { players, sidelined } = buildPool({
      depthPlayers: houston,
      rosterStatus: statusFor({ "jayden higgins|WR": "RES" }),
    });
    const higgins = players.find((p) => p.name === "Jayden Higgins");
    expect(higgins.status).toBe("IR");
    expect(sidelined).toContainEqual({
      name: "Jayden Higgins",
      position: "WR",
      team: "Houston Texans",
      depthRank: 2,
      status: "IR",
    });
  });

  it("reports a hole when everyone at a spot is hurt, and says which kind of hole", () => {
    const { gaps } = buildPool({
      depthPlayers: houston,
      rosterStatus: statusFor({
        "nico collins|WR": "RES",
        "jayden higgins|WR": "RES",
        "xavier hutchinson|WR": "RES",
      }),
    });
    const houGaps = gaps.filter((g) => g.team === "Houston Texans" && g.position === "WR");
    expect(houGaps).toHaveLength(2);
    expect(houGaps[0].reason).toMatch(/hurt or off the roster/);
  });

  it("does not treat a player the roster file has never heard of as hurt", () => {
    const { players } = buildPool({
      depthPlayers: houston,
      rosterStatus: statusFor({ "somebody else|WR": "RES" }),
    });
    expect(players.filter((p) => p.status === "Active")).toHaveLength(2);
  });

  it("prefers the provider id over the name, the same way the pool matcher does", () => {
    const rosterStatus = {
      byGsis: new Map([["g1", { status: "RES" }]]),
      byName: new Map(),
    };
    const status = statusOf(
      { name: "Spelled Differently", position: "WR", externalIds: { gsis: "g1" } },
      rosterStatus
    );
    expect(status).toBe("IR");
  });
});

/* Which week of the roster file describes "now". Not the highest one: the file runs to
 * week 22, and week 22 is the two teams left in the Super Bowl. Taking it would leave
 * thirty teams with no roster row and mark all their starters OUT. */
describe("choosing the roster week", () => {
  const rowsFor = (weeks) =>
    Object.entries(weeks).flatMap(([week, teams]) =>
      Array.from({ length: teams }, (_, i) => ({ week, team: "T" + i }))
    );

  it("takes the newest week that still covers the league", () => {
    expect(currentRosterWeek(rowsFor({ 1: 32, 2: 32, 3: 32 }))).toBe(3);
  });

  it("ignores a playoff week that only has the teams still playing", () => {
    expect(currentRosterWeek(rowsFor({ 17: 32, 18: 32, 19: 12, 22: 2 }))).toBe(18);
  });

  it("is not fooled by the file being out of week order", () => {
    // The real 2025 file opens 16, 17, 9 - it is not sorted by anything useful.
    const rows = [...rowsFor({ 16: 32 }), ...rowsFor({ 9: 32 }), ...rowsFor({ 17: 32 })];
    expect(currentRosterWeek(rows)).toBe(17);
  });

  it("falls back to the newest week there is when none covers the league", () => {
    expect(currentRosterWeek(rowsFor({ 1: 4, 2: 6 }))).toBe(2);
  });
});

describe("names that are the same name", () => {
  it("matches through punctuation and suffixes", () => {
    expect(normalizeName("Marvin Harrison Jr.")).toBe(normalizeName("Marvin Harrison"));
    expect(normalizeName("Ja'Marr Chase")).toBe(normalizeName("JaMarr Chase"));
    expect(normalizeName("A.J. Brown")).toBe(normalizeName("AJ Brown"));
  });

  it("does not collapse two genuinely different people", () => {
    expect(normalizeName("Josh Allen")).not.toBe(normalizeName("Keenan Allen"));
  });
});

/* ------------------------------------------------------------------------ */

const row = (over) => ({
  id: over.id,
  name: over.name,
  position: over.position || "WR",
  nfl_team: over.nfl_team || "Buffalo Bills",
  status: over.status || "Active",
  external_ids: over.external_ids || {},
  source: over.source || "seed",
  status_source: over.status_source || "default",
  retired: over.retired ?? false,
});

const feedPlayer = (over) => ({
  name: over.name,
  position: over.position || "WR",
  team: over.team || "Buffalo Bills",
  depthRank: over.depthRank ?? 1,
  externalIds: over.externalIds || {},
});

const AT = "2026-08-28T19:13:13Z";

describe("planning a refresh - what it corrects", () => {
  it("adopts the feed's rendering of a name it recognises, and says so", () => {
    // Same player, written differently - the suffix is exactly what normalizeName is for.
    const plan = planPoolRefresh({
      existing: [row({ id: "1", name: "Marvin Harrison" })],
      wanted: [feedPlayer({ name: "Marvin Harrison Jr.", externalIds: { gsis: "00-0039849" } })],
      at: AT,
    });
    expect(plan.inserts).toEqual([]);
    expect(plan.updates[0].name).toBe("Marvin Harrison Jr.");
    expect(plan.updates[0].external_ids).toEqual({ gsis: "00-0039849" });
    expect(plan.report.renamed).toEqual([
      { from: "Marvin Harrison", to: "Marvin Harrison Jr.", position: "WR", team: "Buffalo Bills" },
    ]);
  });

  /* The hand-typed pool contains real misspellings - "Kalil Shakir" for Khalil Shakir,
   * "Derek Henry" for Derrick Henry. Those are NOT matched, on purpose: fuzzy-matching a
   * misspelling is how a stat line ends up on the wrong player, which docs/LIVE-DATA.md
   * calls the worst available outcome - a wrong number that looks right.
   *
   * The pool still comes out correct, because a seeded row is replaceable: the misspelled
   * one is retired from the deal and the real player is added beside it. */
  it("refuses to fuzzy-match a genuine misspelling, and replaces it instead", () => {
    const plan = planPoolRefresh({
      existing: [row({ id: "1", name: "Kalil Shakir" })],
      wanted: [feedPlayer({ name: "Khalil Shakir", externalIds: { gsis: "00-0037261" } })],
      at: AT,
    });
    expect(plan.updates).toEqual([]);
    expect(plan.inserts[0].name).toBe("Khalil Shakir");
    expect(plan.retires[0]).toMatchObject({ id: "1", status: "OUT" });
    expect(plan.report.renamed).toEqual([]);
  });

  it("prefers the provider id over the name once a player has one", () => {
    const plan = planPoolRefresh({
      existing: [row({ id: "1", name: "Totally Different", external_ids: { gsis: "g1" } })],
      wanted: [feedPlayer({ name: "Real Name", externalIds: { gsis: "g1" } })],
      at: AT,
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].id).toBe("1");
    expect(plan.inserts).toEqual([]);
  });

  it("adds a player who is newly a starter", () => {
    const plan = planPoolRefresh({
      existing: [],
      wanted: [feedPlayer({ name: "Rookie Sensation", position: "RB" })],
      at: AT,
    });
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({
      name: "Rookie Sensation",
      status: "Active",
      source: "feed",
      status_source: "feed",
    });
    expect(plan.report.added).toEqual([
      { name: "Rookie Sensation", position: "RB", team: "Buffalo Bills", status: "Active" },
    ]);
  });

  it("retires a player who is no longer a starter, without deleting him", () => {
    const plan = planPoolRefresh({
      existing: [row({ id: "1", name: "Benched Guy" })],
      wanted: [],
      at: AT,
    });
    expect(plan.retires).toHaveLength(1);
    expect(plan.retires[0]).toMatchObject({ id: "1", status: "OUT", status_source: "feed" });
    // Deleting him would break the rosters and results that reference him.
    expect(Object.keys(plan.retires[0])).not.toContain("deleted");
  });

  /* From 2026-09-04. Retiring used to mean nothing but status OUT, and the managers'
   * Free Agents screen has an OUT tab - so every misspelling the feed replaced went on
   * show to the whole league. Scott: "i have a James Cook III listed as active from a
   * roster refresh, but James Cook listed as out." The flag is what hides him. */
  it("marks a retired player retired, not merely OUT", () => {
    const plan = planPoolRefresh({
      existing: [row({ id: "1", name: "Kalil Shakir" })],
      wanted: [feedPlayer({ name: "Khalil Shakir", externalIds: { gsis: "00-0037261" } })],
      at: AT,
    });
    expect(plan.inserts[0].name).toBe("Khalil Shakir");
    expect(plan.retires[0]).toMatchObject({ id: "1", retired: true });
  });

  /* A suffix is NOT a replacement, and this is why "James Cook" and "James Cook III"
   * should never both be sitting in a pool: normalizeName strips the suffix, the rows
   * match, and the feed's spelling simply wins. Asserted because Scott reported seeing
   * both on 2026-09-04 - if that is real it is a second bug, not this one. */
  it("merges a suffix variant into one player rather than replacing him", () => {
    const plan = planPoolRefresh({
      existing: [row({ id: "1", name: "James Cook", position: "RB" })],
      wanted: [feedPlayer({ name: "James Cook III", position: "RB", externalIds: { gsis: "00-0037248" } })],
      at: AT,
    });
    expect(plan.inserts).toEqual([]);
    expect(plan.retires).toEqual([]);
    expect(plan.updates[0].name).toBe("James Cook III");
  });

  /* The one way they CAN both exist: the pool already held two rows that normalize to
   * the same man. The feed claims one and cannot claim the other, so the leftover is
   * retired - and before the `retired` flag it went straight to the managers' OUT tab. */
  it("retires the leftover when the pool held the same player twice", () => {
    const plan = planPoolRefresh({
      existing: [
        row({ id: "1", name: "James Cook", position: "RB" }),
        row({ id: "2", name: "James Cook Jr.", position: "RB" }),
      ],
      wanted: [feedPlayer({ name: "James Cook III", position: "RB" })],
      at: AT,
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.retires).toHaveLength(1);
    expect(plan.retires[0].retired).toBe(true);
  });

  it("un-retires a player the feed lists as a starter again", () => {
    const back = row({ id: "1", name: "Back Again", status: "OUT", source: "feed", status_source: "feed" });

    const plan = planPoolRefresh({ existing: [back], wanted: [feedPlayer({ name: "Back Again" })], at: AT });
    expect(plan.updates[0].retired).toBe(false);
    expect(plan.updates[0].status).toBe("Active");
  });

  it("does not retire an already-retired player a second time", () => {
    const gone = row({ id: "1", name: "Long Gone", status: "OUT", source: "feed", status_source: "feed" });
    gone.retired = true;
    const plan = planPoolRefresh({ existing: [gone], wanted: [], at: AT });
    expect(plan.retires).toEqual([]);
  });

  /* Restoring sets the status by hand, which stamps status_source 'manual' in
   * src/storage/decompose.js - and that is what stops the next refresh retiring him
   * straight back out of the pool the commissioner just put him in. */
  it("leaves a restored player alone on the next refresh", () => {
    const restored = row({ id: "1", name: "Put Him Back", status: "Active", status_source: "manual" });
    const plan = planPoolRefresh({ existing: [restored], wanted: [], at: AT });
    expect(plan.retires).toEqual([]);
    expect(plan.report.untouched[0].why).toMatch(/set this player's status/);
  });

  it("never double-matches two feed players onto one row", () => {
    const plan = planPoolRefresh({
      existing: [row({ id: "1", name: "Mike Williams" })],
      wanted: [
        feedPlayer({ name: "Mike Williams", externalIds: { gsis: "a" } }),
        feedPlayer({ name: "Mike Williams", externalIds: { gsis: "b" } }),
      ],
      at: AT,
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.inserts).toHaveLength(1);
  });
});

describe("planning a refresh - what it must never touch", () => {
  it("leaves a player the commissioner added completely alone", () => {
    const mine = row({ id: "1", name: "My Guy", source: "manual" });
    const plan = planPoolRefresh({ existing: [mine], wanted: [], at: AT });
    expect(plan.updates).toEqual([]);
    expect(plan.retires).toEqual([]);
    expect(plan.report.untouched).toEqual([
      { name: "My Guy", position: "WR", why: "you added this player" },
    ]);
  });

  it("does not restyle a manual player even when the feed has him", () => {
    const mine = row({ id: "1", name: "My Guy", source: "manual" });
    const plan = planPoolRefresh({
      existing: [mine],
      wanted: [feedPlayer({ name: "My Guy", team: "Miami Dolphins" })],
      at: AT,
    });
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });

  it("keeps a status the commissioner set by hand, and records what the feed thinks", () => {
    const out = row({ id: "1", name: "Hurt Guy", status: "OUT", status_source: "manual" });
    const plan = planPoolRefresh({
      existing: [out],
      wanted: [feedPlayer({ name: "Hurt Guy" })],
      at: AT,
    });
    const patch = plan.updates[0];
    expect(patch.status).toBeUndefined(); // his status is not the feed's to change
    expect(patch.status_source).toBeUndefined();
    expect(patch.feed_status).toBe("Active"); // but the disagreement is recorded
  });

  it("reports the disagreement when the feed has a sidelined player starting", () => {
    const out = row({ id: "1", name: "Hurt Guy", status: "OUT", status_source: "manual" });
    const plan = planPoolRefresh({
      existing: [out],
      wanted: [feedPlayer({ name: "Hurt Guy" })],
      at: AT,
    });
    expect(plan.report.untouched).toContainEqual({
      name: "Hurt Guy",
      position: "WR",
      why: "the depth chart has him starting, you have him OUT",
    });
  });

  it("does not retire a player whose status the commissioner set", () => {
    const kept = row({ id: "1", name: "Kept Guy", status: "IR", status_source: "manual" });
    const plan = planPoolRefresh({ existing: [kept], wanted: [], at: AT });
    expect(plan.retires).toEqual([]);
    expect(plan.report.untouched[0].why).toMatch(/set this player's status/);
  });

  it("re-activates a player the FEED had retired, when he starts again", () => {
    const back = row({ id: "1", name: "Back Again", status: "OUT", status_source: "feed" });
    const plan = planPoolRefresh({
      existing: [back],
      wanted: [feedPlayer({ name: "Back Again" })],
      at: AT,
    });
    expect(plan.updates[0].status).toBe("Active");
  });

  /* HEAD COACHES, from 2026-09-04 (OQ-4d). Stronger than the 'manual' rule on purpose:
   * the coach rows in Scott's league were written by an EARLIER refresh, so they carry
   * source 'feed' and would otherwise be the feed's own work to revise. Position is what
   * protects them, not provenance. */
  it("never retires a head coach, whatever the feed says", () => {
    const coach = row({ id: "1", name: "Jesse Minter", position: "Coach", source: "feed", status_source: "feed" });
    const plan = planPoolRefresh({ existing: [coach], wanted: [], at: AT });
    expect(plan.retires).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.report.coachesKept).toBe(1);
  });

  it("never renames or re-teams a head coach", () => {
    const coach = row({ id: "1", name: "John Harbaugh", position: "Coach", nfl_team: "New York Giants", source: "feed" });
    const plan = planPoolRefresh({
      existing: [coach],
      wanted: [feedPlayer({ name: "Somebody Else", position: "Coach", team: "New York Giants" })],
      at: AT,
    });
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]); // and it does not add one alongside him either
  });

  it("does not count coaches as retired in the report", () => {
    const plan = planPoolRefresh({
      existing: [
        row({ id: "1", name: "Andy Reid", position: "Coach", source: "feed" }),
        row({ id: "2", name: "Benched Guy", position: "WR", source: "feed" }),
      ],
      wanted: [],
      at: AT,
    });
    expect(plan.report.retired).toBe(1);
    expect(plan.report.coachesKept).toBe(1);
  });

  it("carries the feed's IR verdict onto a row it owns", () => {
    const existing = [row({ id: "1", name: "Hurt Starter", source: "feed", status_source: "feed" })];
    const plan = planPoolRefresh({
      existing,
      wanted: [{ ...feedPlayer({ name: "Hurt Starter" }), status: "IR" }],
      at: AT,
    });
    expect(plan.updates[0].status).toBe("IR");
    expect(plan.updates[0].feed_status).toBe("IR");
  });

  it("still will not overrule a status the commissioner set, even to say IR", () => {
    const mine = row({ id: "1", name: "Hurt Starter", status: "Active", status_source: "manual" });
    const plan = planPoolRefresh({
      existing: [mine],
      wanted: [{ ...feedPlayer({ name: "Hurt Starter" }), status: "IR" }],
      at: AT,
    });
    expect(plan.updates[0].status).toBeUndefined();
    expect(plan.updates[0].feed_status).toBe("IR");
    expect(plan.report.untouched).toContainEqual({
      name: "Hurt Starter",
      position: "WR",
      why: "the feed has him IR, you have him Active",
    });
  });

  it("is idempotent - refreshing twice changes nothing the second time", () => {
    const existing = [
      row({ id: "1", name: "Josh Allen", position: "QB", source: "feed", status_source: "feed", external_ids: { gsis: "g1" } }),
      // `retired` from 2026-09-04: what "already gone" means is now the flag, not the
      // status. A row that is OUT-by-feed WITHOUT it predates the flag and is retired
      // once more, which is exactly what that day's migration backfills.
      row({ id: "2", name: "Gone Guy", status: "OUT", source: "feed", status_source: "feed", retired: true }),
    ];
    const wanted = [feedPlayer({ name: "Josh Allen", position: "QB", externalIds: { gsis: "g1" } })];
    const plan = planPoolRefresh({ existing, wanted, at: AT });
    expect(plan.inserts).toEqual([]);
    expect(plan.retires).toEqual([]); // already retired; not retired again
    expect(plan.report.renamed).toEqual([]);
  });
});

/* The write half. The plan says WHAT changes; this says how it reaches the database,
 * and the answer has to be "in a couple of requests" rather than one per player -
 * see the comment on poolWriteRows. */
describe("batching the writes", () => {
  const existing = (n) =>
    Array.from({ length: n }, (_, i) => ({
      id: "id" + i,
      league_id: "L",
      name: "Player " + i,
      position: "WR",
      nfl_team: "Buffalo Bills",
      status: "Active",
      status_source: "default",
      source: "seed",
      external_ids: {},
      depth_rank: null,
      version: 3,
    }));

  it("merges each patch onto its whole row, so an upsert cannot half-write a player", () => {
    const rows = existing(1);
    const [chunk] = poolWriteRows({
      patches: [{ id: "id0", depth_rank: 1, source: "feed" }],
      existing: rows,
    });
    expect(chunk[0]).toEqual({ ...rows[0], depth_rank: 1, source: "feed" });
  });

  it("carries version through untouched - a refresh is not an edit", () => {
    const [chunk] = poolWriteRows({
      patches: [{ id: "id0", status: "OUT" }],
      existing: existing(1),
    });
    expect(chunk[0].version).toBe(3);
  });

  it("sends a whole pool in a couple of requests, not one per player", () => {
    const rows = existing(224);
    const chunks = poolWriteRows({
      patches: rows.map((r) => ({ id: r.id, depth_rank: 1 })),
      existing: rows,
    });
    expect(chunks.length).toBe(Math.ceil(224 / POOL_WRITE_CHUNK));
    expect(chunks.flat()).toHaveLength(224);
  });

  it("drops a patch whose row has vanished rather than inserting a half-built player", () => {
    const chunks = poolWriteRows({
      patches: [{ id: "gone", status: "OUT" }],
      existing: existing(1),
    });
    expect(chunks).toEqual([]);
  });

  it("never loops forever on a nonsense chunk size", () => {
    const rows = existing(3);
    const chunks = poolWriteRows({
      patches: rows.map((r) => ({ id: r.id })),
      existing: rows,
      chunkSize: 0,
    });
    expect(chunks).toHaveLength(3);
  });
});
