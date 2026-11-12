/* Pigskin Poker - table mode (issue #75, OQ-30).
 *
 * A TABLE is the second shape of league. A season plays the same teams every week into a
 * standings table and a bracket; a table plays one hand at a time, and each player
 * chooses whether to be in the next one. The tally is hands won and lost.
 *
 * WHAT THIS FILE IS NOT: a second engine. A hand is a period, and it is dealt, schemed,
 * scored and finalized by exactly the code a week is. The only question a table answers
 * differently is "who is in this period" - see periodTeamIds in standings.js - and the
 * answers to it live here.
 *
 * Everything a table knows arrives in `state._meta`, for the reason nflWeek and the clock
 * switches do: the artifact's state shape has no field for it, parity depends on that
 * shape staying put, and decompose must never carry it. A state without `_meta` - every
 * test fixture, every parity replay - is a season.
 *
 *   _meta.mode           "season" | "table"
 *   _meta.tableSeats     the most in one hand, 2..12, or null for a season
 *   _meta.seats          { [teamId]: "seated" | "waiting" | "sitting_out" | "left" }
 *   _meta.seatedTeamIds  the snapshot the deal took, once the hand has been dealt. Before
 *                        the deal it is ignored and the hand is worked out here.
 *   _meta.tableFill      "dealer" | "line" | "player" - who sits in from the lobby
 *   _meta.lobby          { [teamId]: { order, ready, hold, removed } }
 *
 * THE LOBBY (OQ-39, Scott 2026-11-12). The 12 counts the HAND, not the membership. Anyone
 * invited is a member; whoever is not in the next hand is in the lobby - waiting in line,
 * or sitting out. At the deal, open seats fill from the line according to `tableFill`:
 *
 *   dealer   nobody sits in unless the dealer deals them in by hand
 *   line     open seats fill from the front of the line (the default)
 *   player   players in line who said "I'm In" fill open seats, in line order
 *
 * The line is kept under all three, so a dealer who switches to "line" mid-season finds
 * it already there. A player the dealer is holding back is skipped by the fill.
 */

import { periodLabel } from "./helpers.js";

export const SEAT = Object.freeze({
  SEATED: "seated",
  WAITING: "waiting",
  SITTING_OUT: "sitting_out",
  LEFT: "left",
});

export const SEAT_STATES = Object.freeze([SEAT.SEATED, SEAT.WAITING, SEAT.SITTING_OUT, SEAT.LEFT]);

/* 12 (OQ-39, Scott 2026-11-12). It was 13 - the most the deal can always serve, with six
 * NFL teams on a bye - and Scott capped a hand at 12, the same as a season's league. */
export const TABLE_SEATS_MIN = 2;
export const TABLE_SEATS_MAX = 12;

/* Who moves people from the lobby into an open seat (OQ-39). */
export const TABLE_FILL = Object.freeze({ DEALER: "dealer", LINE: "line", PLAYER: "player" });
export const TABLE_FILLS = Object.freeze([TABLE_FILL.DEALER, TABLE_FILL.LINE, TABLE_FILL.PLAYER]);
export const TABLE_FILL_DEFAULT = TABLE_FILL.LINE;

/* A SEASON league's cap, separate from a table's. Scott, 2026-10-29: 12, because the
 * pool's QBs and TEs have to stretch across every roster in a week with teams on a bye.
 * Enforced where a team is made - the invite link and the commissioner's Add Team. */
export const SEASON_TEAMS_MAX = 12;

/* A hand of one is not a game - there is nobody to beat and nobody to steal from. */
export const TABLE_MIN_PLAYERS = 2;

export function isTable(state) {
  return Boolean(state && state._meta && state._meta.mode === "table");
}

export function tableSeats(state) {
  return isTable(state) ? Number(state._meta.tableSeats) || null : null;
}

/** A team's standing at the table. Anything unrecorded is seated, which is the default. */
export function seatOf(state, teamId) {
  const seats = (state && state._meta && state._meta.seats) || {};
  return SEAT_STATES.includes(seats[teamId]) ? seats[teamId] : SEAT.SEATED;
}

/** Players already in the next hand: the seated ones. They are what counts against the 12. */
export function seatsTaken(state) {
  return seatedNowIds(state).length;
}

/** Open seats in the next hand, before anybody is filled in from the line. */
export function seatsFree(state) {
  const seats = tableSeats(state);
  return seats == null ? 0 : Math.max(0, seats - seatsTaken(state));
}

/** The players seated right now, in league order. */
export function seatedNowIds(state) {
  return (state.teams || []).filter((t) => seatOf(state, t.id) === SEAT.SEATED).map((t) => t.id);
}

/** How this table fills its open seats. Anything unrecorded is the default, the line. */
export function tableFill(state) {
  const f = state && state._meta && state._meta.tableFill;
  return TABLE_FILLS.includes(f) ? f : TABLE_FILL_DEFAULT;
}

/** A team's place in the lobby: `{ order, ready, hold, removed }`, all empty if unrecorded. */
export function lobbyOf(state, teamId) {
  const lobby = (state && state._meta && state._meta.lobby) || {};
  const l = lobby[teamId] || {};
  return {
    order: Number.isFinite(l.order) ? l.order : null,
    ready: Boolean(l.ready),
    hold: Boolean(l.hold),
    removed: Boolean(l.removed),
  };
}

/**
 * The line: every player waiting in the lobby, front first. By place in line, then league
 * order for anybody without one, so the answer never depends on how rows came back.
 */
export function lobbyLine(state) {
  const order = new Map((state.teams || []).map((t, i) => [t.id, i]));
  const place = (id) => {
    const o = lobbyOf(state, id).order;
    return o == null ? Infinity : o;
  };
  return (state.teams || [])
    .filter((t) => seatOf(state, t.id) === SEAT.WAITING)
    .map((t) => t.id)
    .sort((a, b) => (place(a) === place(b) ? 0 : place(a) - place(b)) || order.get(a) - order.get(b));
}

/**
 * Who the deal will fill in from the line under this table's setting: as many as there are
 * open seats, from the front, skipping anybody the dealer is holding back - and, when the
 * players choose, anybody who has not said "I'm In". Nobody when the dealer does it by hand.
 */
export function autoSeatIds(state) {
  if (!isTable(state)) return [];
  const fill = tableFill(state);
  if (fill === TABLE_FILL.DEALER) return [];
  const open = seatsFree(state);
  if (open < 1) return [];
  return lobbyLine(state)
    .filter((id) => {
      const l = lobbyOf(state, id);
      if (l.hold) return false;
      return fill === TABLE_FILL.PLAYER ? l.ready : true;
    })
    .slice(0, open);
}

function handIsDealt(state) {
  return Boolean(state && state.currentPeriod && state.currentPeriod.phase !== "pre-deal");
}

/**
 * Who is in the hand on the table now.
 *
 * DEALT: the snapshot the deal took, whatever has happened to anybody's seat since - so a
 * player who sits out, or is removed, mid-hand still plays out the cards they were dealt.
 * NOT YET DEALT: the seated players plus whoever the line will fill in, in league order,
 * which is exactly what the deal will deal. The order is load-bearing: the deal hands out
 * cards in the order it is given the teams.
 */
export function handTeamIds(state) {
  const ids = state && state._meta && state._meta.seatedTeamIds;
  if (Array.isArray(ids) && handIsDealt(state)) return ids;
  return nextHandTeamIds(state);
}

/** Who the next deal would deal in, if it happened now: the seated, plus the line's fill. */
export function nextHandTeamIds(state) {
  const next = new Set(seatedNowIds(state).concat(autoSeatIds(state)));
  return (state.teams || []).filter((t) => next.has(t.id)).map((t) => t.id);
}

/**
 * Can this player be dealt into the NEXT hand, and if not, why not? Used by the deal and
 * by the clock, so the refusal reads the same from the button and from the log.
 */
export function tableDealProblem(state) {
  if (!isTable(state)) return null;
  const n = handTeamIds(state).length;
  const most = tableSeats(state) || TABLE_SEATS_MAX;
  if (n > most) {
    return "A hand is at most " + most + " players and " + n + " are seated - sit somebody out first.";
  }
  if (n < TABLE_MIN_PLAYERS) {
    return "A hand needs at least " + TABLE_MIN_PLAYERS + " players seated - " +
      (n === 0 ? "nobody is" : "only 1 is") + ".";
  }
  return null;
}

/**
 * The table's record: every player who has ever been at it, with the hands they played,
 * won and lost. Read-only and derived from the finalized results, the way the projected
 * scoreboard is - nothing new is stored for it.
 *
 * A WIN IS FIRST PLACE IN A HAND. Ranking shares a place on a dead tie (every tiebreaker
 * level), so two players can both win a hand; that is the same rule a season's "week
 * wins" tiebreaker has always counted by. Ordered by wins, then by fewest losses, then by
 * league order.
 */
export function tableRecord(state) {
  const rows = new Map(
    (state.teams || []).map((t, i) => [
      t.id,
      {
        teamId: t.id, name: t.name, seat: seatOf(state, t.id), removed: lobbyOf(state, t.id).removed,
        played: 0, won: 0, lost: 0, lastHand: null, order: i,
      },
    ])
  );
  (state.weeklyResults || []).forEach((r) => {
    const row = rows.get(r.teamId);
    if (!row) return;
    row.played += 1;
    if (r.period && Number.isFinite(r.period.number)) row.lastHand = Math.max(row.lastHand || 0, r.period.number);
    if (r.rank === 1) row.won += 1;
    else row.lost += 1;
  });
  return Array.from(rows.values()).sort(
    (a, b) => b.won - a.won || a.lost - b.lost || a.order - b.order
  );
}

/** Every finished hand, newest first: who played, and who won. */
export function handHistory(state) {
  const byHand = new Map();
  (state.weeklyResults || []).forEach((r) => {
    const key = r.period.type + "-" + r.period.number;
    if (!byHand.has(key)) byHand.set(key, { period: r.period, label: handLabel(r.period), results: [] });
    byHand.get(key).results.push(r);
  });
  return Array.from(byHand.values())
    .map((h) => ({ ...h, results: h.results.slice().sort((a, b) => a.rank - b.rank) }))
    .sort((a, b) => b.period.number - a.period.number);
}

/** "Hand 3" at a table, where a season would say "Week 3". */
export function handLabel(period) {
  return "Hand " + period.number;
}

/** The word for the person running the league. Same role underneath. */
export function hostTitle(state) {
  return isTable(state) ? "Dealer" : "Commissioner";
}

/**
 * A period's name on screen: "Hand 3" at a table, and whatever a season has always
 * called it ("Week 3", "Playoff Round 1") everywhere else. Words only - the period
 * itself, and every label stored with a result, is unchanged.
 */
export function periodTitle(state, period) {
  const p = period || (state && state.currentPeriod);
  if (isTable(state) && p && p.type === "week") return handLabel(p);
  return periodLabel(p);
}

/** "hand" at a table, "week" (or "round") in a season - for running text. */
export function periodWord(state, period) {
  const p = period || (state && state.currentPeriod);
  if (isTable(state)) return "hand";
  return p && p.type === "playoff" ? "round" : "week";
}
