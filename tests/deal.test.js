import { describe, it, expect } from "vitest";
import { dealRosters, seededRng } from "../src/engine/index.js";
import { baseState } from "./helpers/fixtures.js";

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
      ["Coach", /Not enough Active Coaches/],
      ["QB", /Not enough Active QBs/],
      ["TE", /Not enough Active TEs/],
      ["WR", /Not enough Active WRs/],
      ["RB", /Not enough Active RBs/],
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
      expect(res.error).toMatch(/Not enough Active QBs \(11\)/);
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
        if (res.error && /Ran out of Active players while dealing/.test(res.error)) {
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
