import { describe, it, expect } from "vitest";
import { processSchemes, seededRng } from "../src/engine/index.js";
import { dealtState, emptyFreeAgents, rosteredIds, starter, team } from "./helpers/fixtures.js";

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

      // the stolen player came off some other team, which now holds a different QB
      const victim = s.teams.find(
        (t) => t.id !== "team_0" && Object.values(t.roster.starters).includes(newQb)
      );
      expect(victim).toBeDefined();
      const victimAfter = team(next, victim.id);
      expect(Object.values(victimAfter.roster.starters)).not.toContain(newQb);
    });

    it("skips the steal when every candidate target is blocked (legacy 609-616)", () => {
      const s = dealtState(3, 4);
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
