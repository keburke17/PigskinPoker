/* Pigskin Poker - what a player is scoring, whether or not he counts. OQ-28.
 *
 * Scott, 2026-10-16: "i would like to make it so you can see the point totals of the bench
 * players and the free agents as well ... the bench and FA totals obviously do not count
 * toward a teams score, just the starters do" - and an average on every player "to help
 * with sit start scheme advice".
 *
 * NOTHING HERE SCORES A WEEK. Finalize, the projection and the standings never call it.
 * It reads `state._meta.playerWeeks` - the feed's line for every pool player, every NFL
 * week, written by the stats pull into a table nothing else reads - and prices each line
 * with `computeStarterPoints`, the SAME function a starter is scored with, so a bench
 * player's grey 17.3 is exactly what he would have scored had he been in the lineup.
 *
 * AVERAGE BY GAMES PLAYED (Scott's choice, 2026-10-16). A week with no line - a bye, a
 * game he missed - is not a zero and does not count against him. That is why the pull
 * writes no row rather than a zero for a player absent from the file.
 *
 * FINISHED WEEKS ONLY. The current NFL week is left out of the average until the league
 * has finalized it: on a Sunday afternoon half his game has been played, and averaging a
 * half-game in would drag every number on the screen around while managers are looking at
 * it. The week's own points sit right beside the average anyway.
 */

import { computeStarterPoints, roundPoints } from "./scoring.js";

function weeksFor(state, playerId) {
  const all = state && state._meta && state._meta.playerWeeks;
  return (all && playerId != null && all[playerId]) || null;
}

function currentNflWeek(state) {
  const w = Number(state && state._meta ? state._meta.nflWeek : NaN);
  return Number.isFinite(w) ? w : null;
}

/**
 * The feed's points for this player in the league's current NFL week, or null when there
 * is no line for him (not played yet, a bye, or no pull has run).
 *
 * For a player who is NOT starting - a bench player or a free agent. A starter's points
 * come from his team's stat line, which a commissioner may have corrected by hand, and
 * that is the number that counts.
 */
export function playerWeekPoints(state, player) {
  const line = playerWeekLine(state, player);
  return line ? computeStarterPoints(state, line, player.position) : null;
}

/** The feed's stat line behind `playerWeekPoints`, for printing beside it. */
export function playerWeekLine(state, player) {
  if (!player) return null;
  const week = currentNflWeek(state);
  const weeks = weeksFor(state, player.id);
  return (week != null && weeks && weeks[week]) || null;
}

/**
 * Season average by games played, over finished weeks. Null when he has none yet.
 * @returns {{ avg: number, games: number } | null}
 */
export function playerSeasonAverage(state, player) {
  /* A head coach has no average (Scott, 2026-10-22): "1.1" on a coach means nothing to
   * anyone. His row shows his team's record instead - coachRecord, below. */
  if (!player || player.position === "Coach") return null;
  const weeks = weeksFor(state, player.id);
  if (!weeks) return null;

  const current = currentNflWeek(state);
  const phase = state.currentPeriod ? state.currentPeriod.phase : null;
  const lastFinished = current == null ? Infinity : phase === "finalized" ? current : current - 1;

  let total = 0;
  let games = 0;
  for (const [w, line] of Object.entries(weeks)) {
    if (Number(w) > lastFinished || !line) continue;
    total += computeStarterPoints(state, line, player.position);
    games += 1;
  }
  return games ? { avg: roundPoints(total / games), games } : null;
}

/**
 * A head coach's team record, from the same weekly results that score him 2 / 1 / 0.
 * Null when there are none yet.
 *
 * THE CURRENT WEEK COUNTS AS SOON AS ITS RESULT IS IN (Scott, 2026-10-22), unlike the
 * average above. A finished NFL game is final, so a Lions win on Sunday reads 6-1 that
 * night beside the 2.0 it earned, not on Tuesday after the finalize. There is no line
 * for a game that has not finished, so nothing half-played can creep in.
 * @returns {{ wins: number, losses: number, ties: number } | null}
 */
export function coachRecord(state, player) {
  if (!player || player.position !== "Coach") return null;
  const weeks = weeksFor(state, player.id);
  if (!weeks) return null;

  const current = currentNflWeek(state);
  const record = { wins: 0, losses: 0, ties: 0 };
  let games = 0;
  for (const [w, line] of Object.entries(weeks)) {
    if ((current != null && Number(w) > current) || !line) continue;
    if (line.result === "Win") record.wins += 1;
    else if (line.result === "Loss") record.losses += 1;
    else if (line.result === "Tie") record.ties += 1;
    else continue;
    games += 1;
  }
  return games ? record : null;
}

/** 5-1, or 5-1-1 when there has been a tie - the way a standings page writes it. */
export function recordText(record) {
  if (!record) return "";
  return record.wins + "-" + record.losses + (record.ties ? "-" + record.ties : "");
}
