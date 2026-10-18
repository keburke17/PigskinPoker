/**
 * Table mode (issue #75, OQ-30) - the engine half.
 *
 * A table is a league whose players choose, hand by hand, whether to be dealt in. The
 * engine learns that from `state._meta` (see src/engine/table.js), so the thing to pin
 * hardest is the boundary: a state that does not say it is a table is a season, and a
 * season answers every question exactly as it did before table mode existed.
 */

import { describe, it, expect } from "vitest";
import {
  SEAT,
  dealRosters,
  finalizeCurrentPeriod,
  handHistory,
  isTable,
  periodTeamIds,
  periodTeams,
  playoffsDueToStart,
  seatsFree,
  seatsTaken,
  seededRng,
  tableDealProblem,
  tableRecord,
} from "../src/engine/index.js";
import { decomposeLeague } from "../src/storage/decompose.js";
import { baseState, fillStats } from "./helpers/fixtures.js";

/** A table of `n` players, seats as given (default: everybody seated). */
function tableState(n, { seats = 8, seat = {}, seatedTeamIds } = {}) {
  const s = baseState(n);
  const seatMap = {};
  s.teams.forEach((t) => { seatMap[t.id] = seat[t.id] || SEAT.SEATED; });
  s._meta = { mode: "table", tableSeats: seats, seats: seatMap };
  s._meta.seatedTeamIds = seatedTeamIds ?? s.teams.filter((t) => seatMap[t.id] === SEAT.SEATED).map((t) => t.id);
  return s;
}

/** Deal whoever is in the hand, as the server's applyDeal does. */
function dealHand(s, seed = 11) {
  const ids = periodTeamIds(s);
  const res = dealRosters(s, ids, seededRng(seed));
  if (res.error) throw new Error(res.error);
  Object.entries(res.rosters).forEach(([id, roster]) => {
    s.teams.find((t) => t.id === id).roster = roster;
  });
  s.currentPeriod.phase = "dealt";
  return s;
}

describe("a season is untouched by table mode", () => {
  it("is not a table without _meta, or with mode season", () => {
    const s = baseState(4);
    expect(isTable(s)).toBe(false);
    s._meta = { mode: "season" };
    expect(isTable(s)).toBe(false);
  });

  it("still plays every team, whatever seat data happens to be lying around", () => {
    const s = baseState(4);
    s._meta = { mode: "season", seats: { team_0: SEAT.LEFT }, seatedTeamIds: ["team_1"] };
    expect(periodTeamIds(s)).toEqual(s.teams.map((t) => t.id));
  });
});

describe("who is in the hand", () => {
  it("is the seated players, not everybody at the table", () => {
    const s = tableState(5, { seat: { team_1: SEAT.SITTING_OUT, team_3: SEAT.LEFT } });
    expect(periodTeamIds(s)).toEqual(["team_0", "team_2", "team_4"]);
    expect(periodTeams(s).map((t) => t.id)).toEqual(["team_0", "team_2", "team_4"]);
  });

  it("is the snapshot once dealt, even if a seat changed since", () => {
    /* The door closes at the deal. hydrate hands the engine the deal's snapshot, so a
     * player who sits out mid-hand still plays out the cards they were dealt. */
    const s = tableState(4, { seatedTeamIds: ["team_0", "team_1", "team_2"] });
    s._meta.seats.team_1 = SEAT.SITTING_OUT;
    expect(periodTeamIds(s)).toEqual(["team_0", "team_1", "team_2"]);
  });

  it("deals only the seated players, and leaves the rest with no cards", () => {
    const s = dealHand(tableState(4, { seat: { team_2: SEAT.SITTING_OUT } }));
    expect(s.teams.find((t) => t.id === "team_2").roster).toBeNull();
    ["team_0", "team_1", "team_3"].forEach((id) => {
      expect(s.teams.find((t) => t.id === id).roster).not.toBeNull();
    });
  });
});

describe("seats", () => {
  it("counts sitting out as a taken seat, and leaving as a free one", () => {
    const s = tableState(4, { seats: 5, seat: { team_1: SEAT.SITTING_OUT, team_2: SEAT.LEFT } });
    expect(seatsTaken(s)).toBe(3);
    expect(seatsFree(s)).toBe(2);
  });

  it("refuses a hand of fewer than two", () => {
    expect(tableDealProblem(tableState(1))).toMatch(/at least 2/);
    expect(tableDealProblem(tableState(3, { seat: { team_0: SEAT.LEFT, team_1: SEAT.SITTING_OUT } }))).toMatch(/only 1/);
    expect(tableDealProblem(tableState(2))).toBeNull();
    expect(tableDealProblem(baseState(1))).toBeNull(); // a season is not asked
  });
});

describe("a finished hand", () => {
  it("ranks only the players in it, on a ladder sized to them", () => {
    const s = dealHand(tableState(5, { seat: { team_4: SEAT.SITTING_OUT } }));
    fillStats(s, periodTeamIds(s), 3);
    s.currentPeriod.phase = "schemes-processed";
    const { state: next } = finalizeCurrentPeriod(s, seededRng(9));
    const results = next.weeklyResults.filter((r) => r.period.number === 1);
    expect(results.map((r) => r.teamId).sort()).toEqual(["team_0", "team_1", "team_2", "team_3"]);
    // Four in the hand: 4 for the winner down to 1.
    expect(results.map((r) => r.standingsPoints).sort()).toEqual([1, 2, 3, 4]);
  });

  it("never starts playoffs at a table", () => {
    const s = tableState(4);
    s.playoffConfig.startNflWeek = 1;
    expect(playoffsDueToStart(s, 5)).toBe(false);
  });
});

describe("the table's record", () => {
  const result = (teamId, number, rank) => ({
    teamId, rank, period: { type: "week", number, phase: "finalized" },
  });

  it("is hands played, won and lost - and a shared first is a win for both", () => {
    const s = tableState(3);
    s.weeklyResults = [
      result("team_0", 1, 1), result("team_1", 1, 2), result("team_2", 1, 3),
      result("team_0", 2, 1), result("team_1", 2, 1), // a dead tie for first
      result("team_2", 3, 1), result("team_1", 3, 2),
    ];
    const rec = Object.fromEntries(tableRecord(s).map((r) => [r.teamId, r]));
    expect(rec.team_0).toMatchObject({ played: 2, won: 2, lost: 0 });
    expect(rec.team_1).toMatchObject({ played: 3, won: 1, lost: 2 });
    expect(rec.team_2).toMatchObject({ played: 2, won: 1, lost: 1 });
    expect(tableRecord(s).map((r) => r.teamId)).toEqual(["team_0", "team_2", "team_1"]);
  });

  it("keeps a player who has left, record and all", () => {
    const s = tableState(2, { seat: { team_1: SEAT.LEFT } });
    s.weeklyResults = [result("team_0", 1, 2), result("team_1", 1, 1)];
    const gone = tableRecord(s).find((r) => r.teamId === "team_1");
    expect(gone).toMatchObject({ seat: SEAT.LEFT, won: 1 });
  });

  it("lists every hand newest first, winner on top", () => {
    const s = tableState(2);
    s.weeklyResults = [result("team_0", 1, 2), result("team_1", 1, 1), result("team_0", 2, 1)];
    const h = handHistory(s);
    expect(h.map((x) => x.label)).toEqual(["Hand 2", "Hand 1"]);
    expect(h[1].results[0].teamId).toBe("team_1");
  });
});

describe("what is written for a hand", () => {
  it("records the seated players as the hand's participants", () => {
    const s = tableState(4, { seat: { team_3: SEAT.SITTING_OUT } });
    const rows = decomposeLeague(s, { leagueKey: "t", year: 2026 });
    const teamUuid = new Map(rows.teams.map((t) => [t.legacy_id, t.id]));
    expect(rows.periods[0].participant_team_ids).toEqual(
      ["team_0", "team_1", "team_2"].map((id) => teamUuid.get(id))
    );
  });

  it("drops a participant whose team is no longer in the league", () => {
    const s = tableState(3, { seatedTeamIds: ["team_0", "team_1", "team_gone"] });
    const rows = decomposeLeague(s, { leagueKey: "t", year: 2026 });
    expect(rows.periods[0].participant_team_ids).toHaveLength(2);
  });
});
