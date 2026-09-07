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
  isPlayerLocked,
  lineupLockMode,
  lockReason,
  lockTimeFor,
  lockedByClock,
  normalizeLineupLock,
} from "../src/engine/lineupLock.js";
import { kickoffIso, kickoffsFromGames } from "../server/feed/nflverse.js";

/* One Sunday, three windows, and a team on a bye. */
const THU = "2026-09-10T00:20:00.000Z"; // Wed/Thu night opener
const EARLY = "2026-09-13T17:00:00.000Z"; // 1:00 PM ET
const LATE = "2026-09-13T20:05:00.000Z"; // 4:05 PM ET

const KICKOFFS = {
  "Buffalo Bills": THU,
  "Chicago Bears": EARLY,
  "Los Angeles Rams": LATE,
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

describe("reading kickoff times out of games.csv", () => {
  const rows = [
    { season: "2026", week: "2", gameday: "2026-09-17", gametime: "20:15", home_team: "BUF", away_team: "MIA" },
    { season: "2026", week: "2", gameday: "2026-09-20", gametime: "13:00", home_team: "CHI", away_team: "GB" },
    { season: "2026", week: "3", gameday: "2026-09-27", gametime: "13:00", home_team: "BUF", away_team: "NYJ" },
    { season: "2025", week: "2", gameday: "2025-09-18", gametime: "20:15", home_team: "SEA", away_team: "SF" },
  ];

  it("gives both teams in a game the same kickoff, keyed by the pool's team names", () => {
    const k = kickoffsFromGames(rows, { season: 2026, week: 2 });
    expect(k["Buffalo Bills"]).toBe("2026-09-18T00:15:00.000Z");
    expect(k["Miami Dolphins"]).toBe(k["Buffalo Bills"]);
    expect(Object.keys(k)).toHaveLength(4);
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
    expect(new Date(first).getTime()).toBeLessThan(new Date(kickoffs["Buffalo Bills"]).getTime() + 1);
  });

  it("comes back empty for a week it never recorded, exactly as the live feed does", async () => {
    const fixture = await import("../server/feed/fixture.js");
    const { kickoffs } = await fixture.fetchKickoffs({ season: 2026, week: 23 });
    expect(kickoffs).toEqual({});
  });
});
