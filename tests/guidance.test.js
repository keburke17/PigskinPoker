/**
 * The "what do I do next?" copy (issues #24, #25, #26).
 *
 * Pure functions, no DOM, no stack - which is the point of putting the logic in
 * src/components/guidance.js rather than inline in a component. The overlay, the
 * persistent note and the Help tab all read this, so pinning it here pins all three.
 *
 * THE LOCK ASSERTIONS AT THE BOTTOM MATTER MOST. There is no automatic roster freeze in
 * this game - no Thursday cutoff, no kickoff timer - and help text that invents one
 * would be a rules change made in prose. These tests fail if that sentence drifts.
 */

import { describe, it, expect } from "vitest";
import { nextStep } from "../src/components/guidance.js";

const stateWith = (over = {}) => ({
  leagueName: "Test League",
  teams: over.teams ?? [{ id: "t1", name: "Burke", roster: null }],
  schemes: over.schemes ?? {},
  rosterLocked: over.rosterLocked ?? false,
  currentPeriod: over.currentPeriod ?? { type: "week", number: 1, phase: "pre-deal" },
  _meta: over._meta ?? {},
});

const withRoster = (t) => ({ ...t, roster: { starters: {}, bench: [] } });

describe("nextStep, as a commissioner", () => {
  it("asks for teams before anything else, even at pre-deal", () => {
    const step = nextStep(stateWith({ teams: [] }), "commissioner", null);
    expect(step.headline).toMatch(/Add your teams/i);
    expect(step.tab).toBe("comm");
  });

  it("asks for the deal once there are teams", () => {
    const step = nextStep(stateWith(), "commissioner", null);
    expect(step.headline).toMatch(/Deal Week 1/);
  });

  it("names the round, not the week, in the playoffs", () => {
    const step = nextStep(
      stateWith({ currentPeriod: { type: "playoff", number: 2, phase: "pre-deal" } }),
      "commissioner",
      null
    );
    expect(step.headline).toMatch(/Round 2/);
  });

  it("waits for schemes once dealt, and asks for stats once locked", () => {
    const dealt = stateWith({ currentPeriod: { type: "week", number: 1, phase: "dealt" } });
    expect(nextStep(dealt, "commissioner", null).headline).toMatch(/process/i);
    expect(nextStep({ ...dealt, rosterLocked: true }, "commissioner", null).headline).toMatch(/stats/i);
  });
});

describe("nextStep, as a manager", () => {
  const team = { id: "t1", name: "Burke", roster: null };

  it("says to wait before the deal, and does not offer a tab to open", () => {
    const step = nextStep(stateWith(), "manager", team);
    expect(step.headline).toMatch(/Nothing to do yet/i);
    expect(step.tab).toBeNull();
  });

  it("says to submit a scheme once the roster is dealt", () => {
    const state = stateWith({ currentPeriod: { type: "week", number: 2, phase: "dealt" } });
    const step = nextStep(state, "manager", withRoster(team));
    expect(step.headline).toMatch(/submit a scheme/i);
    expect(step.tab).toBe("myteam");
  });

  it("confirms the scheme by name once one is on file", () => {
    const state = stateWith({
      currentPeriod: { type: "week", number: 2, phase: "dealt" },
      schemes: { t1: { type: "steal", position: "WR", playerId: "p1" } },
    });
    expect(nextStep(state, "manager", withRoster(team)).headline).toMatch(/Steal is on file/);
  });

  it("names No Action rather than treating it as nothing submitted", () => {
    /* No Action is a real choice, and a manager who picked it should not be told to go
     * and pick one. */
    const state = stateWith({
      currentPeriod: { type: "week", number: 2, phase: "dealt" },
      schemes: { t1: { type: "noaction", position: null, playerId: null } },
    });
    expect(nextStep(state, "manager", withRoster(team)).headline).toMatch(/No Action is on file/);
  });

  it("a dealt phase with no roster of your own still reads as waiting", () => {
    // A team added mid-week has no roster until the next deal.
    const state = stateWith({ currentPeriod: { type: "week", number: 3, phase: "dealt" } });
    expect(nextStep(state, "manager", team).headline).toMatch(/Nothing to do yet/i);
  });
});

describe("the lock copy tells the truth about when things freeze", () => {
  const team = { id: "t1", name: "Burke", roster: null };
  const locked = stateWith({
    currentPeriod: { type: "week", number: 4, phase: "dealt" },
    rosterLocked: true,
  });

  it("says schemes are closed but lineup swaps are not", () => {
    const step = nextStep(locked, "manager", withRoster(team));
    expect(step.headline).toMatch(/locked/i);
    expect(step.detail).toMatch(/still swap/i);
  });

  it("never promises a weekday or a kickoff deadline anywhere", () => {
    /* REGRESSION GUARD. Both locks are buttons the commissioner presses
     * (src/components/stats.jsx, src/components/lineup.jsx); nothing in this app fires
     * on a clock. Copy that says "Thursday" or "by kickoff" would be documenting a rule
     * that does not exist, in a league people are actually playing. */
    const states = [
      stateWith(),
      stateWith({ currentPeriod: { type: "week", number: 4, phase: "dealt" } }),
      stateWith({ currentPeriod: { type: "week", number: 4, phase: "schemes-processed" } }),
      locked,
    ];
    const roles = [["commissioner", null], ["manager", withRoster(team)]];
    for (const s of states) {
      for (const [role, t] of roles) {
        const step = nextStep(s, role, t);
        const text = step.headline + " " + step.detail;
        expect(text).not.toMatch(/thursday|sunday night|by kickoff|deadline of|midnight/i);
      }
    }
  });
});
