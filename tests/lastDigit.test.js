/**
 * Last Digit (OQ-37) - the engine half.
 *
 * Scott's rules, as he wrote them on 2026-11-05, each pinned by name:
 *   - you score the last digit of your NFL team's final score each week
 *   - a bye keeps last week's points; so does a game that is never played
 *   - a bye in the game's first week copies the real NFL week before it
 *   - most points wins; level on points goes to most 9s, then 8s, on down; level on
 *     everything shares the spot; the counts never beat a higher total
 *   - a game can start mid-season; earlier weeks count for nothing
 */

import { describe, it, expect } from "vitest";
import {
  NFL_ABBRS,
  NO_SHOW_HOURS,
  compareLastDigit,
  currentWeekOf,
  dealLastDigit,
  isLastDigit,
  lastDigitBoard,
  lastDigitLockAt,
  lastDigitLocked,
  lastDigitOf,
  lastDigitTies,
  seededRng,
  teamCells,
} from "../src/engine/index.js";

const kick = (week) => new Date(Date.UTC(2026, 8, 6 + 7 * (week - 1), 17)).toISOString();
const AFTER_SEASON = Date.UTC(2027, 1, 1);

/** One game. Scores of null mean it has not been played yet. */
const g = (week, home, away, homeScore = null, awayScore = null, kickoff = kick(week)) => ({
  week, home, away, homeScore, awayScore, kickoff,
});

/** Another game every week, so each week has started once its kickoff passes. */
const fill = (games) => games.concat(Array.from({ length: 18 }, (_, i) => g(i + 1, "SEA", "ARI", 20, 10)));

describe("scoring a square", () => {
  it("is the last digit of the final score", () => {
    expect(lastDigitOf(31)).toBe(1);
    expect(lastDigitOf(45)).toBe(5);
    expect(lastDigitOf(30)).toBe(0);
    expect(lastDigitOf(7)).toBe(7);
    expect(lastDigitOf(0)).toBe(0);
  });

  it("Scott's Lions: 31 in Week 1 and 31 in Week 2 is 1 + 1", () => {
    const games = [g(1, "DET", "NO", 31, 30), g(2, "BUF", "DET", 24, 31)];
    const cells = teamCells(games, "DET", { now: AFTER_SEASON });
    expect(cells[0]).toMatchObject({ kind: "final", pts: 1, raw: 31, opp: "NO", home: true });
    expect(cells[1]).toMatchObject({ kind: "final", pts: 1, raw: 31, opp: "BUF", home: false });
  });

  it("a bye keeps last week's points: 45 in Week 5, so the Week 6 bye is worth 5", () => {
    const games = fill([g(5, "DET", "CHI", 45, 10)]);
    const cells = teamCells(games, "DET", { now: AFTER_SEASON });
    expect(cells[5]).toMatchObject({ week: 6, kind: "bye", pts: 5 });
  });

  it("a game never played is scored like a bye", () => {
    const games = fill([g(16, "BUF", "CIN", 27, 20), g(17, "CIN", "BUF", null, null)]);
    const cells = teamCells(games, "BUF", { now: AFTER_SEASON });
    expect(cells[16]).toMatchObject({ week: 17, kind: "nogame", pts: 7 }); // Buffalo's 27 carries
    expect(teamCells(games, "CIN", { now: AFTER_SEASON })[16]).toMatchObject({ kind: "nogame", pts: 0 }); // and Cincinnati's 20
  });

  it("a game merely not over yet is upcoming, not a no-show", () => {
    const games = [g(3, "DET", "GB", null, null)];
    const kickoff = Date.parse(kick(3));
    const soon = teamCells(games, "DET", { now: kickoff + (NO_SHOW_HOURS - 1) * 3600e3 });
    expect(soon[2]).toMatchObject({ kind: "upcoming", pts: null });
    const late = teamCells(games, "DET", { now: kickoff + (NO_SHOW_HOURS + 1) * 3600e3 });
    expect(late[2].kind).toBe("nogame");
  });

  it("a bye waits while the week before is still unsettled", () => {
    const games = [g(4, "DET", "GB", null, null, kick(20))];
    const cells = teamCells(games, "DET", { now: Date.parse(kick(4)) });
    expect(cells[3].kind).toBe("upcoming");
    expect(cells[4]).toMatchObject({ kind: "bye", pts: null });
  });
});

describe("the board", () => {
  const entries = [
    { teamId: "a", name: "Scott", nflTeam: "DET" },
    { teamId: "b", name: "Kyle", nflTeam: "BUF" },
    { teamId: "c", name: "Dana", nflTeam: null },
  ];

  it("ranks by points, and lists who is still waiting and which teams nobody holds", () => {
    const games = [g(1, "DET", "BUF", 27, 19)];
    const b = lastDigitBoard({ games, entries, startWeek: 1, now: Date.parse(kick(1)) + 86400e3 });
    expect(b.rows.map((r) => [r.name, r.total, r.rank])).toEqual([["Kyle", 9, 1], ["Scott", 7, 2]]);
    expect(b.waiting.map((e) => e.name)).toEqual(["Dana"]);
    expect(b.unheld).toHaveLength(30);
    expect(b.unheld).not.toContain("DET");
  });

  it("level on points goes to more 9s - but 145 beats 144 however many 9s the 144 has", () => {
    const hi = { total: 145, counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3] };
    const lo = { total: 144, counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 6] };
    expect(compareLastDigit(hi, lo)).toBeLessThan(0);
    const nines = { total: 40, counts: [0, 0, 0, 0, 0, 0, 0, 0, 1, 2] };
    const eights = { total: 40, counts: [0, 0, 0, 0, 0, 0, 0, 0, 5, 1] };
    expect(compareLastDigit(nines, eights)).toBeLessThan(0);
  });

  it("then 8s, then 7s, all the way down; level on everything shares the spot", () => {
    const games = fill([g(1, "DET", "BUF", 29, 19), g(1, "KC", "LV", 9, 0), g(2, "LV", "KC", 7, 17)]);
    const three = [
      { teamId: "a", name: "A", nflTeam: "DET" },
      { teamId: "b", name: "B", nflTeam: "BUF" },
      { teamId: "k", name: "K", nflTeam: "KC" },
    ];
    const b = lastDigitBoard({ games, entries: three, startWeek: 1, now: AFTER_SEASON });
    const byName = Object.fromEntries(b.rows.map((r) => [r.name, r]));
    // DET and BUF: 9 each in Week 1, bye-copied 9s through Week 18. Level on everything.
    expect(byName.A.total).toBe(byName.B.total);
    expect(byName.A.rank).toBe(byName.B.rank);
    expect(byName.A.tied && byName.B.tied).toBe(true);
    expect(lastDigitTies(b.rows).find((t) => t.digit === null)).toBeTruthy();
  });

  it("after Week 1, everyone on a 9 is tied for first - there is nothing else to split them", () => {
    const games = fill([g(1, "DET", "NO", 19, 3), g(1, "BUF", "MIA", 29, 13), g(1, "KC", "LV", 10, 7)]);
    const three = [
      { teamId: "a", name: "A", nflTeam: "DET" },
      { teamId: "b", name: "B", nflTeam: "BUF" },
      { teamId: "k", name: "K", nflTeam: "KC" },
    ];
    const b = lastDigitBoard({ games, entries: three, startWeek: 1, now: Date.parse(kick(1)) + 86400e3 });
    expect(b.rows.slice(0, 2).map((r) => r.rank)).toEqual([1, 1]);
    expect(b.rows[2].rank).toBe(3);
    expect(b.complete).toBe(false);
    expect(b.champions).toEqual([]);
  });

  it("a game that starts in Week 3 counts nothing before Week 3", () => {
    const games = [g(1, "DET", "NO", 39, 3), g(2, "DET", "CHI", 29, 3), g(3, "DET", "GB", 21, 3)];
    const b = lastDigitBoard({ games, entries: [entries[0]], startWeek: 3, now: Date.parse(kick(3)) + 86400e3 });
    expect(b.rows[0].cells[2].pts).toBe(1);
    expect(b.rows[0].total).toBe(1 + 0); // Week 3, and nothing settled after it yet
    expect(b.rows[0].counts[9]).toBe(0);
  });

  it("a bye in the first week copies the real week before it, even though the game had not started", () => {
    const games = fill([g(5, "DET", "CHI", 45, 10)]);
    const b = lastDigitBoard({ games, entries: [entries[0]], startWeek: 6, now: Date.parse(kick(6)) + 86400e3 });
    expect(b.rows[0].cells[5]).toMatchObject({ week: 6, kind: "bye", pts: 5 });
    expect(b.rows[0].counts[5]).toBeGreaterThanOrEqual(1);
  });

  it("names the champion only once every square is settled", () => {
    const full = [];
    for (let w = 1; w <= 18; w++) full.push(g(w, "DET", "BUF", 20 + w, 10));
    const done = lastDigitBoard({ games: full, entries: entries.slice(0, 2), startWeek: 1, now: AFTER_SEASON });
    expect(done.complete).toBe(true);
    expect(done.champions.map((r) => r.name)).toEqual(["Scott"]);
    const midway = lastDigitBoard({ games: full.map((x) => (x.week === 18 ? { ...x, homeScore: null, awayScore: null, kickoff: kick(30) } : x)), entries: entries.slice(0, 2), startWeek: 1, now: AFTER_SEASON });
    expect(midway.complete).toBe(false);
  });

  it("the current week is the first one with a game still to finish", () => {
    const games = [g(1, "DET", "BUF", 20, 10), g(2, "DET", "BUF", null, null)];
    expect(currentWeekOf(games, { now: Date.parse(kick(2)) - 3600e3 })).toBe(2);
  });
});

describe("handing out teams", () => {
  it("deals a different, unheld team to everyone still waiting, and leaves the rest alone", () => {
    const entries = [
      { teamId: "a", nflTeam: "DET" },
      { teamId: "b", nflTeam: null },
      { teamId: "c", nflTeam: null },
    ];
    const r = dealLastDigit(entries, seededRng(7));
    expect(Object.keys(r.assign).sort()).toEqual(["b", "c"]);
    expect(r.assign.b).not.toBe(r.assign.c);
    expect(Object.values(r.assign)).not.toContain("DET");
    expect(NFL_ABBRS).toContain(r.assign.b);
  });

  it("is the same deal for the same seed, so a deal can be replayed", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ teamId: "t" + i, nflTeam: null }));
    expect(dealLastDigit(entries, seededRng(3)).assign).toEqual(dealLastDigit(entries, seededRng(3)).assign);
  });

  it("covers all 32 teams with 32 players, and refuses a 33rd", () => {
    const entries = Array.from({ length: 32 }, (_, i) => ({ teamId: "t" + i, nflTeam: null }));
    const r = dealLastDigit(entries, seededRng(1));
    expect(new Set(Object.values(r.assign)).size).toBe(32);
    expect(dealLastDigit([...entries, { teamId: "x", nflTeam: null }]).error).toBeTruthy();
    expect(dealLastDigit([{ teamId: "a", nflTeam: "DET" }]).error).toBeTruthy();
  });
});

describe("when joining closes", () => {
  const games = [g(1, "DET", "BUF"), g(3, "DET", "KC"), g(3, "GB", "CHI", null, null, kick(3).replace("17:00", "13:00"))];

  it("is the start week's first kickoff", () => {
    expect(lastDigitLockAt({ games, startWeek: 3, createdAt: kick(1) })).toBe(kick(3).replace("17:00", "13:00"));
  });

  it("for a game started in a week already played, is the next kickoff after it was made", () => {
    expect(lastDigitLockAt({ games, startWeek: 1, createdAt: kick(2) })).toBe(kick(3).replace("17:00", "13:00"));
  });

  it("stays open while the schedule has nothing to say", () => {
    expect(lastDigitLocked({ games: [], startWeek: 1, createdAt: null, now: AFTER_SEASON })).toBe(false);
    expect(lastDigitLocked({ games, startWeek: 3, createdAt: kick(1), now: AFTER_SEASON })).toBe(true);
  });
});

describe("the boundary", () => {
  it("a state that does not say it is Last Digit is not", () => {
    expect(isLastDigit({})).toBe(false);
    expect(isLastDigit({ _meta: { mode: "season" } })).toBe(false);
    expect(isLastDigit({ _meta: { mode: "lastdigit" } })).toBe(true);
  });
});
