/* One download of each NFL file per scheduled run (server/feed/shared.js). */
import { describe, expect, it } from "vitest";
import { cachingFetch, sharedFeed } from "../server/feed/shared.js";
import { GAMES_URL, fetchGameResults, fetchKickoffs } from "../server/feed/nflverse.js";

const GAMES_CSV = [
  "season,week,game_type,gameday,gametime,away_team,home_team,away_score,home_score",
  "2026,12,REG,2026-11-25,20:15,NYG,DAL,17,24",
  "2026,12,REG,2026-11-26,12:30,CHI,DET,,",
].join("\n");

function countingFetch() {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, text: async () => GAMES_CSV };
  };
  return { impl, calls };
}

describe("sharedFeed", () => {
  it("asks the source once per question, however many leagues ask", async () => {
    let asked = 0;
    const source = { fetchGameResults: async () => { asked += 1; return { results: new Map([["Dallas Cowboys", "Win"]]) }; } };
    const feed = sharedFeed(source);
    for (let i = 0; i < 50; i++) await feed.fetchGameResults({ season: 2026, week: 12 });
    expect(asked).toBe(1);
    await feed.fetchGameResults({ season: 2026, week: 13 });
    expect(asked).toBe(2);
  });

  it("gives every caller its own copy", async () => {
    const feed = sharedFeed({ fetchGameResults: async () => ({ results: new Map([["Dallas Cowboys", "Win"]]) }) });
    const first = await feed.fetchGameResults({ season: 2026, week: 12 });
    first.results.set("Dallas Cowboys", "Loss");
    const second = await feed.fetchGameResults({ season: 2026, week: 12 });
    expect(second.results.get("Dallas Cowboys")).toBe("Win");
  });

  it("forgets a failure, so the next league tries again", async () => {
    let asked = 0;
    const feed = sharedFeed({
      fetchGameResults: async () => {
        asked += 1;
        if (asked === 1) throw new Error("feed down");
        return { results: new Map() };
      },
    });
    await expect(feed.fetchGameResults({ season: 2026, week: 12 })).rejects.toThrow("feed down");
    await expect(feed.fetchGameResults({ season: 2026, week: 12 })).resolves.toBeTruthy();
    expect(asked).toBe(2);
  });

  it("leaves out a method the source does not have, so callers can still ask", () => {
    const feed = sharedFeed({ fetchDepthChart: async () => ({}) });
    expect(feed.fetchDepthChart).toBeTypeOf("function");
    expect(feed.fetchRosterStatus).toBeUndefined();
  });

  it("downloads the games file once for results AND kickoffs, from the real feed", async () => {
    const { impl, calls } = countingFetch();
    const feed = sharedFeed({ fetchGameResults, fetchKickoffs }, { fetchImpl: impl });
    const r = await feed.fetchGameResults({ season: 2026, week: 12 });
    const k = await feed.fetchKickoffs({ season: 2026, week: 12 });
    await feed.fetchKickoffs({ season: 2026, week: 13 });
    expect(calls.filter((u) => u === GAMES_URL)).toHaveLength(1);
    expect(r.results.get("Dallas Cowboys")).toBe("Win");
    expect(r.results.has("Detroit Lions")).toBe(false); // not played yet
    expect(Object.keys(k.kickoffs)).toContain("Detroit Lions");
  });

  it("passes other URLs straight through", async () => {
    const { impl, calls } = countingFetch();
    const f = cachingFetch(new Set([GAMES_URL]), impl);
    await f("https://example.test/a");
    await f("https://example.test/a");
    expect(calls).toEqual(["https://example.test/a", "https://example.test/a"]);
  });

  it("reports an HTTP failure the way the network did", async () => {
    const f = cachingFetch(new Set([GAMES_URL]), async () => ({ ok: false, status: 503, text: async () => "" }));
    const res = await f(GAMES_URL);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
  });
});
