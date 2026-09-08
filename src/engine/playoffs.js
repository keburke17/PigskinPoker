/* Pigskin Poker - playoff bracket start and settings.
 *
 * Moved from PigskinPokerCode.jsx lines 836-857, with `rng` threaded through uid().
 *
 * THE SEEDING ITSELF NOW LIVES IN standings.js, as `seedPlayoffBracket`. It had to move
 * when the playoffs stopped waiting on a button (OQ-16, 2026-09-07): `finalizeCurrentPeriod`
 * is what starts them now, and it is in standings.js, and this file already imports that
 * one. Leaving the seeding here and importing it back would have made a cycle out of two
 * files that have a perfectly clear order.
 *
 * `startPlayoffs` stays exported with the signature it has always had. Nothing in the app
 * calls it any more - the Start Playoffs button is gone - but tests/parity.test.js replays
 * the artifact's own `startPlayoffs` against it, and that is the safety net the whole port
 * rests on. It is a test seam now rather than a game action.
 */

import { defaultRng } from "./rng.js";
import { deepClone } from "./helpers.js";
import { seedPlayoffBracket } from "./standings.js";

/** Seed the bracket immediately. A test seam - see the file header. */
export function startPlayoffs(state, bracketSize, advancement, rng = defaultRng) {
  return seedPlayoffBracket(deepClone(state), bracketSize, advancement, rng);
}

/**
 * The NFL weeks a bracket of this shape would occupy, starting from `startNflWeek`.
 *
 * The last entry in an advancement ladder is the champion, who is never played for in a
 * round of their own - [8, 4, 2, 1] is THREE weeks of football, not four. Scott raised
 * this himself when he set the rule: "if there are 8 teams making playoffs and the format
 * is 8, 4, 2, 1 you would need at least 3 weeks of playoffs to be played."
 *
 * Returned so the commissioner can be shown the actual weeks before he commits, because
 * the mistake this prevents - a bracket that runs off the end of the season - is only
 * visible once somebody does the arithmetic.
 */
export function playoffWeekSpan(startNflWeek, advancement) {
  const start = Number(startNflWeek);
  if (!Number.isFinite(start) || start < 1) return null;
  const rounds = Array.isArray(advancement) ? Math.max(0, advancement.length - 1) : 0;
  if (!rounds) return null;
  return { rounds, firstWeek: start, lastWeek: start + rounds - 1 };
}

/**
 * Store the commissioner's playoff settings without starting anything.
 *
 * SEPARATE FROM SEEDING ON PURPOSE. Before OQ-16 the only way to record a bracket size
 * was to start the playoffs with it, so the settings and the act of starting were the
 * same button. Now the settings are a league rule set during setup and the start is a
 * date, so writing one must not trigger the other.
 *
 * Refuses once the bracket is live: changing the size or the ladder mid-playoffs would
 * re-cut a bracket teams are already playing in.
 */
export function savePlayoffSettings(state, { startNflWeek, bracketSize, advancement }) {
  const cfg = state.playoffConfig || {};
  if (cfg.started) {
    return { error: "The playoffs have already started - these settings are locked for the season." };
  }

  let week = null;
  if (startNflWeek != null && String(startNflWeek).trim() !== "") {
    week = Number(startNflWeek);
    if (!Number.isFinite(week) || week < 1 || week > 23 || Math.floor(week) !== week) {
      return { error: "The playoff start week must be an NFL week from 1 to 23." };
    }
  }

  const size = Math.floor(Number(bracketSize));
  if (!Number.isFinite(size) || size < 1) {
    return { error: "The number of teams making the playoffs must be at least 1." };
  }

  const adv = (Array.isArray(advancement) ? advancement : [])
    .map((n) => Math.floor(Number(n)))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!adv.length) {
    return { error: "The advancement format needs at least one round, e.g. 8, 4, 2, 1." };
  }
  if (adv[0] !== size) {
    return { error: "The advancement format must open with the bracket size - " + size + " teams." };
  }
  for (let i = 1; i < adv.length; i++) {
    if (adv[i] >= adv[i - 1]) {
      return { error: "Each playoff round must be smaller than the one before it." };
    }
  }
  if (adv[adv.length - 1] !== 1) {
    return { error: "The advancement format must end at 1 - the champion." };
  }

  const next = deepClone(state);
  next.playoffConfig = Object.assign({}, next.playoffConfig, {
    startNflWeek: week,
    bracketSize: size,
    advancement: adv,
  });
  return next;
}
