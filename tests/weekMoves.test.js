/**
 * Your scheme and what it did - the Ticket, the result strip and Around the league
 * (Scott, 2026-10-16).
 *
 * The screens read each scheme's sentence back out of the activity log
 * (src/components/weekMoves.js), because the log carries prose and nothing else. That
 * only holds as long as the sentences the ENGINE writes are the ones the reader expects,
 * so every case here runs real schemes through processSchemes and reads what it wrote -
 * never a hand-typed sentence. If someone rewords a template in src/engine/schemes.js,
 * this file is what fails.
 *
 * Also here: the week-by-week scoreboard's helpers (src/components/weekByWeek.jsx),
 * checked against what finalize itself accumulates.
 */

import { describe, it, expect } from "vitest";
import {
  dealRosters,
  finalizeCurrentPeriod,
  getPlayer,
  processSchemes,
  projectCurrentPeriod,
  rankTeamsWithTiebreak,
  seasonStandingsRows,
  seededRng,
} from "../src/engine/index.js";
import { moveChip, moveHeadline, parseMove, weekMoves } from "../src/components/weekMoves.js";
import { schemeTicketWords, stripTags } from "../src/components/schemeTicket.jsx";
import { finishedPeriods, liveRows, resultsFor, scoreboardPages, standingsThrough } from "../src/components/weekByWeek.jsx";
import { dealtState, emptyFreeAgents, fillStats, starter } from "./helpers/fixtures.js";

const scheme = (type, position, playerId) => ({ type, position, playerId, submittedAt: "2026-10-16T12:00:00.000Z" });
const nameOf = (s, id) => getPlayer(s, id).name;
const tmOf = (s, id) => weekMoves(s).teams.find((t) => t.teamId === id);

describe("weekMoves reads the engine's own sentences", () => {
  it("reads a block", () => {
    const s = dealtState(4, 2);
    const qb = starter(s, "team_1", "QB");
    s.schemes = { team_1: scheme("block", "QB", qb) };
    const next = processSchemes(s, seededRng(5));
    const tm = tmOf(next, "team_1");
    expect(tm.scheme).toBe("block");
    expect(tm.lines).toEqual([{ kind: "block", player: nameOf(s, qb), position: "QB", note: "blocked - could not be stolen" }]);
    expect(weekMoves(next).unread).toEqual([]);
  });

  it("reads a steal from both sides, naming the other team and free agency", () => {
    const s = dealtState(4, 3);
    const dropped = starter(s, "team_0", "QB");
    s.schemes = { team_0: scheme("steal", "QB", dropped) };
    const next = processSchemes(s, seededRng(11));
    const got = starter(next, "team_0", "QB");
    const victim = s.teams.find((t) => t.id !== "team_0" && t.roster.starters.QB === got);
    const fill = starter(next, victim.id, "QB");

    const thief = tmOf(next, "team_0");
    expect(thief.scheme).toBe("steal");
    expect(thief.lines).toEqual([
      { kind: "add", player: nameOf(s, got), position: "QB", note: "stolen from " + victim.name },
      { kind: "drop", player: nameOf(s, dropped), position: "QB", note: "dropped to free agency" },
    ]);

    const robbed = tmOf(next, victim.id);
    expect(robbed.scheme).toBe(null);
    expect(robbed.hit).toBe(true);
    expect(robbed.lines).toEqual([
      { kind: "stolen", player: nameOf(s, got), position: "QB", note: "stolen by Team A" },
      { kind: "add", player: nameOf(next, fill), position: "QB", note: "from free agency, fills " + nameOf(s, got) + "'s spot" },
    ]);
    expect(moveChip(robbed).label).toBe("Stolen from");
    expect(moveHeadline(robbed)).toBe("Team A stole " + nameOf(s, got));
    expect(moveHeadline(thief)).toBe("You stole " + nameOf(s, got));
  });

  it("reads a steal that left the victim's spot empty", () => {
    const s = dealtState(3, 5);
    emptyFreeAgents(s, "QB");
    const dropped = starter(s, "team_0", "QB");
    s.playerPool.find((p) => p.id === dropped).status = "OUT";
    s.schemes = { team_0: scheme("steal", "QB", dropped) };
    const next = processSchemes(s, seededRng(31));
    const victim = weekMoves(next).teams.find((t) => t.hit);
    expect(victim.lines[1]).toEqual({ kind: "empty", player: "Empty QB spot", position: "QB", note: "no free agent QB was left to fill it" });
    expect(weekMoves(next).unread).toEqual([]);
  });

  it("reads a redraw", () => {
    const s = dealtState(4, 1);
    const dropped = starter(s, "team_0", "WR");
    s.schemes = { team_0: scheme("redraw", "WR", dropped) };
    const next = processSchemes(s, seededRng(5));
    const tm = tmOf(next, "team_0");
    expect(tm.scheme).toBe("redraw");
    expect(tm.lines).toEqual([
      { kind: "drop", player: nameOf(s, dropped), position: "WR", note: "dropped to free agency" },
      { kind: "add", player: nameOf(next, starter(next, "team_0", "WR")), position: "WR", note: "from free agency" },
    ]);
    expect(moveHeadline(tm)).toBe("You drew " + nameOf(next, starter(next, "team_0", "WR")) + " for " + nameOf(s, dropped));
  });

  it("reads a steal that found no target", () => {
    const s = dealtState(2, 4);
    s.schemes = {
      team_0: scheme("steal", "QB", starter(s, "team_0", "QB")),
      team_1: scheme("block", "QB", starter(s, "team_1", "QB")),
    };
    const next = processSchemes(s, seededRng(9));
    const tm = tmOf(next, "team_0");
    expect(tm.scheme).toBe("steal-failed");
    expect(tm.lines[0].kind).toBe("none");
    expect(moveChip(tm).label).toBe("No target");
  });

  it("is not fooled by team or player names that contain the template's own words", () => {
    const s = dealtState(3, 3);
    s.teams[0].name = "Stole From Them";
    s.teams[1].name = "Blitz";
    s.teams[2].name = "Blitz Brothers";
    const dropped = starter(s, "team_0", "QB");
    s.schemes = { team_0: scheme("steal", "QB", dropped) };
    const next = processSchemes(s, seededRng(11));
    const got = starter(next, "team_0", "QB");
    const victim = s.teams.find((t) => t.id !== "team_0" && t.roster.starters.QB === got);
    const thief = tmOf(next, "team_0");
    expect(thief.lines[0].note).toBe("stolen from " + victim.name);
    expect(tmOf(next, victim.id).hit).toBe(true);
  });

  it("hands back the engine's sentence untouched when a team was renamed after its move", () => {
    const s = dealtState(4, 2);
    s.schemes = { team_1: scheme("block", "QB", starter(s, "team_1", "QB")) };
    const next = processSchemes(s, seededRng(5));
    next.teams[1].name = "Renamed Since";
    const wm = weekMoves(next);
    expect(wm.any).toBe(true);
    expect(wm.unread.map((e) => e.type)).toEqual(["block"]);
  });

  it("ignores entries that are not a manager's scheme", () => {
    expect(parseMove({ type: "result", text: "Week 1 finalized." }, ["Team A"])).toBe(null);
    expect(parseMove({ type: "auto", text: "The clock processed schemes." }, ["Team A"])).toBe(null);
  });

  it("only reads the open period", () => {
    const s = dealtState(4, 2);
    s.schemes = { team_1: scheme("block", "QB", starter(s, "team_1", "QB")) };
    const next = processSchemes(s, seededRng(5));
    next.currentPeriod = { type: "week", number: 2, phase: "dealt" };
    expect(weekMoves(next).any).toBe(false);
  });
});

describe("the ticket and the strip", () => {
  it("words each scheme for the ticket", () => {
    const s = dealtState(2, 1);
    const qb = starter(s, "team_0", "QB");
    expect(schemeTicketWords(s, scheme("block", "QB", qb)).big).toBe("Blocking " + nameOf(s, qb));
    expect(schemeTicketWords(s, scheme("steal", "WR", starter(s, "team_0", "WR"))).big).toBe("Stealing a WR");
    expect(schemeTicketWords(s, scheme("redraw", "RB", starter(s, "team_0", "RB"))).sub).toMatch(/^dropping /);
    expect(schemeTicketWords(s, { type: "noaction" }).big).toBe("No Action this week");
  });

  it("turns lines into short tags, marking free agents", () => {
    expect(stripTags([
      { kind: "add", player: "A", note: "stolen from X" },
      { kind: "drop", player: "B", note: "dropped to free agency" },
      { kind: "stolen", player: "C", note: "stolen by Y" },
      { kind: "add", player: "D", note: "from free agency, fills C's spot" },
    ]).map((t) => t.text)).toEqual(["+ A", "- B", "Stolen: C", "+ D (FA)"]);
  });
});

/* Play `weeks` regular-season weeks to finalize, with random stats. */
function playSeason(weeks, teams = 4) {
  let s = dealtState(teams, 21);
  for (let w = 1; w <= weeks; w++) {
    if (w > 1) {
      const res = dealRosters(s, s.teams.map((t) => t.id), seededRng(100 + w));
      Object.entries(res.rosters).forEach(([id, roster]) => { s.teams.find((t) => t.id === id).roster = roster; });
      s.currentPeriod.phase = "dealt";
    }
    fillStats(s, s.teams.map((t) => t.id), 40 + w);
    s = finalizeCurrentPeriod(s, seededRng(w)).state;
  }
  return s;
}

describe("the week-by-week scoreboard", () => {
  it("lists finished weeks in order, playoffs after the regular season", () => {
    const r = (type, number) => ({ period: { type, number } });
    expect(finishedPeriods([r("week", 2), r("playoff", 1), r("week", 1), r("week", 2)])).toEqual([
      { type: "week", number: 1 }, { type: "week", number: 2 }, { type: "playoff", number: 1 },
    ]);
  });

  it("shows one week's results best first", () => {
    const s = playSeason(2);
    const rows = resultsFor(s.weeklyResults, { type: "week", number: 1 });
    expect(rows.map((r) => r.rank)).toEqual(rows.map((r) => r.rank).slice().sort((a, b) => a - b));
    expect(rows.every((r) => r.period.number === 1)).toBe(true);
  });

  it("season-through-the-latest-week matches the league standings exactly", () => {
    const s = playSeason(3);
    const mine = standingsThrough(s.weeklyResults, { type: "week", number: 3 });
    const league = rankTeamsWithTiebreak(seasonStandingsRows(s));
    expect(mine.map((r) => [r.teamId, r.rank])).toEqual(league.map((r) => [r.teamId, r.rank]));
    mine.forEach((r) => {
      const cum = s.teams.find((t) => t.id === r.teamId).cumulative;
      expect(r.cum.standingsPoints).toBe(cum.standingsPoints);
      expect(r.cum.weekWins).toBe(cum.weekWins);
      expect(r.cum.coachWins).toBe(cum.coachWins);
      expect(r.cum.totalTDs).toBe(cum.totalTDs);
      expect(r.cum.totalYards).toBe(cum.totalYards);
    });
  });

  it("an earlier week counts only the weeks up to it", () => {
    const s = playSeason(3);
    const wk1 = standingsThrough(s.weeklyResults, { type: "week", number: 1 });
    wk1.forEach((r) => {
      const res = s.weeklyResults.find((x) => x.teamId === r.teamId && x.period.number === 1);
      expect(r.cum.standingsPoints).toBe(res.standingsPoints);
    });
  });
});

describe("the current week on the same scoreboard (2026-10-17)", () => {
  it("is the last page while a week is being played", () => {
    const s = playSeason(2);
    const res = dealRosters(s, s.teams.map((t) => t.id), seededRng(77));
    Object.entries(res.rosters).forEach(([id, roster]) => { s.teams.find((t) => t.id === id).roster = roster; });
    s.currentPeriod.phase = "dealt";
    expect(scoreboardPages(s)).toEqual([
      { type: "week", number: 1, live: false },
      { type: "week", number: 2, live: false },
      { type: "week", number: 3, live: true },
    ]);
  });

  it("shows exactly what the old live table showed, with no standings points before schemes process", () => {
    const s = playSeason(1);
    const res = dealRosters(s, s.teams.map((t) => t.id), seededRng(78));
    Object.entries(res.rosters).forEach(([id, roster]) => { s.teams.find((t) => t.id === id).roster = roster; });
    s.currentPeriod.phase = "dealt";
    fillStats(s, s.teams.map((t) => t.id), 9);
    expect(liveRows(s).every((r) => r.standingsPoints === null)).toBe(true);

    s.currentPeriod.phase = "stats";
    const live = liveRows(s);
    const engine = projectCurrentPeriod(s).rows;
    expect(live.map((r) => [r.teamId, r.rank, r.rawScore, r.standingsPoints, r.tds, r.yards, r.coachResult]))
      .toEqual(engine.map((r) => [r.teamId, r.rank, r.rawScore, r.standingsPoints, r.tds, r.yards, r.coachResult]));
  });

  it("does not change the league by being looked at", () => {
    const s = playSeason(1);
    s.currentPeriod.phase = "dealt";
    const res = dealRosters(s, s.teams.map((t) => t.id), seededRng(79));
    Object.entries(res.rosters).forEach(([id, roster]) => { s.teams.find((t) => t.id === id).roster = roster; });
    fillStats(s, s.teams.map((t) => t.id), 10);
    const before = JSON.stringify(s);
    scoreboardPages(s);
    liveRows(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("has no live page between a finalize and the next deal", () => {
    const s = playSeason(2);
    expect(s.currentPeriod.phase).toBe("pre-deal");
    expect(liveRows(s)).toBe(null);
    expect(scoreboardPages(s).pop()).toEqual({ type: "week", number: 2, live: false });
  });
});
