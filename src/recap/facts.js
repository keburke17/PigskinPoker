/* Pigskin Poker - the plain facts of one team's finished week, for its recap.
 *
 * Read off the league exactly as finalize sees it, so the recap and the standings can
 * never disagree:
 *   - starters are scored with the SAME function finalize uses, from the same stat lines;
 *   - bench players, and players who changed hands, from the stats pull's feed line
 *     (`_meta.playerWeeks`) - the grey numbers on the roster screen;
 *   - the standings from `standingsThrough`, the Week screen's own arithmetic;
 *   - what the schemes did from the moves recorded when they ran (moves.js).
 *
 * UNKNOWN IS NOT ZERO. A league whose commissioner types the stats in has no feed line for
 * the bench, and a bench player with no line has not scored nothing - nobody knows. Such
 * points come back null, and the writer leaves out any joke that would need them.
 */

import {
  computeStarterPoints,
  getPlayer,
  playerInjury,
  playerWeekLine,
  roundPoints,
  standingsThrough,
} from "../engine/index.js";

const SLOTS = ["Coach", "QB", "WR", "RB", "TE", "FLEX"];

/* "241 pass yds, 2 TD" - what a card says when its jokes have run out. */
function statText(line) {
  if (!line) return "Did not play";
  if (line.result) return line.result;
  const yds = [["passYards", "pass"], ["rushYards", "rush"], ["recYards", "rec"]]
    .filter(([k]) => Number(line[k]) > 0)
    .map(([k, w]) => line[k] + " " + w + " yds");
  const tds = ["passTds", "rushTds", "recTds"].reduce((n, k) => n + (Number(line[k]) || 0), 0);
  const legacy = !yds.length && Number(line.yards) > 0 ? [line.yards + " yds"] : [];
  const legacyTds = !tds && Number(line.tds) > 0 ? Number(line.tds) : tds;
  return yds.concat(legacy, legacyTds ? [legacyTds + " TD"] : []).join(", ") || "No stats";
}

/* Where a player is starting this week, if anywhere: { team, slot }. */
function startingSlot(state, playerId) {
  if (!playerId) return null;
  for (const t of state.teams) {
    if (!t.roster) continue;
    const slot = SLOTS.find((s) => t.roster.starters[s] === playerId);
    if (slot) return { team: t, slot };
  }
  return null;
}

/* A player's points this week and the line behind them, or pts null when unknown. A
 * starter's come from his team's stat line - the number that counted, corrections and
 * all; anyone else's from the feed. */
function scoreOf(state, playerId) {
  const player = getPlayer(state, playerId);
  if (!player) return null;
  const at = startingSlot(state, playerId);
  if (at) {
    const line = (state.statsEntry && state.statsEntry[at.team.id] && state.statsEntry[at.team.id][at.slot]) || null;
    return { name: player.name, pos: player.position, pts: computeStarterPoints(state, line, player.position), line };
  }
  const line = playerWeekLine(state, player);
  return { name: player.name, pos: player.position, pts: line ? computeStarterPoints(state, line, player.position) : null, line };
}

/**
 * @param before   the league as finalize found it - this week's rosters, stats and _meta
 * @param after    the state finalize produced - its weeklyResults hold this week's result
 * @param moves    schemeMoves() recorded for this period, or null when none were
 * @param teamId   whose week
 * @returns facts, or null when the team has no result this week (no roster, not playing)
 */
export function gatherFacts(before, after, moves, teamId) {
  const period = before.currentPeriod;
  const results = (after.weeklyResults || [])
    .filter((r) => r.period && r.period.type === period.type && r.period.number === period.number)
    .sort((a, b) => a.rank - b.rank);
  const mine = results.find((r) => r.teamId === teamId);
  const team = before.teams.find((t) => t.id === teamId);
  if (!mine || !team || !team.roster) return null;

  const starters = SLOTS.map((slot) => {
    const pid = team.roster.starters[slot];
    const s = pid ? scoreOf(before, pid) : null;
    return s ? { id: pid, slot, ...s, statText: statText(s.line) } : null;
  }).filter(Boolean);
  const bench = team.roster.bench.map((pid) => {
    const s = pid ? scoreOf(before, pid) : null;
    return s ? { id: pid, ...s } : null;
  }).filter(Boolean);

  /* The best single bench-for-starter swap the lineup rules allow, among known points. */
  let swap = null;
  bench.forEach((b) => {
    if (b.pts == null) return;
    starters.forEach((s) => {
      const fits = s.slot === b.pos || (s.slot === "FLEX" && (b.pos === "WR" || b.pos === "RB"));
      if (!fits) return;
      const gain = roundPoints(b.pts - s.pts);
      if (gain > 0 && (!swap || gain > swap.gain)) swap = { bench: b, starter: s, gain };
    });
  });
  if (swap) {
    const better = roundPoints(mine.rawScore + swap.gain);
    swap.wouldPlace = 1 + results.filter((r) => r.teamId !== teamId && r.rawScore > better).length;
  }
  const benchKnown = bench.length > 0 && bench.every((b) => b.pts != null);

  const nameOf = (id) => (before.teams.find((t) => t.id === id) || {}).name || null;
  const placeOf = (id) => (results.find((r) => r.teamId === id) || {}).rank || null;

  /* This team's scheme, from the recorded moves. No move means No Action - but only when
   * moves WERE recorded (`moves` is an array); null means nobody knows, and the recap
   * then says nothing about schemes rather than accuse a team of sitting one out. */
  const move = (moves || []).find((m) => m.teamId === teamId) || null;
  let scheme = { type: moves ? "none" : "unrecorded" };
  if (move && move.type === "block") {
    const p = scoreOf(before, move.playerId);
    scheme = p ? { type: "block", player: p, attempts: move.attempts || 0 } : scheme;
  } else if (move && (move.type === "steal" || move.type === "redraw")) {
    const dropped = scoreOf(before, move.playerId);
    const got = move.gotId ? scoreOf(before, move.gotId) : null;
    const landed = startingSlot(before, move.playerId);
    scheme = {
      type: move.type,
      position: move.position,
      skipped: !!move.skipped,
      dropped,
      got,
      fromName: move.fromTeamId ? nameOf(move.fromTeamId) : null,
      fromPlace: move.fromTeamId ? placeOf(move.fromTeamId) : null,
      droppedLanded: landed && landed.team.id !== teamId ? landed.team.name : null,
    };
  }

  /* Did someone steal one of ours? */
  let robbed = null;
  (moves || []).forEach((m) => {
    if (m.type !== "steal" || m.fromTeamId !== teamId || !m.gotId) return;
    const p = scoreOf(before, m.gotId);
    if (p && p.pts != null && (!robbed || p.pts > robbed.pts)) {
      robbed = { name: p.name, pos: p.pos, pts: p.pts, thief: nameOf(m.teamId), thiefPlace: placeOf(m.teamId) };
    }
  });

  /* Starters the injury report had as Questionable or Doubtful this week. */
  const hurt = starters
    .map((s) => ({ s, report: playerInjury(before, getPlayer(before, s.id)) }))
    .filter(({ report }) => report && !report.lastWeek && (report.status === "Questionable" || report.status === "Doubtful"))
    .map(({ s, report }) => ({ ...s, tag: report.status }));

  const prev = period.number > 1 ? standingsThrough(after.weeklyResults, { type: "week", number: period.number - 1 }) : [];
  const now = standingsThrough(after.weeklyResults, period);
  const rankNow = (now.find((r) => r.teamId === teamId) || {}).rank || null;
  const rankBefore = (prev.find((r) => r.teamId === teamId) || {}).rank || rankNow;

  /* Neighbours by position in the finished order, not rank arithmetic - a dead heat on
   * every tiebreaker shares a rank and leaves a gap in the numbers. */
  const at = results.indexOf(mine);
  const above = results[at - 1] || null;
  const below = results[at + 1] || null;
  const coach = starters.find((s) => s.pos === "Coach");
  const scorers = starters.filter((s) => s.pos !== "Coach").sort((a, b) => b.pts - a.pts);
  const history = (after.weeklyResults || [])
    .filter((r) => r.teamId === teamId && r.period && r.period.type === "week" && r.period.number <= period.number)
    .sort((a, b) => a.period.number - b.period.number)
    .map((r) => r.rank);

  return {
    week: period.number,
    teamId,
    team: team.name,
    history,
    place: mine.rank,
    of: results.length,
    score: mine.rawScore,
    points: mine.standingsPoints,
    rankNow,
    rankMove: rankBefore - rankNow,
    above: above ? { name: above.teamName, gap: roundPoints(above.rawScore - mine.rawScore) } : null,
    below: below ? { name: below.teamName, gap: roundPoints(mine.rawScore - below.rawScore) } : null,
    winner: { name: results[0].teamName, score: results[0].rawScore },
    last: { name: results[results.length - 1].teamName, score: results[results.length - 1].rawScore },
    best: scorers[0] || null,
    worst: scorers[scorers.length - 1] || null,
    coach: coach ? { name: coach.name, result: coach.line ? coach.line.result : null, pts: coach.pts } : null,
    benchTotal: benchKnown ? roundPoints(bench.reduce((n, b) => n + b.pts, 0)) : null,
    swap,
    scheme,
    robbed,
    hurt,
  };
}
