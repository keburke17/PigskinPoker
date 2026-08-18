/* Pigskin Poker - scoring math.
 * Moved verbatim from PigskinPokerCode.jsx lines 661-681. Pure; no randomness.
 */

import { standingsPointsArray } from "./helpers.js";

export function computeStarterPoints(state, statLine, position) {
  if (!statLine) return 0;
  const cfg = state.scoringConfig;
  if (position === "Coach") {
    if (statLine.result === "Win") return cfg.coachWin;
    if (statLine.result === "Tie") return cfg.coachTie;
    if (statLine.result === "Loss") return cfg.coachLoss;
    return 0;
  }
  const yards = Number(statLine.yards) || 0;
  const tds = Number(statLine.tds) || 0;
  const n = cfg.yardsPerPoint > 0 ? cfg.yardsPerPoint : 10;
  return Math.floor(yards / n) + tds * cfg.pointsPerTD;
}

export function currentStandingsPointsArray(state, teamCount) {
  if (state.standingsPointsOverride && state.standingsPointsOverride.length >= teamCount) {
    return state.standingsPointsOverride;
  }
  return standingsPointsArray(teamCount);
}
