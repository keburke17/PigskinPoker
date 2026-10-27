import { describe, it, expect } from "vitest";
import { dealRosters, seededRng, topOfChartIds } from "../src/engine/index.js";
import { baseState } from "./helpers/fixtures.js";
import { hydrateLeague } from "../src/storage/hydrate.js";
import { decomposeLeague } from "../src/storage/decompose.js";

const ids = (s) => s.teams.map((t) => t.id);

describe("dealRosters", () => {
  it("deals 6 starters and 6 bench to every team", () => {
    const s = baseState(6);
    const { rosters, error } = dealRosters(s, ids(s), seededRng(42));
    expect(error).toBeUndefined();
    for (const teamId of ids(s)) {
      const r = rosters[teamId];
      expect(Object.keys(r.starters).sort()).toEqual(
        ["Coach", "FLEX", "QB", "RB", "TE", "WR"]
      );
      expect(r.bench).toHaveLength(6);
      expect(Object.values(r.starters).every(Boolean)).toBe(true);
      expect(r.bench.every(Boolean)).toBe(true);
    }
  });

  it("never gives the same player to two teams", () => {
    const s = baseState(6);
    const { rosters } = dealRosters(s, ids(s), seededRng(9));
    const all = Object.values(rosters).flatMap((r) => [
      ...Object.values(r.starters),
      ...r.bench,
    ]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("puts the right real position in every non-FLEX slot", () => {
    const s = baseState(4);
    const { rosters } = dealRosters(s, ids(s), seededRng(3));
    const pos = (id) => s.playerPool.find((p) => p.id === id).position;
    for (const r of Object.values(rosters)) {
      for (const slot of ["Coach", "QB", "WR", "RB", "TE"]) {
        expect(pos(r.starters[slot])).toBe(slot);
      }
    }
  });

  it("rolls each FLEX independently as WR or RB, never TE", () => {
    const s = baseState(6);
    const pos = (id) => s.playerPool.find((p) => p.id === id).position;
    const seen = new Set();
    // Across seeds, both FLEX outcomes must occur and TE must never appear.
    for (let seed = 0; seed < 25; seed++) {
      const { rosters } = dealRosters(s, ids(s), seededRng(seed));
      for (const r of Object.values(rosters)) {
        seen.add(pos(r.starters.FLEX));
      }
    }
    expect([...seen].sort()).toEqual(["RB", "WR"]);
  });

  it("caps every team at 2 TEs (FLEX can never be a TE)", () => {
    const s = baseState(6);
    const pos = (id) => s.playerPool.find((p) => p.id === id).position;
    const { rosters } = dealRosters(s, ids(s), seededRng(15));
    for (const r of Object.values(rosters)) {
      const all = [...Object.values(r.starters), ...r.bench];
      expect(all.filter((id) => pos(id) === "TE")).toHaveLength(2);
      expect(all.filter((id) => pos(id) === "Coach")).toHaveLength(2);
      expect(all.filter((id) => pos(id) === "QB")).toHaveLength(2);
    }
  });

  it("is deterministic for a given seed and varies across seeds", () => {
    const s = baseState(6);
    const a = dealRosters(s, ids(s), seededRng(101));
    const b = dealRosters(s, ids(s), seededRng(101));
    const c = dealRosters(s, ids(s), seededRng(102));
    expect(a.rosters).toEqual(b.rosters);
    expect(a.rosters).not.toEqual(c.rosters);
  });

  // --- pool exhaustion, one case per position (legacy lines 500-514) ---
  describe("refuses to deal from an exhausted pool", () => {
    const cases = [
      ["Coach", /Not enough available Coaches/],
      ["QB", /Not enough available QBs/],
      ["TE", /Not enough available TEs/],
      ["WR", /Not enough available WRs/],
      ["RB", /Not enough available RBs/],
    ];
    for (const [pos, pattern] of cases) {
      it("errors when no Active " + pos + "s remain", () => {
        const s = baseState(6);
        s.playerPool.forEach((p) => {
          if (p.position === pos) p.status = "OUT";
        });
        const res = dealRosters(s, ids(s), seededRng(1));
        expect(res.rosters).toBeUndefined();
        expect(res.error).toMatch(pattern);
      });
    }

    it("errors when a position has some but not enough players", () => {
      const s = baseState(6); // needs 12 QBs
      let kept = 0;
      s.playerPool.forEach((p) => {
        if (p.position === "QB" && kept++ >= 11) p.status = "OUT";
      });
      const res = dealRosters(s, ids(s), seededRng(1));
      expect(res.error).toMatch(/Not enough available QBs \(11\)/);
    });

    it("errors when the pool runs dry partway through (legacy lines 539-542)", () => {
      // Pass the up-front minimum checks, then starve the FLEX draws: both WR and RB
      // sit at exactly the minimum, so any team rolling two flexes the same way runs out.
      const s = baseState(6);
      const kept = { WR: 0, RB: 0 };
      s.playerPool.forEach((p) => {
        if (p.position === "WR" || p.position === "RB") {
          if (kept[p.position]++ >= 12) p.status = "OUT";
        }
      });
      // Try seeds until one produces an uneven FLEX split (it will, quickly).
      let sawExhaustion = false;
      for (let seed = 0; seed < 60 && !sawExhaustion; seed++) {
        const res = dealRosters(s, ids(s), seededRng(seed));
        if (res.error && /Ran out of available players while dealing/.test(res.error)) {
          sawExhaustion = true;
        }
      }
      expect(sawExhaustion).toBe(true);
    });
  });

  it("deals nothing and returns only an error when it fails", () => {
    const s = baseState(6);
    s.playerPool.forEach((p) => {
      if (p.position === "TE") p.status = "OUT";
    });
    const res = dealRosters(s, ids(s), seededRng(1));
    expect(res).toHaveProperty("error");
    expect(res).not.toHaveProperty("rosters");
    // and the caller's state is untouched
    expect(s.teams.every((t) => t.roster === null)).toBe(true);
  });
});

/* OQ-32, Scott 2026-10-26: each NFL team's top healthy RB and WR is twice as likely to be
 * dealt. The ranks reach the engine on _meta.depthRanks, from the pool refresh. */
describe("dealRosters - the top of the depth chart (OQ-32)", () => {
  /** Rank every player 1, 2, 3... within his NFL team and position, in pool order. */
  const ranked = (s) => {
    const seen = {};
    const depthRanks = {};
    for (const p of s.playerPool) {
      const key = p.team + "|" + p.position;
      seen[key] = (seen[key] || 0) + 1;
      depthRanks[p.id] = seen[key];
    }
    return { ...s, _meta: { ...(s._meta || {}), depthRanks } };
  };
  const dealtIds = (rosters) =>
    Object.values(rosters).flatMap((r) => [...Object.values(r.starters), ...r.bench]);

  it("deals exactly as before when no player has a depth-chart rank", () => {
    const s = baseState(6);
    const plain = dealRosters(s, ids(s), seededRng(5));
    const empty = dealRosters({ ...s, _meta: { depthRanks: {} } }, ids(s), seededRng(5));
    expect(empty).toEqual(plain);
  });

  it("leaves QB, TE and Coach alone - ranks there change nothing", () => {
    const s = baseState(6);
    const r = ranked(s);
    const onlyOthers = Object.fromEntries(
      Object.entries(r._meta.depthRanks).filter(([id]) => {
        const pos = s.playerPool.find((p) => p.id === id).position;
        return pos !== "RB" && pos !== "WR";
      })
    );
    const plain = dealRosters(s, ids(s), seededRng(8));
    const withRanks = dealRosters({ ...s, _meta: { depthRanks: onlyOthers } }, ids(s), seededRng(8));
    expect(withRanks).toEqual(plain);
  });

  it("still deals every team a full, legal 12 with nobody twice", () => {
    const s = ranked(baseState(12));
    for (let seed = 0; seed < 20; seed++) {
      const { rosters, error } = dealRosters(s, ids(s), seededRng(seed));
      expect(error).toBeUndefined();
      const all = dealtIds(rosters);
      expect(all).toHaveLength(12 * 12);
      expect(all.every(Boolean)).toBe(true);
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it("gives the top of each team's chart the better odds, and nobody else", () => {
    const base = baseState(12);
    const s = ranked(base);
    const top = new Set(
      [...topOfChartIds(s, s.playerPool.filter((p) => p.position === "RB")),
       ...topOfChartIds(s, s.playerPool.filter((p) => p.position === "WR"))]
    );
    const rate = (state) => {
      const hits = { top: 0, rest: 0 };
      const skill = state.playerPool.filter((p) => p.position === "RB" || p.position === "WR");
      const nTop = skill.filter((p) => top.has(p.id)).length;
      const nRest = skill.length - nTop;
      const N = 400;
      for (let seed = 0; seed < N; seed++) {
        const { rosters } = dealRosters(state, ids(state), seededRng(seed));
        for (const id of dealtIds(rosters)) {
          const p = state.playerPool.find((x) => x.id === id);
          if (p.position !== "RB" && p.position !== "WR") continue;
          if (top.has(id)) hits.top++;
          else hits.rest++;
        }
      }
      return { top: hits.top / (N * nTop), rest: hits.rest / (N * nRest) };
    };
    const even = rate(base);
    const weighted = rate(s);
    expect(Math.abs(even.top - even.rest)).toBeLessThan(0.04);
    expect(weighted.top - weighted.rest).toBeGreaterThan(0.15);
  });

  it("hands the odds to the next man when the top of the chart cannot be dealt", () => {
    const s = baseState(6);
    const rbs = s.playerPool.filter((p) => p.position === "RB" && p.team === "Arizona Cardinals");
    const [first, second] = rbs;
    const depthRanks = { [first.id]: 1, [second.id]: 2 };
    expect([...topOfChartIds({ _meta: { depthRanks } }, rbs)]).toEqual([first.id]);
    // RB1 hurt: he is not in the dealable list, so RB2 is the top healthy back this week.
    expect([...topOfChartIds({ _meta: { depthRanks } }, [second])]).toEqual([second.id]);
  });

  it("reads the ranks off the players table, leaving out anyone without one", () => {
    const player = (legacy, depth_rank) => ({
      id: "u-" + legacy, league_id: "L", legacy_id: legacy, name: legacy, position: "RB",
      nfl_team: "Buffalo Bills", status: "Active", active: true, depth_rank,
    });
    const v = hydrateLeague({
      leagues: [{ id: "L", name: "Test" }],
      seasons: [{ id: "S", league_id: "L", year: 2026, lineup_lock: "gametime" }],
      teams: [], periods: [], team_totals: [], roster_slots: [], stat_lines: [],
      schemes: [], period_results: [], events: [],
      players: [player("rb1", 1), player("rb2", 2), player("added", null)],
    });
    expect(v._meta.depthRanks).toEqual({ rb1: 1, rb2: 2 });
    // and it stays a server-owned column: an ordinary write never carries it back
    const db = decomposeLeague(v, { leagueKey: "test", year: 2026, hashCode: (c) => "h:" + c });
    expect(JSON.stringify(db.players)).not.toContain("depth_rank");
  });

  it("gives a player added by hand the normal odds, and does not let him take them away", () => {
    const charted = { id: "a", team: "Houston Texans", position: "RB" };
    const byHand = { id: "b", team: "Houston Texans", position: "RB" };
    const elsewhere = { id: "c", team: "Seattle Seahawks", position: "RB" };
    const state = { _meta: { depthRanks: { a: 2, c: 1 } } };
    expect([...topOfChartIds(state, [charted, byHand, elsewhere])].sort()).toEqual(["a", "c"]);
    expect([...topOfChartIds(state, [byHand])]).toEqual([]);
  });
});
