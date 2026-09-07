/**
 * Head coaches: the one thing that crosses a league boundary, and the promise that makes
 * that safe.
 *
 * Issue #40, and Scott's framing on 2026-09-07: THE COACH CARD IS THE TEAM. It scores its
 * NFL team's Win, Tie or Loss and the name printed on it is decoration. That is why a site
 * admin may rewrite a name in every league at once - it cannot move a point - and it is
 * the first group of tests below, because if it ever stops being true the second group
 * (the propagation planner) becomes indefensible rather than merely wrong.
 */

import { describe, it, expect } from "vitest";
import { computeStarterPoints, DEFAULT_SCORING } from "../src/engine/index.js";
import {
  cleanCoachName,
  planCoachUpdate,
  summarizeCoaches,
  NFL_TEAM_NAMES,
  MAX_COACH_NAME,
} from "../server/coaches.js";
import { planStatsPull } from "../server/stats.js";

const state = { scoringConfig: { ...DEFAULT_SCORING } };

describe("a coach scores his team, not his name", () => {
  it("gives the same points whoever is listed", () => {
    for (const result of ["Win", "Tie", "Loss"]) {
      const line = { result };
      const points = computeStarterPoints(state, line, "Coach");
      // The name is not even an argument. Stated as a test anyway, because the whole
      // cross-league rename rests on it.
      expect(computeStarterPoints(state, { ...line, name: "Anybody At All" }, "Coach")).toBe(points);
    }
  });

  it("scores Win, Tie and Loss from the config and nothing else", () => {
    expect(computeStarterPoints(state, { result: "Win" }, "Coach")).toBe(DEFAULT_SCORING.coachWin);
    expect(computeStarterPoints(state, { result: "Tie" }, "Coach")).toBe(DEFAULT_SCORING.coachTie);
    expect(computeStarterPoints(state, { result: "Loss" }, "Coach")).toBe(DEFAULT_SCORING.coachLoss);
    // Yards and touchdowns on a coach line are ignored outright - he is not a player.
    expect(computeStarterPoints(state, { result: "Win", passing_yards: 400, passing_tds: 4 }, "Coach"))
      .toBe(DEFAULT_SCORING.coachWin);
  });

  it("fills a coach's result from his NFL TEAM even when the name is wrong", () => {
    /* The bad name is the point. "Jesse Minter" is what nflverse said about Baltimore and
     * "John Harbaugh" is what it said about the Giants; a pull that matched coaches by
     * name would find nothing, silently, and score both coaches zero. Matching by
     * `nfl_team` gets both right while both names are wrong - which is the whole reason a
     * rename is safe to push across leagues. */
    const players = [
      { id: "c1", position: "Coach", name: "Jesse Minter", nfl_team: "Baltimore Ravens", external_ids: {} },
      { id: "c2", position: "Coach", name: "John Harbaugh", nfl_team: "New York Giants", external_ids: {} },
    ];
    const { writes } = planStatsPull({
      starters: [
        { team_id: "t1", slot: "Coach", player_id: "c1" },
        { team_id: "t2", slot: "Coach", player_id: "c2" },
      ],
      players,
      teams: [{ id: "t1", name: "Team One" }, { id: "t2", name: "Team Two" }],
      statLines: [],
      feedLines: [],
      results: new Map([["Baltimore Ravens", "Win"], ["New York Giants", "Loss"]]),
      at: "2026-09-07T00:00:00Z",
      periodId: "per1",
    });
    expect(writes.find((w) => w.team_id === "t1").coach_result).toBe("Win");
    expect(writes.find((w) => w.team_id === "t2").coach_result).toBe("Loss");
  });

  it("scores the same after the coach is renamed", () => {
    /* The rename an admin makes, run through the same pull. Nothing moves. */
    const base = {
      starters: [{ team_id: "t1", slot: "Coach", player_id: "c1" }],
      teams: [{ id: "t1", name: "Team One" }],
      statLines: [],
      feedLines: [],
      results: new Map([["Baltimore Ravens", "Win"]]),
      at: "2026-09-07T00:00:00Z",
      periodId: "per1",
    };
    const before = planStatsPull({
      ...base,
      players: [{ id: "c1", position: "Coach", name: "Jesse Minter", nfl_team: "Baltimore Ravens", external_ids: {} }],
    });
    const after = planStatsPull({
      ...base,
      players: [{ id: "c1", position: "Coach", name: "John Harbaugh", nfl_team: "Baltimore Ravens", external_ids: {} }],
    });
    expect(after.writes[0].coach_result).toBe(before.writes[0].coach_result);
    expect(computeStarterPoints(state, { result: after.writes[0].coach_result }, "Coach"))
      .toBe(computeStarterPoints(state, { result: before.writes[0].coach_result }, "Coach"));
  });
});

describe("cleanCoachName", () => {
  it("trims, collapses whitespace and refuses an empty name", () => {
    expect(cleanCoachName("  John   Harbaugh ").name).toBe("John Harbaugh");
    expect(cleanCoachName("   ").error).toMatch(/name/i);
    expect(cleanCoachName(null).error).toBeTruthy();
  });

  it("refuses a name longer than the guard", () => {
    expect(cleanCoachName("x".repeat(MAX_COACH_NAME)).name).toHaveLength(MAX_COACH_NAME);
    expect(cleanCoachName("x".repeat(MAX_COACH_NAME + 1)).error).toBeTruthy();
  });
});

const template = [
  { legacy_id: "p15", name: "Jesse Minter", nfl_team: "Baltimore Ravens" },
  { legacy_id: "p162", name: "John Harbaugh", nfl_team: "New York Giants" },
];
const leagueNames = new Map([["L1", "Scott's League"], ["L2", "Test League"]]);

describe("planCoachUpdate", () => {
  it("renames the template row and every league's live row", () => {
    const plan = planCoachUpdate({
      team: "Baltimore Ravens",
      name: "John Harbaugh",
      templateRows: template,
      leagueRows: [
        { id: "a", league_id: "L1", name: "Jesse Minter", nfl_team: "Baltimore Ravens", retired: false },
        { id: "b", league_id: "L2", name: "Jesse Minter", nfl_team: "Baltimore Ravens", retired: false },
      ],
      leagueNames,
    });
    expect(plan.template.legacy_id).toBe("p15");
    expect(plan.updates.map((u) => u.id).sort()).toEqual(["a", "b"]);
    expect(plan.report.leaguesUpdated).toBe(2);
    expect(plan.report.skipped).toEqual([]);
  });

  it("does not write a row that already reads correctly", () => {
    const plan = planCoachUpdate({
      team: "Baltimore Ravens",
      name: "Jesse Minter",
      templateRows: template,
      leagueRows: [
        { id: "a", league_id: "L1", name: "Jesse Minter", nfl_team: "Baltimore Ravens", retired: false },
        { id: "b", league_id: "L2", name: "Someone Else", nfl_team: "Baltimore Ravens", retired: false },
      ],
      leagueNames,
    });
    expect(plan.template).toBeNull();      // template already says it
    expect(plan.updates.map((u) => u.id)).toEqual(["b"]);
  });

  it("leaves RETIRED coach rows alone", () => {
    /* The 09-06 backfill retired four duplicate Coach rows in live leagues. They are
     * invisible to managers, never dealt, and holding the old spelling is what they are
     * for - renaming one would put a second "Klint Kubiak" in the commissioner's list. */
    const plan = planCoachUpdate({
      team: "Baltimore Ravens",
      name: "John Harbaugh",
      templateRows: template,
      leagueRows: [
        { id: "live", league_id: "L1", name: "Jesse Minter", nfl_team: "Baltimore Ravens", retired: false },
        { id: "old", league_id: "L1", name: "Jesse Mintor", nfl_team: "Baltimore Ravens", retired: true },
      ],
      leagueNames: new Map([["L1", "Scott's League"]]),
    });
    expect(plan.updates.map((u) => u.id)).toEqual(["live"]);
  });

  it("refuses to guess when a league has two live coaches for one team", () => {
    const plan = planCoachUpdate({
      team: "Baltimore Ravens",
      name: "John Harbaugh",
      templateRows: template,
      leagueRows: [
        { id: "a", league_id: "L1", name: "Jesse Minter", nfl_team: "Baltimore Ravens", retired: false },
        { id: "b", league_id: "L1", name: "Klint Kubliak", nfl_team: "Baltimore Ravens", retired: false },
      ],
      leagueNames: new Map([["L1", "Scott's League"]]),
    });
    expect(plan.updates).toEqual([]);
    expect(plan.report.skipped[0]).toMatchObject({ leagueId: "L1", reason: "duplicate" });
  });

  it("reports a league with no live coach row rather than inserting one", () => {
    const plan = planCoachUpdate({
      team: "Baltimore Ravens",
      name: "John Harbaugh",
      templateRows: template,
      leagueRows: [],
      leagueNames,
    });
    expect(plan.updates).toEqual([]);
    expect(plan.report.skipped).toHaveLength(2);
    expect(plan.report.skipped[0].reason).toMatch(/no live coach/);
  });

  it("refuses an unknown team and an empty name", () => {
    expect(planCoachUpdate({ team: "London Jaguars", name: "X", templateRows: template, leagueRows: [] }).error)
      .toMatch(/Unknown NFL team/);
    expect(planCoachUpdate({ team: "Baltimore Ravens", name: "  ", templateRows: template, leagueRows: [] }).error)
      .toBeTruthy();
  });

  it("refuses a team the shared pool has no coach row for", () => {
    expect(planCoachUpdate({
      team: "Chicago Bears", name: "Ben Johnson", templateRows: template, leagueRows: [],
    }).error).toMatch(/no coach row/);
  });
});

describe("summarizeCoaches", () => {
  it("returns all 32 teams whatever the template holds", () => {
    const { coaches } = summarizeCoaches({ templateRows: [], leagueRows: [] });
    expect(coaches).toHaveLength(32);
    expect(coaches.map((c) => c.team)).toEqual(NFL_TEAM_NAMES);
    expect(coaches[0].name).toBeNull();
  });

  it("lists only the leagues that DISAGREE", () => {
    const { coaches, leagueCount } = summarizeCoaches({
      templateRows: template,
      leagueRows: [
        { id: "a", league_id: "L1", name: "Jesse Minter", nfl_team: "Baltimore Ravens", retired: false },
        { id: "b", league_id: "L2", name: "John Harbaugh", nfl_team: "Baltimore Ravens", retired: false },
      ],
      leagueNames,
    });
    const bal = coaches.find((c) => c.team === "Baltimore Ravens");
    expect(leagueCount).toBe(2);
    expect(bal.disagreements).toHaveLength(1);
    expect(bal.disagreements[0]).toMatchObject({ leagueId: "L2", names: ["John Harbaugh"] });
    expect(bal.missingIn).toEqual([]);
  });

  it("counts retired rows without ever comparing them", () => {
    const { coaches } = summarizeCoaches({
      templateRows: template,
      leagueRows: [
        { id: "a", league_id: "L1", name: "Jesse Minter", nfl_team: "Baltimore Ravens", retired: false },
        { id: "z", league_id: "L1", name: "Somebody Old", nfl_team: "Baltimore Ravens", retired: true },
      ],
      leagueNames: new Map([["L1", "Scott's League"]]),
    });
    const bal = coaches.find((c) => c.team === "Baltimore Ravens");
    expect(bal.retiredCount).toBe(1);
    expect(bal.disagreements).toEqual([]);
  });

  it("names the leagues holding no coach at all for a team", () => {
    const { coaches } = summarizeCoaches({
      templateRows: template,
      leagueRows: [
        { id: "a", league_id: "L1", name: "Jesse Minter", nfl_team: "Baltimore Ravens", retired: false },
      ],
      leagueNames,
    });
    const bal = coaches.find((c) => c.team === "Baltimore Ravens");
    expect(bal.missingIn).toEqual([{ leagueId: "L2", leagueName: "Test League" }]);
  });
});
