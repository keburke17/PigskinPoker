/**
 * What an email would say about a week, given a league's actual state.
 *
 * Issue #57, PR 2. server/notifyFacts.js is pure, so every sentence a manager receives
 * can be asserted here without a database, a network or a clock - and the three that
 * matter most are the ones a bug would be invisible in:
 *
 *   1. THE DEADLINE SENTENCE MUST MATCH THE LEAGUE. Telling a league with no automation
 *      that schemes close at 3am Thursday invents a rule its commissioner never made.
 *   2. THE RECAP MUST BE THE WEEK THAT JUST ENDED, which is not the last row of
 *      `weeklyResults` once the playoffs start, because that array sorts on number.
 *   3. A TEAM WITH NO ROSTER IS TOLD NOTHING. In the playoffs that is a knocked-out
 *      team, and the decision on issue #57 is that they hear nothing further.
 */

import { describe, it, expect } from "vitest";
import {
  deadlineWords,
  factsFor,
  kickoffWords,
  lockWords,
  periodLabel,
  recapFor,
  schemeEventsFor,
} from "../server/notifyFacts.js";

/* A minimal league in the shape hydrate() produces. Only the fields these functions
 * read - a full view is 200 lines of noise for the same assertions. */
function view(over = {}) {
  return {
    leagueName: "Ball So Hard League",
    currentPeriod: { type: "week", number: 7, phase: "dealt" },
    teams: [
      {
        id: "t1",
        name: "Gridiron Gamblers",
        roster: {
          starters: { Coach: "c1", QB: "p1", WR: "p2", RB: "p3", TE: "p4", FLEX: "p5" },
          bench: [],
        },
      },
      { id: "t2", name: "Hog Mollies", roster: { starters: {}, bench: [] } },
      /* Knocked out: dealt into no period, so holding no roster. */
      { id: "t3", name: "Couch Potatoes", roster: null },
    ],
    playerPool: [
      { id: "c1", name: "Dan Campbell", position: "Coach", team: "DET" },
      { id: "p1", name: "Jalen Hurts", position: "QB", team: "PHI" },
      { id: "p2", name: "Puka Nacua", position: "WR", team: "LAR" },
      { id: "p3", name: "Bijan Robinson", position: "RB", team: "ATL" },
      { id: "p4", name: "Trey McBride", position: "TE", team: "ARI" },
      { id: "p5", name: "De'Von Achane", position: "RB", team: "MIA" },
    ],
    weeklyResults: [],
    activityLog: [],
    _meta: {
      tz: "America/New_York",
      lineupLock: "gametime",
      autoProcessSchemes: false,
      autoAdvanceWeek: false,
      notifyMembers: true,
      kickoffs: {
        PHI: { at: "2026-09-20T17:00:00Z", opp: "NYG", home: false },
        DET: { at: "2026-09-20T17:00:00Z", opp: "CHI", home: true },
      },
    },
    ...over,
  };
}

const NOW = Date.parse("2026-09-16T12:00:00Z");

describe("labels and times", () => {
  it("labels a week and a playoff round the way every screen does", () => {
    expect(periodLabel({ type: "week", number: 7 })).toBe("Week 7");
    expect(periodLabel({ type: "playoff", number: 2 })).toBe("Playoff Round 2");
  });

  /* THE BUG THIS EXISTS TO CATCH: formatting in the runtime's zone. On Netlify that is
   * UTC, so a Sunday 1pm Eastern kickoff would be announced as "Sun 5:00pm" to a league
   * that plays at one. */
  it("writes kickoffs in the league's timezone, named", () => {
    const words = kickoffWords("2026-09-20T17:00:00Z", "America/New_York", NOW);
    expect(words).toContain("1:00pm");
    expect(words).toContain("Sun");
    expect(words).toMatch(/E[DS]T$/);

    const pacific = kickoffWords("2026-09-20T17:00:00Z", "America/Los_Angeles", NOW);
    expect(pacific).toContain("10:00am");
  });

  it("says nothing about a time it does not have", () => {
    expect(kickoffWords(null, "America/New_York")).toBe("");
    expect(kickoffWords("not a date", "America/New_York")).toBe("");
  });
});

describe("the deadline sentence", () => {
  /* The rule that must never bend: a league whose commissioner presses the button
   * himself has no deadline, and must not be told it has one. */
  it("promises no clock to a league that has not switched one on", () => {
    const words = deadlineWords(view(), NOW);
    expect(words).toContain("commissioner");
    expect(words).not.toContain("3am");
  });

  it("names the real time for a league on the clock", () => {
    const v = view();
    v._meta.autoProcessSchemes = true;
    const words = deadlineWords(v, NOW);
    expect(words).toContain("Thursday 3am");
    expect(words).toMatch(/E[DS]T/);
    expect(words).toContain("exactly as it was dealt");
  });
});

describe("the lineup lock sentence", () => {
  it("gives every player his own deadline in a gametime league", () => {
    const words = lockWords(view(), NOW);
    expect(words).toContain("when his own team kicks off");
    expect(words).toContain("1:00pm");
  });

  it("names one time in a weekly league", () => {
    const v = view();
    v._meta.lineupLock = "weekly";
    const words = lockWords(v, NOW);
    expect(words).toContain("first kickoff");
    expect(words).toContain("1:00pm");
  });

  /* A week whose schedule has not been read yet: the shape of the rule, with no time
   * attached, rather than an invented one. */
  it("states the rule without a time when the schedule is unknown", () => {
    const v = view();
    v._meta.kickoffs = {};
    expect(lockWords(v, NOW)).toBe("Each player locks when his own team kicks off.");
  });
});

describe("last week's recap", () => {
  const withResults = (rows) => view({ weeklyResults: rows });
  const row = (number, teamId, over = {}) => ({
    period: { type: "week", number },
    periodLabel: "Week " + number,
    teamId,
    rank: 1,
    rawScore: 100,
    standingsPoints: 6,
    bestPlayer: null,
    ...over,
  });

  it("is nothing at all in week one", () => {
    expect(recapFor(view(), "t1")).toBe(null);
  });

  it("reports where you finished, out of how many", () => {
    const v = withResults([
      row(6, "t1", { rank: 3, rawScore: 96.4, standingsPoints: 4, bestPlayer: { name: "Bijan Robinson", points: "24.1" } }),
      row(6, "t2", { rank: 1 }),
      row(6, "t3", { rank: 2 }),
    ]);
    expect(recapFor(v, "t1")).toEqual({
      periodLabel: "Week 6",
      rank: 3,
      teamCount: 3,
      rawScore: 96.4,
      standingsPoints: 4,
      best: { name: "Bijan Robinson", points: "24.1" },
    });
  });

  /* THE SORT TRAP. `weeklyResults` is ordered by period NUMBER, so playoff round 1
   * sorts ahead of week 17 - and a naive "last row" would recap week 17 in January,
   * during the only month anybody is paying attention. */
  it("prefers a playoff round to a higher-numbered week", () => {
    const v = view({
      currentPeriod: { type: "playoff", number: 2, phase: "dealt" },
      weeklyResults: [
        row(17, "t1", { rank: 5 }),
        { ...row(1, "t1", { rank: 2 }), period: { type: "playoff", number: 1 }, periodLabel: "Playoff Round 1" },
      ],
    });
    expect(recapFor(v, "t1").periodLabel).toBe("Playoff Round 1");
  });

  /* A week is never its own recap: finalize-then-deal leaves results for the week just
   * ended, and the deal opens the next one. If the current period somehow already has
   * results, saying "Week 7 is final" in the email announcing Week 7 would be absurd. */
  it("never recaps the week being dealt", () => {
    const v = view({ weeklyResults: [row(7, "t1")] });
    expect(recapFor(v, "t1")).toBe(null);
  });

  it("says nothing for a team that did not play that week", () => {
    const v = withResults([row(6, "t2")]);
    expect(recapFor(v, "t1")).toBe(null);
  });
});

describe("what the schemes did to you", () => {
  const log = (text, over = {}) => ({
    id: "a1",
    type: "steal",
    period: { type: "week", number: 7 },
    text,
    ...over,
  });

  it("lifts the league's own wording rather than inventing its own", () => {
    const v = view({
      activityLog: [
        log("Hog Mollies stole WR Puka Nacua from Gridiron Gamblers (dropped X)."),
        log("Gridiron Gamblers blocked Bijan Robinson (RB) from being stolen this week.", { type: "block" }),
        log("Somebody else entirely did something.", { type: "redraw" }),
      ],
    });
    const events = schemeEventsFor(v, "t1");
    expect(events).toHaveLength(2);
    expect(events[0]).toContain("Puka Nacua");
  });

  it("ignores another week's entries", () => {
    const v = view({
      activityLog: [log("Gridiron Gamblers blocked somebody.", { period: { type: "week", number: 6 } })],
    });
    expect(schemeEventsFor(v, "t1")).toEqual([]);
  });

  it("ignores entries that are not scheme outcomes", () => {
    const v = view({ activityLog: [log("Rosters dealt for Week 7 (6 teams).", { type: "deal" })] });
    expect(schemeEventsFor(v, "t1")).toEqual([]);
  });
});

describe("assembling a message", () => {
  it("builds a dealt roster with fixtures on it", () => {
    const facts = factsFor("week_dealt", view(), "t1", NOW);
    expect(facts.teamName).toBe("Gridiron Gamblers");
    expect(facts.periodLabel).toBe("Week 7");
    expect(facts.roster).toHaveLength(6);
    expect(facts.roster[0]).toBe("Coach - Dan Campbell (DET) vs CHI");
    expect(facts.roster[1]).toBe("QB - Jalen Hurts (PHI) at NYG");
    /* No kickoff entry for LAR: the fixture is left off rather than guessed. */
    expect(facts.roster[2]).toBe("WR - Puka Nacua (LAR)");
  });

  it("says a slot is empty rather than pretending it is filled", () => {
    const v = view();
    v.teams[0].roster.starters.TE = null;
    expect(factsFor("week_dealt", v, "t1", NOW).roster).toContain("TE - empty");
  });

  /* Knocked out of the playoffs: no roster, so nothing to say. Issue #57 records the
   * decision that they hear nothing further rather than getting a week's email. */
  it("has nothing to tell a team that was not dealt in", () => {
    expect(factsFor("week_dealt", view(), "t3", NOW)).toBe(null);
    expect(factsFor("schemes_processed", view(), "t3", NOW)).toBe(null);
  });

  it("has nothing to tell a team that does not exist", () => {
    expect(factsFor("week_dealt", view(), "nobody", NOW)).toBe(null);
  });

  it("carries the schemes and the lock into the processed message", () => {
    const v = view({
      activityLog: [
        {
          id: "a1",
          type: "redraw",
          period: { type: "week", number: 7 },
          text: "Gridiron Gamblers redrew Trey McBride (TE) for George Kittle (free agent).",
        },
      ],
    });
    const facts = factsFor("schemes_processed", v, "t1", NOW);
    expect(facts.events).toHaveLength(1);
    expect(facts.lock).toContain("kicks off");
  });

  it("knows only the three kinds", () => {
    expect(() => factsFor("congratulations", view(), "t1", NOW)).toThrow(/unknown notification kind/);
  });
});
