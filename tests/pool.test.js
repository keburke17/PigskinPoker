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
  fetchDepthChart,
  parseCsv,
  parseCsvLine,
  readLatestSnapshot,
} from "../server/feed/nflverse.js";
import { normalizeName, planPoolRefresh } from "../server/pool.js";

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

describe("building the pool", () => {
  const coaches = new Map(Object.values(NFL_TEAMS).map((t) => [t, t + " Coach"]));

  it("takes the designer's depth: 1 QB, 2 RB, 2 WR, 1 TE and a coach per team", () => {
    expect(POOL_DEPTH).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1 });
    const depthPlayers = [];
    for (const team of new Set(Object.values(NFL_TEAMS))) {
      for (const [pos, n] of Object.entries(POOL_DEPTH)) {
        for (let r = 1; r <= n + 2; r++) {
          depthPlayers.push({ name: team + " " + pos + r, position: pos, team, depthRank: r, externalIds: {} });
        }
      }
    }
    const { players, gaps } = buildPool({ depthPlayers, coaches });
    const byPos = players.reduce((a, p) => ({ ...a, [p.position]: (a[p.position] || 0) + 1 }), {});
    expect(byPos).toEqual({ QB: 32, RB: 64, WR: 64, TE: 32, Coach: 32 });
    expect(players.length).toBe(224);
    expect(gaps).toEqual([]);
  });

  it("takes the lowest depth ranks, not whatever order the file was in", () => {
    const depthPlayers = [
      { name: "Backup", position: "QB", team: "Buffalo Bills", depthRank: 2, externalIds: {} },
      { name: "Starter", position: "QB", team: "Buffalo Bills", depthRank: 1, externalIds: {} },
    ];
    const { players } = buildPool({ depthPlayers, coaches });
    const bufQb = players.filter((p) => p.team === "Buffalo Bills" && p.position === "QB");
    expect(bufQb.map((p) => p.name)).toEqual(["Starter"]);
  });

  it("reports a hole rather than quietly dealing a short pool", () => {
    const { players, gaps } = buildPool({ depthPlayers: [], coaches: new Map() });
    expect(players).toEqual([]);
    // 32 teams x (1 QB + 2 RB + 2 WR + 1 TE + 1 Coach)
    expect(gaps.length).toBe(224);
    expect(gaps[0].reason).toMatch(/depth chart|head coach/);
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
      { name: "Rookie Sensation", position: "RB", team: "Buffalo Bills" },
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

  it("is idempotent - refreshing twice changes nothing the second time", () => {
    const existing = [
      row({ id: "1", name: "Josh Allen", position: "QB", source: "feed", status_source: "feed", external_ids: { gsis: "g1" } }),
      row({ id: "2", name: "Gone Guy", status: "OUT", source: "feed", status_source: "feed" }),
    ];
    const wanted = [feedPlayer({ name: "Josh Allen", position: "QB", externalIds: { gsis: "g1" } })];
    const plan = planPoolRefresh({ existing, wanted, at: AT });
    expect(plan.inserts).toEqual([]);
    expect(plan.retires).toEqual([]); // already retired; not retired again
    expect(plan.report.renamed).toEqual([]);
  });
});
