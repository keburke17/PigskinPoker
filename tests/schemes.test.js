import { describe, it, expect } from "vitest";
import { FLEX_POSITIONS, TOP_OF_CHART_WEIGHT, getPlayer, pickWeighted, processSchemes, seededRng, slotAcceptsPosition } from "../src/engine/index.js";
import { clearBench, dealtState, emptyFreeAgents, onRoster, rosteredIds, starter, team } from "./helpers/fixtures.js";

const scheme = (type, position, playerId) => ({
  type,
  position,
  playerId,
  submittedAt: "2026-08-17T12:00:00.000Z",
});

describe("processSchemes", () => {
  it("clears schemes and appends to the activity log", () => {
    const s = dealtState(4, 1);
    s.schemes = { team_0: scheme("redraw", "WR", starter(s, "team_0", "WR")) };
    const next = processSchemes(s, seededRng(5));
    expect(next.schemes).toEqual({});
    expect(next.activityLog.length).toBe(1);
    expect(next.activityLog[0].type).toBe("redraw");
  });

  it("does not mutate the state passed in", () => {
    const s = dealtState(4, 1);
    const before = JSON.stringify(s);
    s.schemes = { team_0: scheme("redraw", "WR", starter(s, "team_0", "WR")) };
    const snapshot = JSON.stringify(s);
    processSchemes(s, seededRng(5));
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(snapshot).not.toBe(before); // sanity: we did add a scheme
  });

  describe("block", () => {
    it("protects the blocked player and logs it", () => {
      const s = dealtState(4, 2);
      const protectedQb = starter(s, "team_1", "QB");
      s.schemes = { team_1: scheme("block", "QB", protectedQb) };
      const next = processSchemes(s, seededRng(5));
      expect(next.activityLog[0].type).toBe("block");
      expect(next.activityLog[0].text).toMatch(/blocked/);
      // still on team_1
      expect(starter(next, "team_1", "QB")).toBe(protectedQb);
    });
  });

  describe("steal", () => {
    it("moves the target into the thief's slot and gives the victim a free agent", () => {
      const s = dealtState(4, 3);
      const dropped = starter(s, "team_0", "QB");
      s.schemes = { team_0: scheme("steal", "QB", dropped) };
      const next = processSchemes(s, seededRng(11));

      const log = next.activityLog.find((e) => e.type === "steal");
      expect(log).toBeDefined();

      const newQb = starter(next, "team_0", "QB");
      expect(newQb).not.toBe(dropped);

      // the stolen player came off some other team's roster - starters or, since OQ-36,
      // the bench - and that team no longer holds him
      const victim = s.teams.find((t) => t.id !== "team_0" && onRoster(s, t.id).includes(newQb));
      expect(victim).toBeDefined();
      expect(onRoster(next, victim.id)).not.toContain(newQb);
    });

    it("skips the steal when every candidate target is blocked (legacy 609-616)", () => {
      const s = dealtState(3, 4);
      clearBench(s, "QB", ["team_1", "team_2"]);
      const before = JSON.stringify(s.teams);
      s.schemes = {
        team_0: scheme("steal", "QB", starter(s, "team_0", "QB")),
        team_1: scheme("block", "QB", starter(s, "team_1", "QB")),
        team_2: scheme("block", "QB", starter(s, "team_2", "QB")),
      };
      const next = processSchemes(s, seededRng(77));

      const failed = next.activityLog.find((e) => e.type === "steal-failed");
      expect(failed).toBeDefined();
      expect(failed.text).toMatch(/no eligible \(unprotected\) target was found/);
      expect(failed.text).toMatch(/roster unchanged/);
      // rosters genuinely unchanged
      expect(JSON.stringify(next.teams)).toBe(before);
    });

    /* The empty-pool branch on a STEAL is much harder to reach than it looks, and the
     * reason is a deliberate ordering asymmetry in the engine:
     *
     *   steal  - the acting team's slot is overwritten FIRST (legacy 620-621), THEN the
     *            replacement is looked up (623). So the player just dropped is already
     *            un-rostered and becomes a valid free agent for the victim. That is the
     *            documented rule: "dropped players go straight back into the free-agent
     *            pool, even mid-processing."
     *   redraw - the replacement is looked up FIRST (641), THEN the slot is overwritten.
     *            So you can never be handed back the player you just dropped.
     *
     * Both orderings are correct and worth preserving. The consequence is that a steal
     * only leaves an empty slot if the dropped player is ALSO ineligible - i.e. the
     * commissioner marked him OUT/IR/BYE after the deal. That is what this sets up.
     */
    it("leaves the victim's slot empty when the free-agent pool is dry (legacy 623-639)", () => {
      const s = dealtState(3, 5);
      emptyFreeAgents(s, "QB");
      const dropped = starter(s, "team_0", "QB");
      s.playerPool.find((p) => p.id === dropped).status = "OUT";
      s.schemes = { team_0: scheme("steal", "QB", dropped) };
      const next = processSchemes(s, seededRng(31));

      const steal = next.activityLog.find((e) => e.type === "steal");
      expect(steal.text).toMatch(/no replacement - free-agent pool empty at QB/);

      const warn = next.activityLog.find((e) => e.type === "warning");
      expect(warn).toBeDefined();
      expect(warn.text).toMatch(/that slot is now empty/);

      // exactly one starter slot across the league is now null
      const empties = next.teams.flatMap((t) =>
        Object.entries(t.roster.starters).filter(([, id]) => id === null)
      );
      expect(empties).toHaveLength(1);
    });

    it("hands the dropped player to the victim when he is still eligible", () => {
      // The common case, and the reason the branch above needs an OUT player to trigger.
      const s = dealtState(3, 5);
      emptyFreeAgents(s, "QB");
      const dropped = starter(s, "team_0", "QB");
      s.schemes = { team_0: scheme("steal", "QB", dropped) };
      const next = processSchemes(s, seededRng(31));

      const steal = next.activityLog.find((e) => e.type === "steal");
      expect(steal.text).not.toMatch(/no replacement/);
      expect(next.activityLog.find((e) => e.type === "warning")).toBeUndefined();
      // the dropped player landed on the victim's roster
      const holder = next.teams.find((t) =>
        Object.values(t.roster.starters).includes(dropped)
      );
      expect(holder).toBeDefined();
      expect(holder.id).not.toBe("team_0");
    });
  });

  describe("redraw", () => {
    it("replaces the dropped player with a free agent at the same position", () => {
      const s = dealtState(4, 6);
      const dropped = starter(s, "team_2", "WR");
      const rosteredBefore = rosteredIds(s);
      s.schemes = { team_2: scheme("redraw", "WR", dropped) };
      const next = processSchemes(s, seededRng(19));

      const replacement = starter(next, "team_2", "WR");
      expect(replacement).not.toBe(dropped);
      expect(rosteredBefore.has(replacement)).toBe(false); // was a free agent
      const p = next.playerPool.find((x) => x.id === replacement);
      expect(p.position).toBe("WR"); // exact same position, never flexible
      expect(next.activityLog[0].type).toBe("redraw");
    });

    it("empties the slot when no free agent is available at that position", () => {
      const s = dealtState(3, 7);
      emptyFreeAgents(s, "TE");
      s.schemes = { team_0: scheme("redraw", "TE", starter(s, "team_0", "TE")) };
      const next = processSchemes(s, seededRng(23));

      expect(starter(next, "team_0", "TE")).toBeNull();
      expect(next.activityLog[0].text).toMatch(/no replacement - free-agent pool empty at TE/);
    });

    it("can redraw a bench player, replacing it in place", () => {
      const s = dealtState(3, 8);
      const t = team(s, "team_0");
      const benchIdx = t.roster.bench.findIndex(
        (id) => s.playerPool.find((p) => p.id === id).position === "WR"
      );
      const dropped = t.roster.bench[benchIdx];
      s.schemes = { team_0: scheme("redraw", "WR", dropped) };
      const next = processSchemes(s, seededRng(29));
      expect(team(next, "team_0").roster.bench[benchIdx]).not.toBe(dropped);
      expect(team(next, "team_0").roster.bench).toHaveLength(6);
    });
  });

  it("skips gracefully when the named player is no longer on the roster", () => {
    const s = dealtState(3, 9);
    s.schemes = { team_0: scheme("redraw", "WR", "p_does_not_exist") };
    const next = processSchemes(s, seededRng(13));
    expect(next.activityLog).toHaveLength(0);
    expect(next.schemes).toEqual({});
  });

  it("is deterministic for a given seed", () => {
    const s = dealtState(5, 12);
    s.schemes = {
      team_0: scheme("steal", "QB", starter(s, "team_0", "QB")),
      team_1: scheme("redraw", "WR", starter(s, "team_1", "WR")),
      team_2: scheme("block", "TE", starter(s, "team_2", "TE")),
    };
    const a = processSchemes(s, seededRng(55));
    const b = processSchemes(s, seededRng(55));
    expect(JSON.stringify(a.teams)).toBe(JSON.stringify(b.teams));
  });
});

/* OQ-33, Scott 2026-10-26: the FLEX is still DEALT a WR or an RB, but a manager may start a
 * TE there afterwards. These pin both halves, and what a scheme does to a FLEX TE. */
describe("a TE in the FLEX", () => {
  const tePositions = (t) =>
    Object.values(t.roster.starters).concat(t.roster.bench).filter(Boolean);

  /** Swap team's bench TE into its FLEX, the way the lineup screen would. */
  const startBothTes = (s, id) => {
    const r = team(s, id).roster;
    const benchTe = r.bench.findIndex((pid) => getPlayer(s, pid)?.position === "TE");
    const flex = r.starters.FLEX;
    r.starters.FLEX = r.bench[benchTe];
    r.bench[benchTe] = flex;
  };

  it("the FLEX takes a WR, RB or TE, and every other slot only its own position", () => {
    expect(FLEX_POSITIONS).toEqual(["WR", "RB", "TE"]);
    ["WR", "RB", "TE"].forEach((p) => expect(slotAcceptsPosition("FLEX", p)).toBe(true));
    ["QB", "Coach"].forEach((p) => expect(slotAcceptsPosition("FLEX", p)).toBe(false));
    expect(slotAcceptsPosition("TE", "TE")).toBe(true);
    expect(slotAcceptsPosition("TE", "WR")).toBe(false);
    expect(slotAcceptsPosition("QB", "TE")).toBe(false);
  });

  it("the deal still never puts a TE in the FLEX, and still deals each team exactly 2", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = dealtState(12, seed);
      s.teams.forEach((t) => {
        expect(["WR", "RB"]).toContain(getPlayer(s, t.roster.starters.FLEX).position);
        expect(["WR", "RB"]).toContain(getPlayer(s, t.roster.bench[5]).position);
        const tes = tePositions(t).filter((pid) => getPlayer(s, pid).position === "TE");
        expect(tes.length).toBe(2);
      });
    }
  });

  it("a FLEX TE can be stolen, and the team robbed gets a free-agent TE in the FLEX", () => {
    const s = dealtState(2, 9);
    startBothTes(s, "team_1");
    const flexTe = starter(s, "team_1", "FLEX");
    const dropped = starter(s, "team_0", "TE");
    s.schemes = {
      team_0: scheme("steal", "TE", dropped),
      // Blocking the TE slot leaves the FLEX TE as the only target.
      team_1: scheme("block", "TE", starter(s, "team_1", "TE")),
    };
    const next = processSchemes(s, seededRng(3));

    expect(starter(next, "team_0", "TE")).toBe(flexTe);
    const replacement = getPlayer(next, starter(next, "team_1", "FLEX"));
    expect(replacement.position).toBe("TE");
    expect(replacement.id).not.toBe(flexTe);
    next.teams.forEach((t) => {
      const tes = tePositions(t).filter((pid) => getPlayer(next, pid).position === "TE");
      expect(tes.length).toBe(2);
    });
  });

  it("redrawing a FLEX TE brings back a free-agent TE in the FLEX", () => {
    const s = dealtState(2, 9);
    startBothTes(s, "team_0");
    const flexTe = starter(s, "team_0", "FLEX");
    s.schemes = { team_0: scheme("redraw", "TE", flexTe) };
    const next = processSchemes(s, seededRng(3));
    const replacement = getPlayer(next, starter(next, "team_0", "FLEX"));
    expect(replacement.position).toBe("TE");
    expect(replacement.id).not.toBe(flexTe);
  });
});

/* OQ-36, Scott 2026-11-05. The bench can be stolen, a Block covers anyone on your roster,
 * and Steal and Redraw lean toward each NFL team's top RB and WR the way the deal does. */
describe("processSchemes - the bench can be stolen (OQ-36)", () => {
  const benchAt = (s, id, pos) =>
    team(s, id).roster.bench.find((pid) => pid && getPlayer(s, pid).position === pos);

  it("takes a bench player when the only unprotected target is on the bench", () => {
    const s = dealtState(2, 4);
    const dropped = starter(s, "team_0", "QB");
    const blockedStarter = starter(s, "team_1", "QB");
    const benchQb = benchAt(s, "team_1", "QB");
    expect(benchQb).toBeDefined();
    const benchIndex = team(s, "team_1").roster.bench.indexOf(benchQb);
    s.schemes = {
      team_0: scheme("steal", "QB", dropped),
      team_1: scheme("block", "QB", blockedStarter),
    };
    const next = processSchemes(s, seededRng(9));

    expect(starter(next, "team_0", "QB")).toBe(benchQb);
    expect(starter(next, "team_1", "QB")).toBe(blockedStarter);
    const fill = team(next, "team_1").roster.bench[benchIndex];
    expect(fill).not.toBe(benchQb);
    expect(getPlayer(next, fill).position).toBe("QB");
    expect(next.activityLog.find((e) => e.type === "steal").text).toMatch(/stole QB/);
  });

  it("a Block on a bench player protects him, on every seed", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = dealtState(2, 4);
      const benchQb = benchAt(s, "team_1", "QB");
      const starterQb = starter(s, "team_1", "QB");
      s.schemes = {
        team_0: scheme("steal", "QB", starter(s, "team_0", "QB")),
        team_1: scheme("block", "QB", benchQb),
      };
      const next = processSchemes(s, seededRng(seed));
      expect(onRoster(next, "team_1")).toContain(benchQb);
      expect(starter(next, "team_0", "QB")).toBe(starterQb);
    }
  });

  it("over many seeds, steals land on bench players as well as starters", () => {
    let bench = 0;
    let starters = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = dealtState(4, 3);
      s.schemes = { team_0: scheme("steal", "WR", starter(s, "team_0", "WR")) };
      const got = starter(processSchemes(s, seededRng(seed)), "team_0", "WR");
      const wasBench = s.teams.some((t) => t.id !== "team_0" && t.roster.bench.includes(got));
      if (wasBench) bench++;
      else starters++;
    }
    expect(bench).toBeGreaterThan(0);
    expect(starters).toBeGreaterThan(0);
  });
});

describe("pickWeighted - Steal and Redraw lean toward the 1s (OQ-36)", () => {
  const rb = (id, team) => ({ id, name: id, position: "RB", team, status: "Active" });
  const stateWith = (pool, ranks) => ({ ...dealtState(2, 1), playerPool: pool, _meta: { depthRanks: ranks } });

  it("with nobody ranked it is the old even pick, random number for random number", () => {
    const s = dealtState(4, 2);
    const candidates = s.playerPool.filter((p) => p.position === "RB").slice(0, 7);
    for (let seed = 1; seed <= 20; seed++) {
      const even = candidates[Math.floor(seededRng(seed)() * candidates.length)];
      expect(pickWeighted(s, "RB", candidates, seededRng(seed))).toBe(even);
    }
  });

  it("makes a team's top RB TOP_OF_CHART_WEIGHT times as likely as anyone else", () => {
    const pool = [rb("a1", "AAA"), rb("a2", "AAA"), rb("b2", "BBB"), rb("b1", "BBB")];
    const s = stateWith(pool, { a1: 1, a2: 2, b1: 1, b2: 2 });
    const candidates = [pool[0], pool[1]]; // a1 is AAA's top RB, a2 is not
    const rng = seededRng(2026);
    let top = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) if (pickWeighted(s, "RB", candidates, rng).id === "a1") top++;
    const expected = TOP_OF_CHART_WEIGHT / (TOP_OF_CHART_WEIGHT + 1); // 3-to-1 is 0.75
    expect(Math.abs(top / N - expected)).toBeLessThan(0.05);
  });

  it("measures 'top' against the whole pool, not the candidates", () => {
    // a1 is AAA's real RB1 and is not a candidate (say he is already on a roster), so a2
    // is NOT promoted to a 1 just because he is the best AAA back left in the list. Same
    // for b2 beside BBB's b1.
    const pool = [rb("a1", "AAA"), rb("a2", "AAA"), rb("b2", "BBB"), rb("b1", "BBB")];
    const s = stateWith(pool, { a1: 1, a2: 2, b2: 2, b1: 1 });
    const candidates = [pool[1], pool[2]];
    for (let seed = 1; seed <= 20; seed++) {
      const even = candidates[Math.floor(seededRng(seed)() * candidates.length)];
      expect(pickWeighted(s, "RB", candidates, seededRng(seed))).toBe(even);
    }
  });

  it("leaves QB, TE and Coach even", () => {
    const qbs = [
      { id: "q1", name: "q1", position: "QB", team: "AAA", status: "Active" },
      { id: "q2", name: "q2", position: "QB", team: "BBB", status: "Active" },
    ];
    const s = stateWith(qbs, { q1: 1, q2: 1 });
    for (let seed = 1; seed <= 10; seed++) {
      expect(pickWeighted(s, "QB", qbs, seededRng(seed))).toBe(qbs[Math.floor(seededRng(seed)() * 2)]);
    }
  });

  it("a redraw leans toward the top free-agent RBs", () => {
    let topHits = 0;
    let runs = 0;
    let evenRuns = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = dealtState(2, 6);
      // Rank by pool order within NFL team, as the deal tests do.
      const seen = {};
      const depthRanks = {};
      for (const p of s.playerPool) {
        const key = p.team + "|" + p.position;
        seen[key] = (seen[key] || 0) + 1;
        depthRanks[p.id] = seen[key];
      }
      s._meta = { depthRanks };
      const rostered = rosteredIds(s);
      const free = s.playerPool.filter((p) => p.position === "RB" && !rostered.has(p.id));
      const tops = new Set(free.filter((p) => depthRanks[p.id] === 1).map((p) => p.id));
      const share = tops.size / free.length;
      s.schemes = { team_0: scheme("redraw", "RB", starter(s, "team_0", "RB")) };
      const got = starter(processSchemes(s, seededRng(seed)), "team_0", "RB");
      // Expected share with w-to-1 odds: wt / (wt + (1 - t)).
      const w = TOP_OF_CHART_WEIGHT;
      runs += (w * share) / (w * share + (1 - share));
      evenRuns += share;
      if (tops.has(got)) topHits++;
    }
    const expected = runs / 300;
    expect(Math.abs(topHits / 300 - expected)).toBeLessThan(0.08);
    // And it is a real lean, clear of the even odds.
    expect(topHits / 300).toBeGreaterThan(evenRuns / 300 + 0.05);
  });
});
