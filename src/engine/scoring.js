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
 */

import { standingsPointsArray } from "./helpers.js";
import { DEFAULT_SCORING, STAT_CATEGORIES } from "./constants.js";

const num = (x) => Number(x) || 0;

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
    /* Each category converts on its own and floors on its own - they have to, because
     * the rates differ and yards at 1:25 cannot be added to yards at 1:10 before
     * dividing. A consequence worth knowing: 15 rushing plus 15 receiving yards scores
     * 1 + 1 rather than 3, where the old single box would have taken 30 and scored 3. */
    let pts = 0;
    STAT_CATEGORIES.forEach((c) => {
      const v = num(statLine[c.field]);
      if (c.kind === "yards") pts += Math.floor(v / rate(cfg, c.rate));
      else pts += v * tdValue(cfg, c.rate);
    });
    return pts;
  }

  /* Legacy - the artifact's rule, for lines recorded before the split. Frozen. */
  const yards = num(statLine.yards);
  const tds = num(statLine.tds);
  const n = cfg.yardsPerPoint > 0 ? cfg.yardsPerPoint : 10;
  return Math.floor(yards / n) + tds * cfg.pointsPerTD;
}

export function currentStandingsPointsArray(state, teamCount) {
  if (state.standingsPointsOverride && state.standingsPointsOverride.length >= teamCount) {
    return state.standingsPointsOverride;
  }
  return standingsPointsArray(teamCount);
}
