/**
 * A player whose NFL team has no game this week (OQ-25).
 *
 * Scott's ruling of 2026-09-08: "the deal should skip a player who has no game scheduled.
 * they cannot be redrawn, stolen, or dealt to teams at all. once they have a game scheduled
 * they will resume being placed in the deal."
 *
 * Three things are tested here and they are of different kinds. The rule itself is one
 * function. The three doors onto a roster - deal, redraw, steal - each have to be shut, and
 * a gap in any one of them puts the dead card back. And the two ways of KNOWING NOTHING
 * have to keep dealing everybody, because a rule that quietly empties the pool when a CSV
 * is slow is worse than the bye weeks it was meant to fix.
 *
 * Nothing here touches the network or a clock.
 */

import { describe, expect, it } from "vitest";
import {
  byeCountAt,
  dealRosters,
  isOnByeThisWeek,
  isPlayerAvailable,
  processSchemes,
  seededRng,
} from "../src/engine/index.js";

const PLAYING = { at: "2026-09-13T17:00:00.000Z", opp: "OPP", home: true };

/* Two NFL teams' worth of players, one of them on a bye. Small enough to reason about,
 * big enough to deal one team a full hand of twelve. */
const pool = () => {
  const out = [];
  let n = 1;
  const push = (team, position, count) => {
    for (let i = 0; i < count; i++) {
      out.push({ id: "p" + n, name: team + " " + position + " " + n, position, team, status: "Active" });
      n++;
    }
  };
  ["Chicago Bears", "Detroit Lions", "Green Bay Packers", "Kansas City Chiefs"].forEach((team) => {
    push(team, "Coach", 1);
    push(team, "QB", 1);
    push(team, "RB", 2);
    push(team, "WR", 2);
    push(team, "TE", 1);
  });
  return out;
};

/* Everyone plays except Kansas City. */
const KICKOFFS = {
  "Chicago Bears": PLAYING,
  "Detroit Lions": PLAYING,
  "Green Bay Packers": PLAYING,
};

const state = (over = {}) => ({
  playerPool: pool(),
  teams: [],
  _meta: { kickoffs: KICKOFFS },
  ...over,
});

const chief = (s) => s.playerPool.find((p) => p.team === "Kansas City Chiefs");
const bear = (s) => s.playerPool.find((p) => p.team === "Chicago Bears");

describe("the rule: who is sitting out", () => {
  it("says so only when the schedule positively says so", () => {
    const s = state();
    expect(isOnByeThisWeek(s, chief(s))).toBe(true);
    expect(isOnByeThisWeek(s, bear(s))).toBe(false);
  });

  /* WHY THIS IS NOT AN OVERSIGHT. Before a week's times are read, every player in the pool
   * looks exactly like a player on a bye - so filtering on that would deal nobody at all. */
  it("says nobody is on a bye when no schedule has been read", () => {
    const s = state({ _meta: { kickoffs: {} } });
    expect(isOnByeThisWeek(s, chief(s))).toBe(false);
    expect(isPlayerAvailable(s, chief(s))).toBe(true);
    expect(isOnByeThisWeek(state({ _meta: {} }), chief(state()))).toBe(false);
  });

  /* A commissioner can type any team he likes when he adds a rookie by hand. A typo must not
   * remove that player from every deal forever with nothing on screen saying why. */
  it("never benches a player on a team the schedule cannot speak about", () => {
    const s = state();
    const homemade = { id: "px", name: "Hand Added", position: "QB", team: "Practice Squad", status: "Active" };
    expect(isOnByeThisWeek(s, homemade)).toBe(false);
    expect(isPlayerAvailable(s, homemade)).toBe(true);
  });

  it("still lets a commissioner's own status decide first", () => {
    const s = state();
    const hurt = { ...bear(s), status: "OUT" };
    expect(isPlayerAvailable(s, hurt)).toBe(false);
    /* And a hand-set BYE keeps working exactly as it always did. */
    expect(isPlayerAvailable(s, { ...bear(s), status: "BYE" })).toBe(false);
  });

  it("counts the byes at a position, for the message a deal refuses with", () => {
    const s = state();
    expect(byeCountAt(s, "QB")).toBe(1); // Kansas City's
    expect(byeCountAt(s, "RB")).toBe(2);
    expect(byeCountAt(state({ _meta: { kickoffs: {} } }), "QB")).toBe(0);
  });
});

describe("door one: the deal", () => {
  it("deals nobody whose team is not playing", () => {
    const s = state();
    const benched = new Set(s.playerPool.filter((p) => p.team === "Kansas City Chiefs").map((p) => p.id));
    const res = dealRosters(s, ["t1"], seededRng(3));
    expect(res.error).toBeUndefined();
    const dealt = Object.values(res.rosters.t1.starters).concat(res.rosters.t1.bench);
    expect(dealt).toHaveLength(12);
    expect(dealt.filter((id) => benched.has(id))).toEqual([]);
  });

  /* THE SECOND HALF OF SCOTT'S SENTENCE: "once they have a game scheduled they will resume
   * being placed in the deal". Nothing is written down and nothing has to be undone - the
   * same pool deals them again the moment the schedule has them playing. */
  it("deals them again the week their team has a game", () => {
    const s = state({ _meta: { kickoffs: { ...KICKOFFS, "Kansas City Chiefs": PLAYING } } });
    const chiefs = new Set(s.playerPool.filter((p) => p.team === "Kansas City Chiefs").map((p) => p.id));
    /* Deal every team so the whole pool is exhausted - then a Chief must be among them. */
    const res = dealRosters(s, ["t1", "t2"], seededRng(3));
    expect(res.error).toBeUndefined();
    const dealt = Object.values(res.rosters).flatMap((r) => Object.values(r.starters).concat(r.bench));
    expect(dealt.some((id) => chiefs.has(id))).toBe(true);
  });

  it("refuses in words that name the byes, rather than a number that looks wrong", () => {
    const s = state();
    /* Three playing teams cannot fill two rosters at Coach: 3 available, 4 needed. */
    const res = dealRosters(s, ["t1", "t2"], seededRng(3));
    expect(res.error).toMatch(/Not enough available Coaches \(3, with 1 more on a bye this week\)/);
  });

  it("says nothing about byes when there are none to mention", () => {
    const s = state({ _meta: { kickoffs: {} } });
    const res = dealRosters(s, ["t1", "t2", "t3"], seededRng(3));
    expect(res.error).toMatch(/Not enough available Coaches \(4\)/);
    expect(res.error).not.toMatch(/bye/);
  });
});

/* The scheme doors. Both need a dealt league to act on, so this builds one by hand rather
 * than dealing it - the point is which players a scheme may REACH, not how they got there. */
const dealtLeague = (over = {}) => {
  const s = state({ ...over });
  const ids = s.playerPool;
  const at = (team, position) => ids.find((p) => p.team === team && p.position === position).id;
  const hand = (team) => ({
    starters: {
      Coach: at(team, "Coach"),
      QB: at(team, "QB"),
      WR: ids.find((p) => p.team === team && p.position === "WR").id,
      RB: ids.find((p) => p.team === team && p.position === "RB").id,
      TE: at(team, "TE"),
      FLEX: ids.filter((p) => p.team === team && p.position === "WR")[1].id,
    },
    bench: [],
  });
  s.teams = [
    { id: "t1", name: "One", roster: hand("Chicago Bears") },
    { id: "t2", name: "Two", roster: hand("Detroit Lions") },
  ];
  s.currentPeriod = { type: "week", number: 1, phase: "dealt" };
  s.activityLog = [];
  return s;
};

describe("door two: the redraw", () => {
  it("never hands back a player who is not playing", () => {
    /* Only Kansas City and Green Bay are free agents at QB; Kansas City is on a bye, so
     * Green Bay's is the only man a redraw can land on, every time. */
    const s = dealtLeague();
    const kcQB = s.playerPool.find((p) => p.team === "Kansas City Chiefs" && p.position === "QB").id;
    const gbQB = s.playerPool.find((p) => p.team === "Green Bay Packers" && p.position === "QB").id;
    for (let seed = 1; seed <= 12; seed++) {
      const league = dealtLeague();
      league.schemes = { t1: { type: "redraw", position: "QB", playerId: league.teams[0].roster.starters.QB } };
      const next = processSchemes(league, seededRng(seed));
      const got = next.teams[0].roster.starters.QB;
      expect(got).not.toBe(kcQB);
      expect(got).toBe(gbQB);
    }
  });

  it("would have handed him back before the schedule was known", () => {
    /* The same league with no schedule read: Kansas City is a live free agent again, and
     * across a dozen seeds a redraw lands on him at least once. This is what the rule
     * changed. */
    const kcQB = dealtLeague().playerPool.find((p) => p.team === "Kansas City Chiefs" && p.position === "QB").id;
    let landedOnHim = false;
    for (let seed = 1; seed <= 12; seed++) {
      const league = dealtLeague({ _meta: { kickoffs: {} } });
      league.schemes = { t1: { type: "redraw", position: "QB", playerId: league.teams[0].roster.starters.QB } };
      const next = processSchemes(league, seededRng(seed));
      if (next.teams[0].roster.starters.QB === kcQB) landedOnHim = true;
    }
    expect(landedOnHim).toBe(true);
  });
});

describe("door three: the steal", () => {
  /* Mostly belt and braces now the deal is shut - but a lineup dealt before the schedule was
   * read can still hold a player who is not playing, and a game can be postponed after the
   * deal. Spending a team's one action for the week on a guaranteed zero is not a trap worth
   * leaving open. */
  it("will not take a player whose team stopped playing", () => {
    const league = dealtLeague();
    /* Team two's QB is put on a team that is no longer in the schedule - a postponement. */
    const victimQB = league.teams[1].roster.starters.QB;
    league.playerPool = league.playerPool.map((p) =>
      p.id === victimQB ? { ...p, team: "Kansas City Chiefs" } : p
    );
    league.schemes = { t1: { type: "steal", position: "QB", playerId: league.teams[0].roster.starters.QB } };
    const next = processSchemes(league, seededRng(4));

    expect(next.teams[0].roster.starters.QB).toBe(league.teams[0].roster.starters.QB); // unchanged
    expect(next.teams[1].roster.starters.QB).toBe(victimQB); // still theirs
    expect(next.activityLog.some((a) => a.type === "steal-failed")).toBe(true);
  });

  it("still takes one who is playing", () => {
    const league = dealtLeague();
    const victimQB = league.teams[1].roster.starters.QB;
    league.schemes = { t1: { type: "steal", position: "QB", playerId: league.teams[0].roster.starters.QB } };
    const next = processSchemes(league, seededRng(4));
    expect(next.teams[0].roster.starters.QB).toBe(victimQB);
    expect(next.activityLog.some((a) => a.type === "steal")).toBe(true);
  });
});
