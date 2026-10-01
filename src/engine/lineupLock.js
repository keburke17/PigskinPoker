/* When a manager stops being able to change his lineup.
 *
 * The league picks one of two policies and every screen and every write obeys it:
 *
 *   gametime  Each player locks when HIS OWN team kicks off. A manager can still move
 *             the players whose games have not started - the late-window receiver stays
 *             swappable at one o'clock. This is what the rules screen has always
 *             described, and what the commissioner has been enforcing by hand with the
 *             per-player Lock buttons.
 *
 *   weekly    The WHOLE lineup locks at the first kickoff of the week - Thursday night
 *             in most weeks, whichever game is genuinely first in this one. Set it and
 *             forget it: what you have on Thursday evening is what plays.
 *
 * PURE, AND DELIBERATELY TAKES `now` AND THE KICKOFFS AS ARGUMENTS. Nothing here reads
 * a clock or a network. The kickoff times are fetched server-side once a week and
 * stored on the period (see server/feed/nflverse.js and server/operations.js); the
 * browser is handed them in `_meta` and reaches the same verdict the server does, so
 * the LOCKED pill appears without a round trip and the server is still the one that
 * refuses the write.
 *
 * A PLAYER WITH NO KICKOFF NEVER LOCKS ON THE CLOCK. A bye week, a team the schedule
 * did not name, a week whose times were never read: the honest answer is "no game
 * time known", and locking on a guess would take a manager's team off him for a game
 * that is not being played. The commissioner's manual lock still covers that, and it
 * always wins - it is how an injury scratch gets frozen mid-afternoon.
 */

import { getPlayer } from "./state.js";

/** The two policies. Stored as these strings in `seasons.lineup_lock`. */
export const LINEUP_LOCK = {
  GAMETIME: "gametime",
  WEEKLY: "weekly",
};

/** What a league that has never chosen plays: today's behaviour, unchanged. */
export const DEFAULT_LINEUP_LOCK = LINEUP_LOCK.GAMETIME;

export const LINEUP_LOCK_MODES = [LINEUP_LOCK.GAMETIME, LINEUP_LOCK.WEEKLY];

/** Anything we do not recognise reads as the default rather than as "no locking". */
export function normalizeLineupLock(mode) {
  return LINEUP_LOCK_MODES.includes(mode) ? mode : DEFAULT_LINEUP_LOCK;
}

/** The policy a view is playing under. */
export function lineupLockMode(state) {
  return normalizeLineupLock(state && state._meta ? state._meta.lineupLock : null);
}

/** This period's kickoffs: NFL team name -> a game entry. Empty when unknown. */
export function kickoffsFor(state) {
  const k = state && state._meta ? state._meta.kickoffs : null;
  return k && typeof k === "object" ? k : {};
}

const stamp = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/**
 * The kickoff time out of one team's entry, IN EITHER SHAPE IT CAN BE STORED IN.
 *
 * `periods.kickoffs` used to be team -> ISO string, and became team -> `{ at, opp, home }`
 * on 2026-09-08 when the roster row started naming the opponent. Both shapes are live at
 * once and will be for the rest of the season: the column is only rewritten when a week's
 * schedule is re-read, so every period already finalized still holds bare strings, and so
 * does the current week until the next deal or Refresh Kickoff Times.
 *
 * READING BOTH IS THE WHOLE COMPATIBILITY STORY - there is no migration and no backfill.
 * A lock verdict is the one thing in this file that must never change for a week already
 * being played, so the old shape is not "legacy", it is a shape this function supports.
 *
 * @param {string|{at: string}|null} entry
 * @returns {string|null} ISO timestamp, or null when there is no usable time
 */
export function kickoffAt(entry) {
  if (!entry) return null;
  const iso = typeof entry === "string" ? entry : entry.at;
  return stamp(iso) == null ? null : iso;
}

/**
 * One team's whole game this week: when it starts, who they play, and where.
 *
 * `opp` is null for a team stored in the old bare-timestamp shape and for a team whose
 * opponent the schedule did not name - both mean "we do not know who", which a row says
 * by showing the time alone rather than by inventing a matchup.
 *
 * @returns {{at: string, opp: string|null, home: boolean|null}|null} null when this team
 *   has no game we can put a time on - a bye, or a week nobody has read yet.
 */
export function gameFor(kickoffs, nflTeam) {
  if (!nflTeam) return null;
  const entry = (kickoffs || {})[nflTeam];
  const at = kickoffAt(entry);
  if (!at) return null;
  const opp = typeof entry === "object" && typeof entry.opp === "string" ? entry.opp : null;
  const home = typeof entry === "object" && typeof entry.home === "boolean" ? entry.home : null;
  return { at, opp, home };
}

/**
 * Has this week's schedule been read at all?
 *
 * THE POINT IS TO TELL A BYE APART FROM NOT KNOWING YET, which a row has to do before it
 * can say "no game this week" out loud. Both look identical from one player's entry - it
 * is missing either way - and the difference is whether ANY team has a game. On a Monday
 * before the times are fetched every player is silent; once they are in, a player with no
 * entry genuinely is not playing.
 */
export function weekScheduleKnown(state) {
  return Object.values(kickoffsFor(state)).some((entry) => kickoffAt(entry) != null);
}

/**
 * The first kickoff of the week - what a `weekly` league locks on.
 * @returns {string|null} ISO timestamp, or null when no times are known.
 */
export function firstKickoff(kickoffs) {
  let best = null;
  Object.values(kickoffs || {}).forEach((entry) => {
    const iso = kickoffAt(entry);
    if (iso == null) return;
    const t = stamp(iso);
    if (best == null || t < best.t) best = { t, iso };
  });
  return best ? best.iso : null;
}

/**
 * The moment one player's lineup slot closes under this policy.
 *
 * @param {string} mode      a LINEUP_LOCK value
 * @param {object} kickoffs  NFL team name -> ISO
 * @param {string} nflTeam   the player's NFL team, as the pool spells it
 * @returns {string|null} ISO timestamp, or null when nothing is known to lock on
 */
export function lockTimeFor(mode, kickoffs, nflTeam) {
  if (normalizeLineupLock(mode) === LINEUP_LOCK.WEEKLY) return firstKickoff(kickoffs);
  if (!nflTeam) return null;
  return kickoffAt((kickoffs || {})[nflTeam]);
}

/** Has that moment passed? False whenever there is no time to compare against. */
export function lockedByClock(mode, kickoffs, nflTeam, now = Date.now()) {
  const iso = lockTimeFor(mode, kickoffs, nflTeam);
  if (!iso) return false;
  return Number(now) >= stamp(iso);
}

/**
 * The question every screen actually asks: can this manager still move this player?
 *
 * Manual first, because the commissioner's lock is a statement about a player - out
 * warming up, ruled out an hour before - and must not be undone by the schedule.
 */
export function isPlayerLocked(state, playerId, now = Date.now()) {
  if (!playerId) return false;
  if ((state.lockedPlayerIds || {})[playerId]) return true;
  const player = getPlayer(state, playerId);
  return lockedByClock(lineupLockMode(state), kickoffsFor(state), player ? player.team : null, now);
}

/**
 * What to tell someone whose swap was refused, in the league's own terms. Returns null
 * when the player is not locked at all.
 */
export function lockReason(state, playerId, now = Date.now()) {
  if (!playerId) return null;
  if ((state.lockedPlayerIds || {})[playerId]) return "The commissioner has locked that player.";
  const player = getPlayer(state, playerId);
  const mode = lineupLockMode(state);
  if (!lockedByClock(mode, kickoffsFor(state), player ? player.team : null, now)) return null;
  return mode === LINEUP_LOCK.WEEKLY
    ? "Lineups locked at this week's first kickoff."
    : (player ? player.team : "That player's team") + " has kicked off.";
}

/**
 * A kickoff as a person reads it: "Sun 1:00 PM", in the reader's own timezone.
 *
 * Local rather than Eastern deliberately - a manager in Denver is deciding whether he
 * has time to swap somebody, and the answer is in the clock on his wall.
 */
export function formatKickoff(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch (e) {
    return "";
  }
}

/**
 * The same kickoff with its DATE on the front: "Sun, 9/14 1:00 PM".
 *
 * `formatKickoff` says "Sun 1:00 PM" because it is answering "how long have I got",
 * and the answer is always about this week. The roster card is answering a different
 * question - "when does this guy play" - on a screen that can be read weeks later,
 * where a bare weekday names no particular Sunday. Local timezone, for the same reason
 * as above: the manager is looking at the clock on his wall.
 */
export function formatKickoffDay(iso) {
  if (!iso) return "";
  try {
    const at = new Date(iso);
    /* A string that is not a time reads out as "Invalid Date Invalid Date" rather than
     * throwing, so say nothing instead - the same answer this file gives everywhere
     * else it does not know something. */
    if (!Number.isFinite(at.getTime())) return "";
    const day = at.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" });
    const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return day + " " + time;
  } catch (e) {
    return "";
  }
}

/** This player's own kickoff, whatever the league locks on. Null when the week's times
 * have not been read, or his team is not playing - never a guess. */
export function playerKickoff(state, player) {
  if (!player || !player.team) return null;
  return kickoffAt(kickoffsFor(state)[player.team]);
}

/** This player's game: when it starts, who his team plays, and whether it is at home.
 * Null when his team has no game we can put a time on. */
export function playerGame(state, player) {
  if (!player) return null;
  return gameFor(kickoffsFor(state), player.team);
}
