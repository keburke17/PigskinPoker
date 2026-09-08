/* Pigskin Poker - scoring math.
 *
 * Moved verbatim from PigskinPokerCode.jsx lines 661-681, then split on 2026-08-28 by
 * the designer's decision on OQ-4c. Pure; no randomness.
 *
 * TWO PATHS, ON PURPOSE. A stat line entered from 2026-08-28 onwards carries yards and
 * touchdowns broken out as passing / rushing / receiving, and each category converts at
 * its own rate. A line recorded before that carries one combined `yards` and one `tds`,
 * and there is no way to split it after the fact - a total does not say how much of it
 * was passing. So those lines keep being scored the way they were entered.
 *
 * The legacy branch is frozen. Nothing written from now on reaches it; it exists for
 * historical rows and for tests/parity.test.js, which replays the artifact's own scoring
 * against it. Deleting it would mean rewriting the safety net around the rules change
 * instead of keeping it intact. See docs/PHASE-4-PLAN.md section 3.2.
 *
 * DECIMALS, 2026-09-07 (OQ-15). The split path no longer floors. Scott: "a player gets 5
 * rushing and 5 receiving, that should be 1 point ... if the player got 5 rushing and 6
 * receiving, it should read 1.1". Flooring each category separately threw those yards
 * away twice over - 5 and 5 at 1pt/10 scored NOTHING, because each half floored to zero
 * on its own - and closing that hole is the point. A yard now always counts for the
 * fraction of a point it is worth.
 *
 * ROUNDED TO ONE DECIMAL, ONCE, ON THE PLAYER'S TOTAL - one place rather than per
 * category, so a score is the same number however it was built up. One decimal because
 * that is how Scott reads a scoreboard, and because binary floating point cannot hold
 * 0.1 exactly: left alone, 5 rushing plus 6 receiving at 1pt/10 prints as
 * 1.1000000000000001.
 *
 * THE LEGACY BRANCH KEEPS FLOORING, deliberately. That is what "leave finished weeks
 * alone" (Scott, 2026-09-07) means in code: every line entered before the 2026-08-28
 * split scores exactly as it did, no finalized week moves, and tests/parity.test.js
 * still replays the artifact through it untouched.
 */

import { standingsPointsArray } from "./helpers.js";
import { DEFAULT_SCORING, STAT_CATEGORIES } from "./constants.js";

const num = (x) => Number(x) || 0;

/**
 * Points, to one decimal place.
 *
 * EVERY total the game shows or stores goes through here, because the alternative is
 * floating-point dust on a scoreboard: 0.1 + 0.2 is 0.30000000000000004 in JavaScript,
 * and a week of those is a column nobody can add up by hand. Rounding at each boundary -
 * the player, then the team - also keeps the parts adding up to the whole, which is the
 * first thing a commissioner does with a disputed week.
 *
 * The epsilon nudge pushes a value sitting a hair under the .05 line back onto it, so a
 * total that is mathematically 1.15 rounds to 1.2 rather than losing a tenth to a
 * representation error.
 */
export function roundPoints(n) {
  const v = Number(n) || 0;
  return Math.round((v + Number.EPSILON * Math.sign(v)) * 10) / 10;
}

/** A config value, falling back to the default when a stored config predates the split. */
function rate(cfg, key) {
  const v = Number(cfg && cfg[key]);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SCORING[key];
}

/** A per-TD value. Unlike a yards rate, zero is a legitimate setting. */
function tdValue(cfg, key) {
  const v = Number(cfg && cfg[key]);
  return Number.isFinite(v) ? v : DEFAULT_SCORING[key];
}

/** True when a line carries any of the split categories - which decides which path it
 * scores through. An all-blank line is not split; it scores zero either way. */
export function hasSplitStats(line) {
  if (!line) return false;
  return STAT_CATEGORIES.some((c) => {
    const v = line[c.field];
    return v != null && v !== "";
  });
}

/** Combined yards and TDs across every category, for the cumulative totals that the
 * standings tiebreakers use. Works on both line shapes, so "Total Yards" and "Total TDs"
 * keep meaning what they have always meant. */
export function statLineTotals(line) {
  if (!line) return { yards: 0, tds: 0 };
  if (!hasSplitStats(line)) {
    return { yards: num(line.yards), tds: num(line.tds) };
  }
  let yards = 0;
  let tds = 0;
  STAT_CATEGORIES.forEach((c) => {
    if (c.kind === "yards") yards += num(line[c.field]);
    else tds += num(line[c.field]);
  });
  return { yards, tds };
}

export function computeStarterPoints(state, statLine, position) {
  if (!statLine) return 0;
  const cfg = state.scoringConfig;
  if (position === "Coach") {
    if (statLine.result === "Win") return cfg.coachWin;
    if (statLine.result === "Tie") return cfg.coachTie;
    if (statLine.result === "Loss") return cfg.coachLoss;
    return 0;
  }

  if (hasSplitStats(statLine)) {
    /* Each category still converts at its own rate - yards at 1:25 cannot be added to
     * yards at 1:10 before dividing - but nothing floors any more. The categories are
     * summed as exact fractions and the PLAYER'S TOTAL is rounded once, so 15 rushing
     * plus 15 receiving is 1.5 + 1.5 = 3, where the floors used to give 1 + 1 = 2. */
    let pts = 0;
    STAT_CATEGORIES.forEach((c) => {
      const v = num(statLine[c.field]);
      if (c.kind === "yards") pts += v / rate(cfg, c.rate);
      else pts += v * tdValue(cfg, c.rate);
    });
    return roundPoints(pts);
  }

  /* Legacy - the artifact's rule, for lines recorded before the split. Frozen. */
  const yards = num(statLine.yards);
  const tds = num(statLine.tds);
  const n = cfg.yardsPerPoint > 0 ? cfg.yardsPerPoint : 10;
  return Math.floor(yards / n) + tds * cfg.pointsPerTD;
}

/**
 * The standings ladder every league plays: N teams, the winner of the week takes N and
 * each place below takes one fewer, down to 1 for last.
 *
 * IT IS NO LONGER A SETTING (OQ-13, issue #48, Kyle 2026-09-08). The artifact let a
 * commissioner type any ladder he liked, and `standingsPointsOverride` still carries one
 * through state and storage because the artifact's shape is pinned by parity - but
 * NOTHING READS IT any more, and the panel that wrote it is gone. A league that saved
 * one before today is back on the reverse ladder, which for every league that exists is
 * the ladder it was already playing: the default was never changed.
 *
 * `state` stays in the signature on purpose. Both callers pass it, and the day a
 * top-heavy season sounds fun the override is a one-line reinstatement here rather than
 * a change threaded back through finalize and the projection.
 */
export function currentStandingsPointsArray(state, teamCount) {
  return standingsPointsArray(teamCount);
}
