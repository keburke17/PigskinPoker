/**
 * Moving players by tapping their cards (OQ-34, Scott 2026-10-30).
 *
 * What lights up HERE is the whole of the rule, so it is pinned target by target: a
 * bench player sees every starting slot he fits; a starter sees the bench players who
 * fit his slot and the starters of his own position he can trade places with; and the
 * starting TE sees the FLEX through a three-way move only when one bench player fits.
 */

import { describe, expect, it } from "vitest";
import { lineupMoveTargets, moveStarter, unmoveStarter } from "../src/engine/index.js";

const POS = {
  c1: "Coach", c2: "Coach",
  q1: "QB", q2: "QB",
  w1: "WR", w2: "WR", w3: "WR",
  r1: "RB", r2: "RB",
  t1: "TE", t2: "TE",
  r3: "RB",
};
const positionOf = (id) => POS[id] ?? null;
const unlocked = () => false;

/* The deal's shape: one of each starter plus a WR in the FLEX; the bench mirrors it. */
const roster = () => ({
  starters: { Coach: "c1", QB: "q1", WR: "w1", RB: "r1", TE: "t1", FLEX: "w2" },
  bench: ["c2", "q2", "w3", "r2", "t2", "r3"],
});

const spots = (targets) =>
  targets.map((t) => (t.area === "starter" ? t.slot : "bn" + t.index) + (t.fill != null ? "+fill" + t.fill : ""));

describe("lineupMoveTargets", () => {
  it("a bench player sees every starting slot he fits", () => {
    expect(spots(lineupMoveTargets(roster(), { area: "bench", index: 2 }, positionOf, unlocked))).toEqual(["WR", "FLEX"]);
    expect(spots(lineupMoveTargets(roster(), { area: "bench", index: 1 }, positionOf, unlocked))).toEqual(["QB"]);
  });

  it("OQ-33 still holds from the bench: a TE sees TE and the FLEX", () => {
    expect(spots(lineupMoveTargets(roster(), { area: "bench", index: 4 }, positionOf, unlocked))).toEqual(["TE", "FLEX"]);
  });

  it("a WR in the FLEX can trade places with the WR, as well as with the bench", () => {
    const t = spots(lineupMoveTargets(roster(), { area: "starter", slot: "FLEX" }, positionOf, unlocked));
    expect(t).toEqual(["WR", "bn2", "bn3", "bn4", "bn5"]);
  });

  it("a starter never sees a starter of another position - an RB cannot trade with the FLEX WR", () => {
    const t = spots(lineupMoveTargets(roster(), { area: "starter", slot: "WR" }, positionOf, unlocked));
    expect(t).toEqual(["FLEX", "bn2"]);
    // The RB sees the FLEX only as a three-way, and two bench RBs means no three-way.
    expect(spots(lineupMoveTargets(roster(), { area: "starter", slot: "RB" }, positionOf, unlocked))).toEqual(["bn3", "bn5"]);
  });

  it("the starting TE reaches the FLEX through the bench TE", () => {
    const t = lineupMoveTargets(roster(), { area: "starter", slot: "TE" }, positionOf, unlocked);
    expect(spots(t)).toEqual(["FLEX+fill4", "bn4"]);
  });

  it("no three-way when the only bench player who fits is locked", () => {
    const t = lineupMoveTargets(roster(), { area: "starter", slot: "TE" }, positionOf, (id) => id === "t2");
    expect(spots(t)).toEqual(["bn4"]);
    expect(t[0].locked).toBe(true);
  });

  it("a locked occupant is still listed, marked locked", () => {
    const t = lineupMoveTargets(roster(), { area: "bench", index: 2 }, positionOf, (id) => id === "w1");
    expect(t.find((x) => x.slot === "WR").locked).toBe(true);
    expect(t.find((x) => x.slot === "FLEX").locked).toBe(false);
  });

  it("the Coach and QB only ever trade with their own bench player", () => {
    expect(spots(lineupMoveTargets(roster(), { area: "starter", slot: "Coach" }, positionOf, unlocked))).toEqual(["bn0"]);
    expect(spots(lineupMoveTargets(roster(), { area: "starter", slot: "QB" }, positionOf, unlocked))).toEqual(["bn1"]);
  });

  it("an empty place has nothing to move", () => {
    const r = roster();
    r.starters.WR = null;
    expect(lineupMoveTargets(r, { area: "starter", slot: "WR" }, positionOf, unlocked)).toEqual([]);
  });
});

describe("moveStarter", () => {
  it("two starters trade places and the bench is untouched", () => {
    const after = moveStarter(roster(), "FLEX", "WR", null);
    expect(after.starters.WR).toBe("w2");
    expect(after.starters.FLEX).toBe("w1");
    expect(after.bench).toEqual(roster().bench);
  });

  it("the three-way: TE into the FLEX, bench TE to TE, the FLEX WR to the bench", () => {
    const after = moveStarter(roster(), "TE", "FLEX", 4);
    expect(after.starters.FLEX).toBe("t1");
    expect(after.starters.TE).toBe("t2");
    expect(after.bench[4]).toBe("w2");
  });

  it("the same six players start after a straight trade, so the score cannot move", () => {
    const before = Object.values(roster().starters).sort();
    expect(Object.values(moveStarter(roster(), "FLEX", "WR", null).starters).sort()).toEqual(before);
  });

  it("unmoveStarter undoes either kind exactly", () => {
    for (const [from, to, fill] of [["FLEX", "WR", null], ["TE", "FLEX", 4]]) {
      expect(unmoveStarter(moveStarter(roster(), from, to, fill), from, to, fill)).toEqual(roster());
    }
  });

  it("does not touch the roster it was given", () => {
    const r = roster();
    moveStarter(r, "TE", "FLEX", 4);
    expect(r).toEqual(roster());
  });
});
