/* The recorded feed, and the gate that keeps it away from production.
 *
 * No database and no network: the point of the fixture is that both are optional, and a
 * test that needed either would prove the opposite.
 */

import { describe, expect, it } from "vitest";
import { FEED_ENV, feedChoice, selectFeed } from "../server/feed/index.js";
import * as fixture from "../server/feed/fixture.js";
import * as nflverse from "../server/feed/nflverse.js";
import { parseWeeklyStats } from "../server/feed/nflverse.js";

const LOCAL = "http://127.0.0.1:54321";
const HOSTED = "https://abcdefgh.supabase.co";

describe("choosing a feed", () => {
  it("uses the live feed by default", () => {
    expect(feedChoice({ SUPABASE_URL: LOCAL }).feed).toBe("live");
  });

  it("uses the fixture when asked, against a local database", () => {
    expect(feedChoice({ [FEED_ENV]: "fixture", SUPABASE_URL: LOCAL }).feed).toBe("fixture");
  });

  /* THE ONE THAT MATTERS. A fixture served in production would freeze a league's pool at
   * whatever was recorded and report success while doing it, so the environment variable
   * is deliberately not sufficient on its own. */
  it("REFUSES the fixture against a hosted database, however loudly it is asked", async () => {
    for (const env of [
      { [FEED_ENV]: "fixture", SUPABASE_URL: HOSTED },
      { [FEED_ENV]: "FIXTURE", VITE_SUPABASE_URL: HOSTED },
      { [FEED_ENV]: "fixture" }, // no URL at all: still not local
    ]) {
      const choice = feedChoice(env);
      expect(choice.feed).toBe("live");
      expect(choice.why).toMatch(/IGNORED/);
      expect(await selectFeed(env)).toBe(nflverse);
    }
  });

  it("says which one it picked, and why", () => {
    expect(feedChoice({ [FEED_ENV]: "fixture", SUPABASE_URL: LOCAL }).why).toMatch(/local database/);
    expect(feedChoice({ SUPABASE_URL: LOCAL }).why).toBe("the default");
  });

  it("hands back the fixture module itself when it is allowed to", async () => {
    expect(await selectFeed({ [FEED_ENV]: "fixture", SUPABASE_URL: LOCAL })).toBe(fixture);
  });
});

describe("the recorded fixture", () => {
  /* CHANGED 2026-09-04: 192, not 224. Head coaches became the commissioner's (OQ-4d),
   * so buildPool stops producing them - a league still holds 224 players, and the feed
   * is responsible for 192 of them. games.csv is still recorded, and coachesFromGames is
   * still read here, because the Coach slot scores off that file's RESULTS. */
  it("builds the same 192-player pool the live feed does, with no network", async () => {
    const chart = await fixture.fetchDepthChart({ season: 2026 });
    const { coaches } = await fixture.fetchHeadCoaches({ season: 2026 });
    const { players, gaps } = fixture.buildPool({ depthPlayers: chart.players });

    expect(players).toHaveLength(192);
    expect(gaps).toEqual([]);
    expect(coaches.size).toBe(32); // read, and deliberately not put in the pool
    // Every team, every position, and the ids the refresh matches on.
    expect(players.filter((p) => p.position === "QB")).toHaveLength(32);
    expect(players.filter((p) => p.position === "RB")).toHaveLength(64);
    expect(players.filter((p) => p.position === "Coach")).toHaveLength(0);
    expect(players.filter((p) => p.externalIds.gsis)).toHaveLength(192); // all of them now
  });

  it("is a real snapshot, and says what it is", () => {
    const m = fixture.manifest();
    expect(m.depthChartSnapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(m.poolPlayers).toBe(192);
    /* The stat lines are a real past week wearing this season's label. Recorded because
     * stats_player_week_<this season>.csv does not exist until games are played. */
    expect(m.stats.sourceSeason).toBeLessThan(m.season);
    expect(m.stats.relabelledTo.season).toBe(m.season);
  });

  it("carries a week of stat lines that match the pool by id", async () => {
    const { lines } = await fixture.fetchWeeklyStats({ season: 2026, week: 1 });
    expect(lines.length).toBeGreaterThan(100);

    const chart = await fixture.fetchDepthChart({ season: 2026 });
    const pool = fixture.buildPool({ depthPlayers: chart.players }).players;
    const inPool = new Set(pool.map((p) => p.externalIds.gsis).filter(Boolean));
    expect(lines.every((l) => inPool.has(l.gsis))).toBe(true);

    // Somebody threw for something: a fixture of all zeroes would pass everything else.
    expect(lines.some((l) => l.passYards > 100)).toBe(true);
    expect(lines.some((l) => l.recYards > 40)).toBe(true);
  });

  /* The demo league is dealt past week 1, so one recorded week was not enough to press
   * the button against - and a week the fixture does not have must come back honestly
   * empty rather than serving whichever week it does have. */
  it("carries every week it says it does, and nothing for one it does not", async () => {
    const { weeks } = fixture.manifest().stats;
    expect(weeks.length).toBeGreaterThan(1);
    for (const week of weeks) {
      const { lines } = await fixture.fetchWeeklyStats({ season: 2026, week });
      expect(lines.length).toBeGreaterThan(50);
      expect(lines.every((l) => l.week === week)).toBe(true);
    }
    const beyond = await fixture.fetchWeeklyStats({ season: 2026, week: Math.max(...weeks) + 1 });
    expect(beyond.lines).toEqual([]);
  });

  it("has a Win/Tie/Loss for both teams in every recorded game", async () => {
    const { results } = await fixture.fetchGameResults({ season: 2026, week: 1 });
    expect(results.size).toBe(32); // every team plays in week 1
    expect([...results.values()].every((r) => ["Win", "Tie", "Loss"].includes(r))).toBe(true);
    expect([...results.values()].filter((r) => r === "Win").length).toBeGreaterThan(10);
    // Keyed by the full team name the pool uses, not the abbreviation.
    expect(results.has("Buffalo Bills")).toBe(true);
  });
});

describe("parsing weekly stats", () => {
  const CSV = [
    "player_id,player_display_name,position,team,season,week,season_type,passing_yards,passing_tds,rushing_yards,rushing_tds,receiving_yards,receiving_tds",
    "00-0034857,Josh Allen,QB,BUF,2026,1,REG,297,2,39,1,0,0",
    "00-0037261,Khalil Shakir,WR,BUF,2026,1,REG,0,0,0,0,76,1",
    "00-0000001,Someone Else,WR,BUF,2026,2,REG,0,0,0,0,10,0",
    "00-0000002,Preseason Guy,WR,BUF,2026,1,PRE,0,0,0,0,99,2",
  ].join("\n");

  it("keeps one week, and only the real season", () => {
    const lines = parseWeeklyStats(CSV, { week: 1 });
    expect(lines.map((l) => l.name)).toEqual(["Josh Allen", "Khalil Shakir"]);
  });

  it("splits into the three categories the scoring change asks for", () => {
    const [allen] = parseWeeklyStats(CSV, { week: 1 });
    expect(allen).toMatchObject({
      gsis: "00-0034857", passYards: 297, passTds: 2, rushYards: 39, rushTds: 1,
      recYards: 0, recTds: 0,
    });
  });

  it("reads a blank as zero, because a starter who did not play scores zero", () => {
    const lines = parseWeeklyStats(
      "player_id,player_display_name,week,passing_yards,receiving_yards\n00-1,Nobody,1,,",
      { week: 1 }
    );
    expect(lines[0].passYards).toBe(0);
    expect(lines[0].recYards).toBe(0);
  });
});
