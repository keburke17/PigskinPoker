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
 *   _meta.tableSeats     2..13, or null for a season
 *   _meta.seats          { [teamId]: "seated" | "sitting_out" | "left" }
 *   _meta.seatedTeamIds  who is in the hand: the players seated NOW before the deal, and
 *                        the snapshot the deal took once it has been dealt
 */

export const SEAT = Object.freeze({
  SEATED: "seated",
  SITTING_OUT: "sitting_out",
  LEFT: "left",
});

export const SEAT_STATES = Object.freeze([SEAT.SEATED, SEAT.SITTING_OUT, SEAT.LEFT]);

/* 13, not 16: the most the deal can serve in a week with six NFL teams on a bye. The
 * migration's comment has the arithmetic. */
export const TABLE_SEATS_MIN = 2;
export const TABLE_SEATS_MAX = 13;

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

/** Seats spoken for: everybody who has not left. Sitting out keeps your seat. */
export function seatsTaken(state) {
  return (state.teams || []).filter((t) => seatOf(state, t.id) !== SEAT.LEFT).length;
}

export function seatsFree(state) {
  const seats = tableSeats(state);
  return seats == null ? 0 : Math.max(0, seats - seatsTaken(state));
}

/** The players seated right now, in league order - who the next deal will deal in. */
export function seatedNowIds(state) {
  return (state.teams || []).filter((t) => seatOf(state, t.id) === SEAT.SEATED).map((t) => t.id);
}

/** Who is in the hand on the table now. See the `_meta.seatedTeamIds` note above. */
export function handTeamIds(state) {
  const ids = state && state._meta && state._meta.seatedTeamIds;
  return Array.isArray(ids) ? ids : seatedNowIds(state);
}

/**
 * Can this player be dealt into the NEXT hand, and if not, why not? Used by the deal and
 * by the clock, so the refusal reads the same from the button and from the log.
 */
export function tableDealProblem(state) {
  if (!isTable(state)) return null;
  const n = handTeamIds(state).length;
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
      { teamId: t.id, name: t.name, seat: seatOf(state, t.id), played: 0, won: 0, lost: 0, order: i },
    ])
  );
  (state.weeklyResults || []).forEach((r) => {
    const row = rows.get(r.teamId);
    if (!row) return;
    row.played += 1;
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
