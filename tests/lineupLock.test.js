/**
 * The lineup lock, both halves of it.
 *
 * The rule (src/engine/lineupLock.js) decides who can still be moved; the reader
 * (server/feed/nflverse.js) turns the schedule file into the times it decides from.
 * They are tested together because the interesting failures live in the seam: an
 * Eastern wall clock read as UTC locks a league five hours early, and a team name that
 * does not match the pool's spelling locks nobody at all.
 *
 * Nothing here touches the network - the kickoff tests parse rows given to them, and
 * the fixture case reads the recorded schedule off disk.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_LINEUP_LOCK,
  LINEUP_LOCK,
  firstKickoff,
  formatKickoffDay,
  gameFor,
  isPlayerLocked,
  kickoffAt,
  lineupLockMode,
  lockReason,
  lockTimeFor,
  lockedByClock,
  normalizeLineupLock,
  playerGame,
  playerKickoff,
  weekScheduleKnown,
} from "../src/engine/lineupLock.js";
import { NFL_TEAM_ABBR, abbrFor } from "../src/engine/nflTeams.js";
import { kickoffIso, kickoffsFromGames } from "../server/feed/nflverse.js";

/* One Sunday, three windows, and a team on a bye. */
const THU = "2026-09-10T00:20:00.000Z"; // Wed/Thu night opener
const EARLY = "2026-09-13T17:00:00.000Z"; // 1:00 PM ET
const LATE = "2026-09-13T20:05:00.000Z"; // 4:05 PM ET

/* DELIBERATELY THE OLD SHAPE - team -> bare ISO string - and it stays that way.
 *
 * On 2026-09-08 a kickoff entry grew into `{ at, opp, home }` so a roster row could name a
 * player's opponent. Every period finalized before that day still holds bare strings, and
 * so does a current week until its schedule is next read, so the old shape is not history:
 * it is a shape the lock must keep reaching the same verdict from. Leaving this whole
 * suite on it means every lock assertion below IS the compatibility test, and
 * "the same week in either shape" further down runs the interesting ones twice. */
const KICKOFFS = {
  "Buffalo Bills": THU,
  "Chicago Bears": EARLY,
  "Los Angeles Rams": LATE,
};

/* The same three games, as the feed writes them now. */
const KICKOFFS_NEW = {
  "Buffalo Bills": { at: THU, opp: "MIA", home: true },
  "Chicago Bears": { at: EARLY, opp: "GB", home: false },
  "Los Angeles Rams": { at: LATE, opp: "SEA", home: true },
};

const state = (over = {}) => ({
  playerPool: [
    { id: "p1", name: "Opener QB", position: "QB", team: "Buffalo Bills", status: "Active" },
    { id: "p2", name: "Early WR", position: "WR", team: "Chicago Bears", status: "Active" },
    { id: "p3", name: "Late RB", position: "RB", team: "Los Angeles Rams", status: "Active" },
    { id: "p4", name: "Bye TE", position: "TE", team: "New York Jets", status: "Active" },
  ],
  lockedPlayerIds: {},
  _meta: { lineupLock: LINEUP_LOCK.GAMETIME, kickoffs: KICKOFFS },
  ...over,
});

const at = (iso) => Date.parse(iso);

describe("which policy a league is playing", () => {
  it("defaults to gametime - what every league already plays", () => {
    expect(DEFAULT_LINEUP_LOCK).toBe(LINEUP_LOCK.GAMETIME);
    expect(lineupLockMode({})).toBe(LINEUP_LOCK.GAMETIME);
    expect(lineupLockMode({ _meta: {} })).toBe(LINEUP_LOCK.GAMETIME);
  });

  it("reads anything it does not recognise as the default, never as 'no lock'", () => {
    expect(normalizeLineupLock("whenever")).toBe(LINEUP_LOCK.GAMETIME);
    expect(normalizeLineupLock(null)).toBe(LINEUP_LOCK.GAMETIME);
    expect(normalizeLineupLock(LINEUP_LOCK.WEEKLY)).toBe(LINEUP_LOCK.WEEKLY);
  });
});

describe("gametime: each player at his own kickoff", () => {
  const s = state();

  it("locks nobody before the first game", () => {
    const before = at("2026-09-09T12:00:00Z");
    expect(isPlayerLocked(s, "p1", before)).toBe(false);
    expect(isPlayerLocked(s, "p2", before)).toBe(false);
    expect(isPlayerLocked(s, "p3", before)).toBe(false);
  });

  it("locks the Thursday player and leaves Sunday alone", () => {
    const fri = at("2026-09-11T15:00:00Z");
    expect(isPlayerLocked(s, "p1", fri)).toBe(true);
    expect(isPlayerLocked(s, "p2", fri)).toBe(false);
    expect(isPlayerLocked(s, "p3", fri)).toBe(false);
  });

  it("leaves the late window open once the early games have started", () => {
    const oneThirty = at("2026-09-13T17:30:00Z");
    expect(isPlayerLocked(s, "p2", oneThirty)).toBe(true);
    expect(isPlayerLocked(s, "p3", oneThirty)).toBe(false);
  });

  it("locks exactly at kickoff, not a moment before", () => {
    expect(isPlayerLocked(s, "p2", at(EARLY) - 1)).toBe(false);
    expect(isPlayerLocked(s, "p2", at(EARLY))).toBe(true);
  });

  it("never locks a player with no game this week", () => {
    expect(isPlayerLocked(s, "p4", at("2026-09-14T23:00:00Z"))).toBe(false);
  });
});

describe("weekly: everybody at the week's first kickoff", () => {
  const s = state({ _meta: { lineupLock: LINEUP_LOCK.WEEKLY, kickoffs: KICKOFFS } });

  it("locks on the earliest game of the week, whichever weekday that is", () => {
    expect(firstKickoff(KICKOFFS)).toBe(THU);
    expect(lockTimeFor(LINEUP_LOCK.WEEKLY, KICKOFFS, "Los Angeles Rams")).toBe(THU);
  });

  it("leaves everyone changeable right up to it", () => {
    const justBefore = at(THU) - 1000;
    ["p1", "p2", "p3", "p4"].forEach((id) => expect(isPlayerLocked(s, id, justBefore)).toBe(false));
  });

  it("locks the whole roster at once - the bye-week player included", () => {
    const after = at(THU) + 1000;
    ["p1", "p2", "p3", "p4"].forEach((id) => expect(isPlayerLocked(s, id, after)).toBe(true));
  });

  it("says which rule refused the swap", () => {
    expect(lockReason(s, "p3", at(THU) + 1000)).toMatch(/first kickoff/);
    expect(lockReason(state(), "p3", at(LATE))).toMatch(/Los Angeles Rams/);
    expect(lockReason(state(), "p3", at(EARLY))).toBe(null);
  });
});

describe("a week with no kickoff times", () => {
  const s = state({ _meta: { lineupLock: LINEUP_LOCK.WEEKLY, kickoffs: {} } });

  it("locks nothing on the clock rather than guessing", () => {
    const sunday = at("2026-09-13T20:00:00Z");
    ["p1", "p2", "p3"].forEach((id) => expect(isPlayerLocked(s, id, sunday)).toBe(false));
    expect(firstKickoff({})).toBe(null);
    expect(lockedByClock(LINEUP_LOCK.WEEKLY, {}, "Buffalo Bills", sunday)).toBe(false);
  });

  it("still honours the commissioner's own lock", () => {
    const locked = state({ lockedPlayerIds: { p2: true }, _meta: { kickoffs: {} } });
    expect(isPlayerLocked(locked, "p2", at("2026-09-09T00:00:00Z"))).toBe(true);
    expect(lockReason(locked, "p2")).toMatch(/commissioner/);
  });
});

describe("the manual lock outranks the schedule", () => {
  it("holds a player nobody's clock would lock", () => {
    const s = state({ lockedPlayerIds: { p4: true } });
    expect(isPlayerLocked(s, "p4", at("2026-09-09T00:00:00Z"))).toBe(true);
  });
});

/* The roster row shows each player's own game beside his NFL team (issue #33). It reads
 * the same `periods.kickoffs` the lock reads, so the card cannot name a time the lock
 * disagrees with - and it stays silent rather than guessing one. */
describe("the kickoff a roster row shows", () => {
  const s = state();

  it("gives a player his own team's game", () => {
    expect(playerKickoff(s, s.playerPool[1])).toBe(EARLY);
    expect(playerKickoff(s, s.playerPool[2])).toBe(LATE);
  });

  it("says nothing for a bye week, a missing player, or a week never read", () => {
    expect(playerKickoff(s, s.playerPool[3])).toBe(null);
    expect(playerKickoff(s, null)).toBe(null);
    expect(playerKickoff(state({ _meta: { kickoffs: {} } }), s.playerPool[1])).toBe(null);
  });

  it("refuses a half-written time rather than rendering Invalid Date", () => {
    const broken = state({ _meta: { kickoffs: { "Chicago Bears": "not a date" } } });
    expect(playerKickoff(broken, s.playerPool[1])).toBe(null);
  });

  it("carries the date as well as the weekday, because a card can be read weeks later", () => {
    /* Local timezone by design, so this asserts the SHAPE - weekday, m/d, and a clock -
     * rather than a wall time that would only hold in whichever zone CI runs in. */
    const text = formatKickoffDay(EARLY);
    expect(text).toMatch(/^[A-Za-z]{3}, \d{1,2}\/\d{1,2} \d{1,2}:\d{2}/);
    expect(formatKickoffDay(null)).toBe("");
    expect(formatKickoffDay("not a date")).toBe("");
  });
});

/* ================================================================= the two shapes == */

describe("the same week in either shape", () => {
  /* THE ONE THAT WOULD COST A LEAGUE ITS LOCKS. A period written before 2026-09-08 holds
   * bare timestamps and one written after holds objects, and both are live at once - so
   * every verdict below is asserted twice, once from each. If these ever disagree, a
   * league mid-season is locking on nothing. */
  it("reaches identical lock verdicts from a string and from an object", () => {
    [KICKOFFS, KICKOFFS_NEW].forEach((kickoffs) => {
      expect(lockTimeFor(LINEUP_LOCK.GAMETIME, kickoffs, "Chicago Bears")).toBe(EARLY);
      expect(lockTimeFor(LINEUP_LOCK.WEEKLY, kickoffs, "Chicago Bears")).toBe(THU);
      expect(firstKickoff(kickoffs)).toBe(THU);
      expect(lockedByClock(LINEUP_LOCK.GAMETIME, kickoffs, "Chicago Bears", at(LATE))).toBe(true);
      expect(lockedByClock(LINEUP_LOCK.GAMETIME, kickoffs, "Chicago Bears", at(THU))).toBe(false);
      /* A team with no game locks on nothing, in either shape. */
      expect(lockTimeFor(LINEUP_LOCK.GAMETIME, kickoffs, "New York Jets")).toBe(null);
    });
  });

  it("takes the time out of either one, and nothing out of junk", () => {
    expect(kickoffAt(EARLY)).toBe(EARLY);
    expect(kickoffAt({ at: EARLY, opp: "GB", home: false })).toBe(EARLY);
    expect(kickoffAt(null)).toBe(null);
    expect(kickoffAt(undefined)).toBe(null);
    expect(kickoffAt("not a date")).toBe(null);
    expect(kickoffAt({})).toBe(null);
    expect(kickoffAt({ at: "not a date" })).toBe(null);
    expect(kickoffAt({ opp: "GB" })).toBe(null);
  });

  /* The opponent is the half the old shape cannot answer, and "we do not know" has to
   * come back as null rather than as a guess or a crash. */
  it("has no opponent to give for a week stored the old way", () => {
    expect(gameFor(KICKOFFS, "Chicago Bears")).toEqual({ at: EARLY, opp: null, home: null });
    expect(gameFor(KICKOFFS_NEW, "Chicago Bears")).toEqual({ at: EARLY, opp: "GB", home: false });
    expect(gameFor(KICKOFFS_NEW, "New York Jets")).toBe(null);
    expect(gameFor(KICKOFFS_NEW, null)).toBe(null);
    expect(gameFor({}, "Chicago Bears")).toBe(null);
  });

  it("reads a player's game off the state the row is rendered from", () => {
    const s = state({ _meta: { lineupLock: LINEUP_LOCK.GAMETIME, kickoffs: KICKOFFS_NEW } });
    expect(playerGame(s, s.playerPool[1])).toEqual({ at: EARLY, opp: "GB", home: false });
    expect(playerGame(s, s.playerPool[3])).toBe(null); // the bye
    expect(playerGame(s, null)).toBe(null);
    /* The time still comes back through the old accessor, which the lock screens use. */
    expect(playerKickoff(s, s.playerPool[1])).toBe(EARLY);
  });

  /* WHY THIS EXISTS: a row can only say "No game this week" once it knows the difference
   * between a bye and a Monday. Both look like a missing entry from one player's point of
   * view; the difference is whether anyone at all has a game. */
  it("knows whether the week's schedule has been read at all", () => {
    expect(weekScheduleKnown(state())).toBe(true);
    expect(weekScheduleKnown(state({ _meta: { kickoffs: KICKOFFS_NEW } }))).toBe(true);
    expect(weekScheduleKnown(state({ _meta: { kickoffs: {} } }))).toBe(false);
    expect(weekScheduleKnown(state({ _meta: {} }))).toBe(false);
    expect(weekScheduleKnown({})).toBe(false);
    /* Entries that carry no usable time are not a schedule. */
    expect(weekScheduleKnown(state({ _meta: { kickoffs: { "Buffalo Bills": { opp: "MIA" } } } }))).toBe(false);
  });
});

/* ============================================================= writing a team short == */

describe("how a team is written on a roster row", () => {
  it("has one abbreviation per team, and no two teams sharing one", () => {
    const names = Object.keys(NFL_TEAM_ABBR);
    const abbrs = Object.values(NFL_TEAM_ABBR);
    expect(names).toHaveLength(32);
    expect(new Set(abbrs).size).toBe(32);
  });

  /* A commissioner can type any team he likes when he adds a player by hand. Showing what
   * he typed is the only honest answer - an empty chip hides the team, and a guess puts the
   * player on the wrong one. */
  it("falls back to what was typed, and says nothing for nothing", () => {
    expect(abbrFor("Detroit Lions")).toBe("DET");
    expect(abbrFor("Practice Squad")).toBe("Practice Squad");
    expect(abbrFor("")).toBe("");
    expect(abbrFor(null)).toBe("");
    expect(abbrFor(undefined)).toBe("");
  });

  /* The feed's table is the flip of this one plus two alternate spellings, so a rename
   * cannot leave the screens and the schedule reader disagreeing about a team. */
  it("agrees with the feed's own table, both directions", async () => {
    const { NFL_TEAMS } = await import("../server/feed/nflverse.js");
    Object.entries(NFL_TEAM_ABBR).forEach(([name, abbr]) => {
      expect(NFL_TEAMS[abbr]).toBe(name);
    });
    expect(NFL_TEAMS.JAC).toBe("Jacksonville Jaguars");
    expect(NFL_TEAMS.LA).toBe("Los Angeles Rams");
    expect(Object.keys(NFL_TEAMS)).toHaveLength(34);
  });
});

describe("reading kickoff times out of games.csv", () => {
  const rows = [
    { season: "2026", week: "2", gameday: "2026-09-17", gametime: "20:15", home_team: "BUF", away_team: "MIA" },
    { season: "2026", week: "2", gameday: "2026-09-20", gametime: "13:00", home_team: "CHI", away_team: "GB" },
    { season: "2026", week: "3", gameday: "2026-09-27", gametime: "13:00", home_team: "BUF", away_team: "NYJ" },
    { season: "2025", week: "2", gameday: "2025-09-18", gametime: "20:15", home_team: "SEA", away_team: "SF" },
  ];

  /* CHANGED 2026-09-08, and this is the deliberate difference: an entry used to BE the
   * timestamp and is now `{ at, opp, home }`. The roster row names a player's opponent
   * now (Scott's call, option B of four), and the two team names were being read here and
   * thrown away. `at` does what the bare string did, which is what keeps every lock
   * verdict identical. */
  it("gives both teams in a game the same kickoff, keyed by the pool's team names", () => {
    const k = kickoffsFromGames(rows, { season: 2026, week: 2 });
    expect(k["Buffalo Bills"].at).toBe("2026-09-18T00:15:00.000Z");
    expect(k["Miami Dolphins"].at).toBe(k["Buffalo Bills"].at);
    expect(Object.keys(k)).toHaveLength(4);
  });

  it("names each team's opponent, and which side of it is at home", () => {
    const k = kickoffsFromGames(rows, { season: 2026, week: 2 });
    expect(k["Buffalo Bills"]).toEqual({ at: "2026-09-18T00:15:00.000Z", opp: "MIA", home: true });
    expect(k["Miami Dolphins"]).toEqual({ at: "2026-09-18T00:15:00.000Z", opp: "BUF", home: false });
  });

  /* THE REASON THE OPPONENT GOES abbr -> full name -> abbr RATHER THAN STRAIGHT THROUGH.
   * nflverse spells Jacksonville JAX in one file and JAC in another, and the Rams LA or
   * LAR, so a row passing the file's own letters along would show "at JAC" one week and
   * "at JAX" the next and look like two different teams. */
  it("normalises the opponent's abbreviation, whichever one the file used", () => {
    const k = kickoffsFromGames(
      [{ season: "2026", week: "7", gameday: "2026-10-18", gametime: "13:00", home_team: "JAC", away_team: "LA" }],
      { season: 2026, week: 7 }
    );
    expect(k["Jacksonville Jaguars"].opp).toBe("LAR");
    expect(k["Los Angeles Rams"].opp).toBe("JAX");
  });

  it("takes only the season and week asked for", () => {
    const k = kickoffsFromGames(rows, { season: 2026, week: 2 });
    expect(k["New York Jets"]).toBeUndefined(); // week 3
    expect(k["Seattle Seahawks"]).toBeUndefined(); // 2025
  });

  it("skips a game with no time rather than guessing one", () => {
    const k = kickoffsFromGames(
      [{ season: "2026", week: "5", gameday: "2026-10-11", gametime: "", home_team: "BUF", away_team: "MIA" }],
      { season: 2026, week: 5 }
    );
    expect(k).toEqual({});
  });

  /* THE ONE THAT WOULD COST A LEAGUE A WEEK. Those times are Eastern wall clock with no
   * offset written down, and the offset is not constant: read as UTC, or with a
   * hardcoded -5, a September one o'clock game locks four hours early. */
  it("reads the times as Eastern, through the change back to standard time", () => {
    expect(kickoffIso("2026-09-13", "13:00")).toBe("2026-09-13T17:00:00.000Z"); // EDT, -4
    expect(kickoffIso("2026-12-20", "13:00")).toBe("2026-12-20T18:00:00.000Z"); // EST, -5
    expect(kickoffIso("2026-11-01", "13:00")).toBe("2026-11-01T18:00:00.000Z"); // the morning it changes
  });

  it("returns null for a half-written row instead of an invalid date", () => {
    expect(kickoffIso("", "13:00")).toBe(null);
    expect(kickoffIso("2026-12-20", "")).toBe(null);
    expect(kickoffIso("Sunday", "13:00")).toBe(null);
    expect(kickoffIso("2026-12-20", "afternoon")).toBe(null);
  });
});

describe("the recorded schedule", () => {
  it("carries a real week of kickoffs, so the lock can be exercised locally", async () => {
    const fixture = await import("../server/feed/fixture.js");
    const { kickoffs } = await fixture.fetchKickoffs({ season: 2026, week: 2 });
    /* Every team plays in a normal week, and each one needs a time or its manager gets
     * a lock nobody can explain. */
    expect(Object.keys(kickoffs)).toHaveLength(32);
    const first = firstKickoff(kickoffs);
    expect(first).toBeTruthy();
    /* The week's first game is its Thursday night one - which is exactly what a
     * `weekly` league locks on. */
    expect(new Date(first).getTime()).toBeLessThan(new Date(kickoffs["Buffalo Bills"].at).getTime() + 1);
  });

  it("names an opponent for every team it recorded, so the row is exercised locally too", async () => {
    const fixture = await import("../server/feed/fixture.js");
    const { kickoffs } = await fixture.fetchKickoffs({ season: 2026, week: 2 });
    const missing = Object.entries(kickoffs).filter(([, game]) => !game.opp);
    expect(missing).toEqual([]);
    /* And the two halves of a game agree about each other. */
    Object.entries(kickoffs).forEach(([team, game]) => {
      const other = Object.entries(kickoffs).find(([name]) => abbrFor(name) === game.opp);
      expect(other).toBeTruthy();
      expect(other[1].at).toBe(game.at);
      expect(other[1].opp).toBe(abbrFor(team));
      expect(other[1].home).toBe(!game.home);
    });
  });

  it("comes back empty for a week it never recorded, exactly as the live feed does", async () => {
    const fixture = await import("../server/feed/fixture.js");
    const { kickoffs } = await fixture.fetchKickoffs({ season: 2026, week: 23 });
    expect(kickoffs).toEqual({});
  });
});
