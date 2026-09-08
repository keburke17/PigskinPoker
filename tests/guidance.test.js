/**
 * The "what do I do next?" copy (issues #24, #25, #26).
 *
 * Pure functions, no DOM, no stack - which is the point of putting the logic in
 * src/components/guidance.js rather than inline in a component. The overlay, the
 * persistent note and the Help tab all read this, so pinning it here pins all three.
 *
 * THE LOCK ASSERTIONS AT THE BOTTOM MATTER MOST, and what they guard changed on
 * 2026-09-05. Lineups now DO lock on a clock, and which clock is a league option
 * (OQ-11): `gametime` freezes each player at his own kickoff, `weekly` freezes every
 * lineup at the week's first one. Schemes still close only when the commissioner
 * presses the button, on no clock at all.
 *
 * So the guard is no longer "never mention a kickoff" - it is "never describe the rule
 * this league is NOT playing", which is the thing that actually costs somebody a week.
 * These tests fail if either sentence drifts onto the wrong league.
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
  /* The same league, playing the other lineup rule. Kickoffs included, because a
   * deadline the copy can actually name is the interesting case. */
  const weeklyLeague = (over = {}) =>
    stateWith({
      ...over,
      _meta: {
        lineupLock: "weekly",
        kickoffs: { "Buffalo Bills": "2026-09-18T00:15:00.000Z" },
      },
    });

  it("says schemes are closed but lineup swaps are not, in a gametime league", () => {
    const step = nextStep(locked, "manager", withRoster(team));
    expect(step.headline).toMatch(/locked/i);
    expect(step.detail).toMatch(/still swap/i);
  });

  it("says the lineup is closing instead, in a weekly league", () => {
    const step = nextStep(
      weeklyLeague({ currentPeriod: { type: "week", number: 4, phase: "dealt" }, rosterLocked: true }),
      "manager",
      withRoster(team)
    );
    expect(step.detail).toMatch(/first kickoff/i);
    /* The one thing that must NOT survive the switch: telling a manager whose lineup
     * closed on Thursday that he can still swap. */
    expect(step.detail).not.toMatch(/still swap/i);
  });

  it("never describes the rule the league is not playing", () => {
    /* REGRESSION GUARD, rewritten for OQ-11. A gametime league must never be promised a
     * weekly deadline, and a weekly league must never be told its late games are still
     * open. Either one is a rules change made in prose, in a league people are playing.
     *
     * The scheme deadline is separate and still on nobody's clock, which is why
     * "Thursday" stays banned outright: `weekly` locks on the week's FIRST kickoff,
     * whatever weekday that is - the 2026 season opens on a Wednesday. */
    const periods = [
      { type: "week", number: 4, phase: "dealt" },
      { type: "week", number: 4, phase: "schemes-processed" },
    ];
    const roles = [["commissioner", null], ["manager", withRoster(team)]];

    for (const currentPeriod of periods) {
      for (const rosterLocked of [false, true]) {
        for (const [role, t] of roles) {
          const gametime = nextStep(stateWith({ currentPeriod, rosterLocked }), role, t);
          const weekly = nextStep(weeklyLeague({ currentPeriod, rosterLocked }), role, t);
          const gametimeText = gametime.headline + " " + gametime.detail;
          const weeklyText = weekly.headline + " " + weekly.detail;

          // Neither league invents a weekday, a scheme clock, or a midnight.
          expect(gametimeText).not.toMatch(/thursday|sunday night|deadline of|midnight/i);
          expect(weeklyText).not.toMatch(/thursday|sunday night|deadline of|midnight/i);
          // A gametime league is never given a single league-wide lineup deadline.
          expect(gametimeText).not.toMatch(/first kickoff/i);
          // A weekly league is never told the later games are still open to it.
          expect(weeklyText).not.toMatch(/has not started|own game kicks off/i);
        }
      }
    }
  });
});

/* ============================== the clock (issue #52) =======================
 *
 * A league can have the scheme deadline and the Tuesday finalize-and-deal run on their
 * own (OQ-14; both off by default). The failure this guards is precise and expensive:
 * telling a manager "there is no clock, so do it now" when 3am Thursday will take his
 * scheme off him. The copy has to name the league's own arrangement, never the other
 * one - the same discipline the lineup-lock assertions above enforce.
 */
describe("nextStep, when the week runs on a clock", () => {
  const clocked = (over, meta) => stateWith({ ...over, _meta: { tz: "America/New_York", ...meta } });

  it("tells a manager the scheme deadline is a real time", () => {
    const state = clocked(
      { currentPeriod: { type: "week", number: 3, phase: "dealt" } },
      { autoProcessSchemes: true }
    );
    const step = nextStep(state, "manager", withRoster(state.teams[0]));
    expect(step.detail).toMatch(/Thursday 3am/);
    expect(step.detail).toMatch(/No Action/);
    expect(step.detail).not.toMatch(/there is no clock/i);
  });

  /* And the other way round, which is the sentence that was there before. */
  it("keeps 'there is no clock' for a league that has not switched it on", () => {
    const state = stateWith({ currentPeriod: { type: "week", number: 3, phase: "dealt" } });
    const step = nextStep(state, "manager", withRoster(state.teams[0]));
    expect(step.detail).toMatch(/there is no clock/i);
    expect(step.detail).not.toMatch(/Thursday 3am/);
  });

  it("tells a manager with a scheme on file when it stops being changeable", () => {
    const team = withRoster({ id: "t1", name: "Burke" });
    const state = clocked(
      { currentPeriod: { type: "week", number: 3, phase: "dealt" }, schemes: { t1: { type: "block" } } },
      { autoProcessSchemes: true }
    );
    expect(nextStep(state, "manager", team).detail).toMatch(/right up until Thursday 3am/);
  });

  it("tells the commissioner he has nothing to press on a clocked week", () => {
    const state = clocked(
      { currentPeriod: { type: "week", number: 3, phase: "dealt" } },
      { autoProcessSchemes: true }
    );
    const step = nextStep(state, "commissioner", null);
    expect(step.headline).toMatch(/process themselves at Thursday 3am/i);
  });

  it("says the week finalizes itself, and warns that it cannot be undone", () => {
    const state = clocked(
      { currentPeriod: { type: "week", number: 3, phase: "schemes-processed" } },
      { autoAdvanceWeek: true }
    );
    const step = nextStep(state, "commissioner", null);
    expect(step.headline).toMatch(/finalizes itself on Tuesday 6am/i);
    expect(step.detail).toMatch(/no undo/i);
  });

  /* THE CLOCK NEVER DEALS THE FIRST WEEK - there is no finished week behind it, so
   * dealEligibility refuses (server/autoCycle.js). Promising a Tuesday that will never
   * come is worse than saying nothing. */
  it("does not promise an automatic deal for a season's first week", () => {
    const state = clocked({}, { autoAdvanceWeek: true });
    state.weeklyResults = [];
    const step = nextStep(state, "commissioner", null);
    expect(step.headline).toMatch(/Deal Week 1/);
    expect(step.detail).toMatch(/never deals the first one/i);
  });

  it("does promise one once a week has been played", () => {
    const state = clocked({}, { autoAdvanceWeek: true });
    state.weeklyResults = [{ id: "r1" }];
    const step = nextStep(state, "commissioner", null);
    expect(step.headline).toMatch(/dealt for you at Tuesday 6am/i);
  });

  it("reads the deadline in the league's own timezone", () => {
    const state = clocked(
      { currentPeriod: { type: "week", number: 3, phase: "dealt" } },
      { autoProcessSchemes: true, tz: "America/Los_Angeles" }
    );
    const step = nextStep(state, "manager", withRoster(state.teams[0]));
    expect(step.detail).toMatch(/Thursday 3am P[DS]T/);
  });
});
