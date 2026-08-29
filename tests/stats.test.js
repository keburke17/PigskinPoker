/* The stats pull: what it reads, and what it is allowed to write over.
 *
 * No database and no network - the planner is pure and the fetches take an injected
 * `fetchImpl`, which is the whole reason both are shaped the way they are.
 */

import { describe, expect, it } from "vitest";
import {
  fetchGameResults,
  fetchWeeklyStats,
  resultsFromGames,
} from "../server/feed/nflverse.js";
import { planStatsPull, statWriteRows } from "../server/stats.js";

/* ------------------------------------------------------------- fetching -- */

const STATS_CSV = [
  "player_id,player_display_name,position,team,season,week,season_type,passing_yards,passing_tds,rushing_yards,rushing_tds,receiving_yards,receiving_tds",
  "00-0001,Week One QB,QB,BUF,2026,1,REG,250,2,10,0,0,0",
  "00-0002,Week Two QB,QB,BUF,2026,2,REG,300,3,0,0,0,0",
  "00-0003,Week Two WR,WR,BUF,2026,2,REG,0,0,0,0,91,1",
  "00-0004,Week Three RB,RB,BUF,2026,3,REG,0,0,120,2,15,0",
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

describe("fetching one week of stats", () => {
  it("keeps the week asked for and nothing else", async () => {
    const res = { ok: true, body: streamOf(STATS_CSV) };
    const { lines } = await fetchWeeklyStats({ season: 2026, week: 2, fetchImpl: async () => res });
    expect(lines.map((l) => l.name)).toEqual(["Week Two QB", "Week Two WR"]);
    expect(lines[1]).toMatchObject({ gsis: "00-0003", recYards: 91, recTds: 1 });
  });

  /* The measurement in docs/PHASE-4-PLAN.md 5.2: the file is ordered by week ascending
   * and is 8.66MB, so a pull for an early week must stop rather than read to the end. */
  it("stops reading once the week has gone by, and aborts the request", async () => {
    let aborted = false;
    const res = { ok: true, body: streamOf(STATS_CSV) };
    const { lines, stoppedEarly } = await fetchWeeklyStats({
      season: 2026,
      week: 1,
      fetchImpl: async (_url, opts) => {
        if (opts && opts.signal) opts.signal.addEventListener("abort", () => (aborted = true));
        return res;
      },
    });
    expect(lines.map((l) => l.name)).toEqual(["Week One QB"]);
    expect(stoppedEarly).toBe(true);
    expect(aborted).toBe(true);
  });

  it("reads the whole file when the last week is the one wanted", async () => {
    const res = { ok: true, body: streamOf(STATS_CSV) };
    const { lines, stoppedEarly } = await fetchWeeklyStats({
      season: 2026, week: 3, fetchImpl: async () => res,
    });
    expect(lines).toHaveLength(1);
    expect(stoppedEarly).toBe(false); // the signal that the file's order has changed
  });

  it("says a 404 means the season has not started, because that is what it means", async () => {
    await expect(
      fetchWeeklyStats({ season: 2026, week: 1, fetchImpl: async () => ({ ok: false, status: 404 }) })
    ).rejects.toThrow(/no games have been played/);
  });

  it("refuses to fetch without a week rather than guessing one", async () => {
    await expect(fetchWeeklyStats({ season: 2026 })).rejects.toThrow(/needs a week/);
  });
});

describe("reading game results for the Coach slot", () => {
  const GAMES = [
    "season,week,home_team,away_team,home_score,away_score",
    "2026,1,BUF,NYJ,31,17",
    "2026,1,SEA,SF,20,20",
    "2026,2,BUF,MIA,10,24",
    "2026,3,BUF,NE,,", // scheduled, not played
  ].join("\n");

  const rows = (text) =>
    text.split("\n").slice(1).map((line) => {
      const [season, week, home_team, away_team, home_score, away_score] = line.split(",");
      return { season, week, home_team, away_team, home_score, away_score };
    });

  it("gives both teams their result, keyed by the name the pool uses", () => {
    const r = resultsFromGames(rows(GAMES), { season: 2026, week: 1 });
    expect(r.get("Buffalo Bills")).toBe("Win");
    expect(r.get("New York Jets")).toBe("Loss");
    expect(r.get("Seattle Seahawks")).toBe("Tie");
    expect(r.get("San Francisco 49ers")).toBe("Tie");
  });

  /* THE ONE THAT MATTERS. games.csv carries the schedule from the day it is published
   * with the scores empty, and Number("") is 0 - so a blank read as a number would give
   * every coach in the league a tie on Saturday morning. */
  it("treats an unplayed game as no result, NOT as a tie", () => {
    const r = resultsFromGames(rows(GAMES), { season: 2026, week: 3 });
    expect(r.size).toBe(0);
  });

  it("fetches one week out of the whole file", async () => {
    const { results } = await fetchGameResults({
      season: 2026,
      week: 2,
      fetchImpl: async () => ({ ok: true, text: async () => GAMES }),
    });
    expect(results.get("Miami Dolphins")).toBe("Win");
    expect(results.get("Buffalo Bills")).toBe("Loss");
  });
});

/* -------------------------------------------------------------- planning -- */

const PERIOD = "period-1";

const player = (id, over = {}) => ({
  id,
  name: id,
  position: "WR",
  nfl_team: "Buffalo Bills",
  external_ids: { gsis: "gs-" + id },
  ...over,
});

const feedLine = (gsis, over = {}) => ({
  gsis,
  name: gsis,
  passYards: 0, passTds: 0, rushYards: 0, rushTds: 0, recYards: 0, recTds: 0,
  ...over,
});

const plan = (over = {}) =>
  planStatsPull({
    starters: [],
    players: [],
    teams: [{ id: "t1", name: "Pocket Aces" }],
    statLines: [],
    feedLines: [],
    results: new Map(),
    at: "2026-09-14T23:00:00.000Z",
    periodId: PERIOD,
    ...over,
  });

describe("planning a stats pull", () => {
  it("fills an empty slot from the feed and marks it the feed's", () => {
    const { writes, report } = plan({
      starters: [{ period_id: PERIOD, team_id: "t1", slot: "WR", area: "starter", player_id: "p1" }],
      players: [player("p1")],
      feedLines: [feedLine("gs-p1", { recYards: 91, recTds: 1 })],
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      period_id: PERIOD, team_id: "t1", slot: "WR", player_id: "p1",
      rec_yards: 91, rec_tds: 1,
      feed_rec_yards: 91, feed_rec_tds: 1,
      source: "feed", feed_provider: "nflverse", version: 1,
    });
    expect(report.filled).toEqual([{ team: "Pocket Aces", slot: "WR", player: "p1" }]);
  });

  /* THE PROMISE. Same one server/pool.js keeps about a status the commissioner set:
   * the feed may correct its own work and nothing a person typed. */
  it("NEVER overwrites a line the commissioner typed - it records the difference beside it", () => {
    const { writes, report } = plan({
      starters: [{ period_id: PERIOD, team_id: "t1", slot: "WR", area: "starter", player_id: "p1" }],
      players: [player("p1")],
      statLines: [{
        id: "s1", period_id: PERIOD, team_id: "t1", slot: "WR",
        rec_yards: 84, rec_tds: 1, source: "manual", version: 3,
      }],
      feedLines: [feedLine("gs-p1", { recYards: 91, recTds: 1 })],
    });

    expect(writes[0].rec_yards).toBe(84); // his number, untouched
    expect(writes[0].feed_rec_yards).toBe(91); // the feed's, on the record beside it
    expect(writes[0].source).toBe("manual");
    expect(writes[0].version).toBe(4);
    expect(report.filled).toEqual([]);
    expect(report.kept).toEqual([
      {
        team: "Pocket Aces", slot: "WR", player: "p1",
        differences: [{ field: "recYards", label: "Rec Yds", yours: 84, feed: 91 }],
      },
    ]);
  });

  it("corrects its own earlier work, because that is the feed's to correct", () => {
    const { writes, report } = plan({
      starters: [{ period_id: PERIOD, team_id: "t1", slot: "WR", area: "starter", player_id: "p1" }],
      players: [player("p1")],
      statLines: [{
        id: "s1", period_id: PERIOD, team_id: "t1", slot: "WR",
        rec_yards: 60, source: "feed", version: 2,
      }],
      feedLines: [feedLine("gs-p1", { recYards: 91 })],
    });
    expect(writes[0].rec_yards).toBe(91);
    expect(writes[0].version).toBe(3);
    expect(report.filled).toHaveLength(1);
  });

  it("counts a typed line the feed agrees with without listing it", () => {
    const { report } = plan({
      starters: [{ period_id: PERIOD, team_id: "t1", slot: "WR", area: "starter", player_id: "p1" }],
      players: [player("p1")],
      statLines: [{
        id: "s1", period_id: PERIOD, team_id: "t1", slot: "WR",
        rec_yards: 91, source: "manual", version: 1,
      }],
      feedLines: [feedLine("gs-p1", { recYards: 91 })],
    });
    expect(report.kept).toEqual([]);
    expect(report.keptAgreeing).toBe(1);
  });

  /* A player who did not play is absent from the file, and Scott's answer is that such
   * a starter scores zero. A blank already scores zero, so writing an explicit 0 would
   * claim the feed reported one - which on a Sunday afternoon is a different statement. */
  it("leaves a player the feed has nothing for alone, and names him", () => {
    const { writes, report } = plan({
      starters: [{ period_id: PERIOD, team_id: "t1", slot: "WR", area: "starter", player_id: "p1" }],
      players: [player("p1")],
      feedLines: [],
    });
    expect(writes).toEqual([]);
    expect(report.missing).toEqual([
      { team: "Pocket Aces", slot: "WR", player: "p1", why: "no line in the feed for this week" },
    ]);
  });

  /* A line from before the 2026-08-28 split carries one combined `yards` figure, and a
   * total does not say how much of it was passing. Compared field by field it reads as
   * six disagreements about a line that was filled in perfectly well. */
  it("does not pretend a pre-split line disagrees on six fields", () => {
    const { report } = plan({
      starters: [{ period_id: PERIOD, team_id: "t1", slot: "QB", area: "starter", player_id: "p1" }],
      players: [player("p1", { position: "QB" })],
      statLines: [{
        id: "s1", period_id: PERIOD, team_id: "t1", slot: "QB",
        yards: 295, tds: 2, source: "manual", version: 1,
      }],
      feedLines: [feedLine("gs-p1", { passYards: 310, passTds: 2 })],
    });
    expect(report.kept[0].differences).toEqual([
      {
        field: "legacy",
        label: "totals from before the scoring split:",
        yours: "295 yds, 2 TD",
        feed: "310 yds, 2 TD",
      },
    ]);
  });

  it("says nothing at all when a pre-split line and the feed agree on the totals", () => {
    const { report } = plan({
      starters: [{ period_id: PERIOD, team_id: "t1", slot: "QB", area: "starter", player_id: "p1" }],
      players: [player("p1", { position: "QB" })],
      statLines: [{
        id: "s1", period_id: PERIOD, team_id: "t1", slot: "QB",
        yards: 295, tds: 2, source: "manual", version: 1,
      }],
      feedLines: [feedLine("gs-p1", { passYards: 295, passTds: 2 })],
    });
    expect(report.kept).toEqual([]);
    expect(report.keptAgreeing).toBe(1);
  });

  it("says when a player has no provider id, because that is a different fix", () => {
    const { report } = plan({
      starters: [{ period_id: PERIOD, team_id: "t1", slot: "WR", area: "starter", player_id: "p1" }],
      players: [player("p1", { external_ids: {} })],
      feedLines: [feedLine("gs-p1", { recYards: 91 })],
    });
    expect(report.missing[0].why).toMatch(/refresh the pool/);
  });

  /* Matched by TEAM, not by coach name - so a team that changed coach mid-season still
   * resolves to the right game. Coaches have no player id at all. */
  it("scores the Coach slot off his team's game", () => {
    const { writes } = plan({
      starters: [{ period_id: PERIOD, team_id: "t1", slot: "Coach", area: "starter", player_id: "c1" }],
      players: [player("c1", { position: "Coach", name: "Sean McDermott", external_ids: {} })],
      results: new Map([["Buffalo Bills", "Win"]]),
    });
    expect(writes[0]).toMatchObject({
      slot: "Coach", coach_result: "Win", feed_coach_result: "Win", source: "feed",
    });
  });

  it("leaves the Coach alone when his game has not finished", () => {
    const { writes, report } = plan({
      starters: [{ period_id: PERIOD, team_id: "t1", slot: "Coach", area: "starter", player_id: "c1" }],
      players: [player("c1", { position: "Coach", external_ids: {} })],
      results: new Map(),
    });
    expect(writes).toEqual([]);
    expect(report.missing[0].why).toMatch(/no finished game/);
  });

  it("ignores the bench - only starters score", () => {
    const starters = [
      { period_id: PERIOD, team_id: "t1", slot: "WR", area: "starter", player_id: "p1" },
    ];
    const { writes } = plan({
      starters,
      players: [player("p1"), player("p2")],
      feedLines: [feedLine("gs-p1", { recYards: 10 }), feedLine("gs-p2", { recYards: 99 })],
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].player_id).toBe("p1");
  });

  it("batches the writes, as one request in any realistic league", () => {
    const writes = Array.from({ length: 72 }, (_, i) => ({ slot: i }));
    expect(statWriteRows({ writes })).toHaveLength(1);
    expect(statWriteRows({ writes, chunkSize: 50 })).toHaveLength(2);
  });

  /* A batched upsert is one statement whose column list is the union of the batch, so a
   * row without an id is sent an explicit NULL the moment any row beside it has one -
   * and `default gen_random_uuid()` never runs. Found against real Postgres; the same
   * shape as the bug poolWriteRows documents. */
  it("gives every new row an id, because a mixed batch would send NULL for the rest", () => {
    let n = 0;
    const [chunk] = statWriteRows({
      writes: [{ slot: "WR" }, { id: "already-here", slot: "QB" }],
      newId: () => "made-" + ++n,
    });
    expect(chunk.map((r) => r.id)).toEqual(["made-1", "already-here"]);
  });
});
