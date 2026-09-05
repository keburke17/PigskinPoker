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

/** This period's kickoffs: NFL team name -> ISO timestamp. Empty when unknown. */
export function kickoffsFor(state) {
  const k = state && state._meta ? state._meta.kickoffs : null;
  return k && typeof k === "object" ? k : {};
}

const stamp = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/**
 * The first kickoff of the week - what a `weekly` league locks on.
 * @returns {string|null} ISO timestamp, or null when no times are known.
 */
export function firstKickoff(kickoffs) {
  let best = null;
  Object.values(kickoffs || {}).forEach((iso) => {
    const t = stamp(iso);
    if (t == null) return;
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
  const iso = (kickoffs || {})[nflTeam];
  return stamp(iso) == null ? null : iso;
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
