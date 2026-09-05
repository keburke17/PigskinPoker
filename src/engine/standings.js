/* Pigskin Poker - ranking, tiebreaks, and period finalization.
 * Moved from PigskinPokerCode.jsx lines 683-834, with `rng` threaded through the uid()
 * calls. Behaviour is otherwise identical.
 */

import { defaultRng } from "./rng.js";
import { deepClone, emptyCumulative, nowStamp, periodLabel, uid } from "./helpers.js";
import { getPlayer } from "./state.js";
import { computeStarterPoints, currentStandingsPointsArray, statLineTotals } from "./scoring.js";
import { ICON, STARTER_SLOTS } from "./constants.js";

/**
 * Generic ranking with tiebreakers.
 * rows: [{teamId, rawScore, tb:[standingsPts, weekWins, coachWins, tds, yards, bestPlayerPts]}]
 *
 * !! KNOWN DEFECT - OQ-A (docs/OPEN-QUESTIONS.md). DO NOT "FIX" THIS. !!
 * The loop below runs `i < 5` over a SIX-element tb array, so the sixth documented
 * tiebreaker (best single-player score) never breaks a tie - while the rank-grouping
 * check three lines further down compares all six via .every(). Two teams level on the
 * first five but differing on the sixth therefore sort arbitrarily (comparator returns
 * 0, stable sort keeps input order) yet receive DIFFERENT ranks, and so different
 * standings points. The beneficiary is whichever team was created first.
 *
 * This is preserved deliberately: it is the original designer's rule set and a live
 * league. It is held for a future change made with him. See tests/standings.test.js,
 * which asserts this behaviour on purpose and carries the skipped test for the fix.
 */
export function rankTeamsWithTiebreak(rows) {
  const sorted = rows.slice().sort((a, b) => {
    if (b.rawScore !== a.rawScore) return b.rawScore - a.rawScore;
    for (let i = 0; i < 5; i++) {
      const av = a.tb[i] || 0,
        bv = b.tb[i] || 0;
      if (bv !== av) return bv - av;
    }
    return 0;
  });
  // standard competition ranking (1224): ties (identical rawScore AND identical tb) share rank
  const ranked = [];
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const same = prev.rawScore === cur.rawScore && prev.tb.every((v, idx) => v === cur.tb[idx]);
      if (!same) rank = i + 1;
    }
    ranked.push(Object.assign({}, sorted[i], { rank }));
  }
  return ranked;
}

/**
 * Which teams are playing the period that is currently open. The regular season is
 * everybody; a playoff round is only the teams still in the bracket.
 */
export function periodTeams(state) {
  const period = state.currentPeriod;
  const activeIds = period.type === "playoff"
    ? state.playoffConfig.activeTeamIds
    : state.teams.map((t) => t.id);
  return state.teams.filter((t) => activeIds.includes(t.id));
}

/** One team's score for the period that is currently open, from the stat lines entered
 *  so far. A slot with no line scores zero, which is exactly what it will score if the
 *  week finalizes with the line still missing. */
export function teamPeriodScore(state, team) {
  if (!team || !team.roster) return 0;
  const stats = (state.statsEntry && state.statsEntry[team.id]) || {};
  let total = 0;
  STARTER_SLOTS.forEach((slot) => {
    const player = getPlayer(state, team.roster.starters[slot]);
    total += computeStarterPoints(state, stats[slot], player ? player.position : slot);
  });
  return total;
}

/**
 * Every playing team's row for the open period: this period's score and totals, plus the
 * season-to-date `tb` array that rankTeamsWithTiebreak reads.
 *
 * WHY THIS IS ITS OWN FUNCTION. It was the first half of finalizeCurrentPeriod, and it is
 * lifted out so the live scoreboard can show the week WITHOUT a second implementation of
 * "what has this team scored". A dashboard that added the numbers up its own way could
 * disagree with the finalize that follows it, and the disagreement would only surface at
 * the moment the week became permanent. Finalize still calls this; the two cannot drift.
 *
 * Read-only. It clones nothing and mutates nothing, so a live view can call it on every
 * render without touching the league.
 */
export function periodScoreRows(state) {
  const isPlayoff = state.currentPeriod.type === "playoff";
  return periodTeams(state).map((team) => {
    const stats = (state.statsEntry && state.statsEntry[team.id]) || {};
    const cum = isPlayoff
      ? team.playoffCumulative || emptyCumulative()
      : team.cumulative || emptyCumulative();
    let rawScore = 0,
      tds = 0,
      yards = 0,
      coachResult = null,
      bestThisPeriod = null;
    STARTER_SLOTS.forEach((slot) => {
      const playerId = team.roster ? team.roster.starters[slot] : null;
      const player = getPlayer(state, playerId);
      const line = stats[slot];
      const pts = computeStarterPoints(state, line, player ? player.position : slot);
      rawScore += pts;
      if (player && player.position === "Coach") {
        coachResult = line ? line.result : null;
      } else if (line) {
        /* Combined across every category, so the "Total TDs" and "Total Yards"
         * tiebreakers keep the meaning they had before the 2026-08-28 split. */
        const totals = statLineTotals(line);
        tds += totals.tds;
        yards += totals.yards;
      }
      if (player && (!bestThisPeriod || pts > bestThisPeriod.points)) {
        bestThisPeriod = { name: player.name, position: player.position, points: pts };
      }
    });
    return {
      teamId: team.id,
      teamName: team.name,
      rawScore,
      tds,
      yards,
      coachResult,
      bestThisPeriod,
      tb: [
        cum.standingsPoints,
        cum.weekWins,
        cum.coachWins,
        cum.totalTDs,
        cum.totalYards,
        cum.bestPlayer ? cum.bestPlayer.points : 0,
      ],
    };
  });
}

/**
 * The open period as it stands right now, ranked the way finalize will rank it.
 *
 * This is the live scoreboard's data, and it is deliberately the same three calls
 * finalize makes - periodScoreRows, rankTeamsWithTiebreak, currentStandingsPointsArray -
 * in the same order, so what the screen shows mid-week is what the week will actually
 * award. `standingsPoints` on each row is therefore a PROJECTION and nothing more: only
 * finalizeCurrentPeriod ever writes a team's cumulative totals, and this function does
 * not call it.
 *
 * The rows come back in ranked order, untouched. Do not re-sort them: ties that
 * rankTeamsWithTiebreak leaves in input order are OQ-A (see the comment on that
 * function), and re-sorting here would quietly show a different order from the one the
 * week is going to be scored in.
 */
export function projectCurrentPeriod(state) {
  const rows = periodScoreRows(state);
  if (rows.length === 0) return { rows: [] };
  const spArr = currentStandingsPointsArray(state, rows.length);
  return {
    rows: rankTeamsWithTiebreak(rows).map((r) =>
      Object.assign({}, r, {
        standingsPoints: spArr[r.rank - 1] != null ? spArr[r.rank - 1] : 1,
      })
    ),
  };
}

export function finalizeCurrentPeriod(state, rng = defaultRng) {
  const next = deepClone(state);
  const period = next.currentPeriod;
  const isPlayoff = period.type === "playoff";
  const teams = periodTeams(next);
  if (teams.length === 0) {
    return { error: "No teams to finalize for this period." };
  }

  const rows = periodScoreRows(next);

  const ranked = rankTeamsWithTiebreak(rows);
  const spArr = currentStandingsPointsArray(next, teams.length);
  const topRank = 1;
  const resultsThisPeriod = [];

  ranked.forEach((r) => {
    const team = next.teams.find((t) => t.id === r.teamId);
    const standingsPoints = spArr[r.rank - 1] != null ? spArr[r.rank - 1] : 1;
    const isWeekWin = r.rank === topRank;
    const cumKey = isPlayoff ? "playoffCumulative" : "cumulative";
    if (!team[cumKey]) team[cumKey] = emptyCumulative();
    const cum = team[cumKey];
    cum.standingsPoints += standingsPoints;
    if (isWeekWin) cum.weekWins += 1;
    if (r.coachResult === "Win") cum.coachWins += 1;
    cum.totalTDs += r.tds;
    cum.totalYards += r.yards;
    if (r.bestThisPeriod && (!cum.bestPlayer || r.bestThisPeriod.points > cum.bestPlayer.points)) {
      cum.bestPlayer = {
        name: r.bestThisPeriod.name,
        position: r.bestThisPeriod.position,
        points: r.bestThisPeriod.points,
        periodLabel: periodLabel(period),
      };
    }
    const resultEntry = {
      id: uid("res", rng),
      period: Object.assign({}, period),
      periodLabel: periodLabel(period),
      teamId: team.id,
      teamName: team.name,
      rank: r.rank,
      rawScore: r.rawScore,
      standingsPoints,
      coachResult: r.coachResult,
      tds: r.tds,
      yards: r.yards,
      bestPlayer: r.bestThisPeriod,
    };
    resultsThisPeriod.push(resultEntry);
    next.weeklyResults.push(resultEntry);
  });

  const winner = resultsThisPeriod.find((r) => r.rank === 1);
  next.activityLog.push({
    id: uid("act", rng),
    period: Object.assign({}, period),
    periodLabel: periodLabel(period),
    ts: nowStamp(),
    type: "result",
    text:
      periodLabel(period) +
      " final - " +
      resultsThisPeriod
        .slice()
        .sort((a, b) => a.rank - b.rank)
        .map((r) => "#" + r.rank + " " + r.teamName + " (" + r.rawScore + " pts)")
        .join(", ") +
      (winner ? ". Winner: " + winner.teamName + "!" : ""),
  });

  // Advance / reset for next period
  next.statsEntry = {};
  next.schemes = {};
  next.lockedPlayerIds = {};
  next.rosterLocked = false;
  // wipe rosters until the next deal so stale lineups can't be edited
  next.teams.forEach((t) => {
    t.roster = null;
  });

  if (isPlayoff) {
    const cfg = next.playoffConfig;
    const nextRoundSize = cfg.advancement[cfg.currentRoundIndex + 1];
    if (nextRoundSize == null || nextRoundSize <= 1) {
      // Down to a single team -> that team is champion. They never play a round alone.
      const champ = ranked.find((r) => r.rank === 1);
      cfg.completed = true;
      cfg.champion = champ ? champ.teamId : null;
      const champTeam = champ ? next.teams.find((t) => t.id === champ.teamId) : null;
      next.activityLog.push({
        id: uid("act", rng),
        period: Object.assign({}, period),
        periodLabel: periodLabel(period),
        ts: nowStamp(),
        type: "champion",
        text: champTeam
          ? ICON.trophy + " " + champTeam.name + " wins the Pigskin Poker championship!"
          : "Playoffs complete.",
      });
    } else {
      // take top nextRoundSize teams by rank (ties broken already by rankTeamsWithTiebreak)
      const orderedIds = ranked
        .slice()
        .sort((a, b) => a.rank - b.rank)
        .map((r) => r.teamId);
      const advancingIds = orderedIds.slice(0, nextRoundSize);
      cfg.activeTeamIds = advancingIds;
      cfg.currentRoundIndex += 1;
      next.currentPeriod = { type: "playoff", number: period.number + 1, phase: "pre-deal" };
      const advTeamNames = advancingIds
        .map((id) => (next.teams.find((t) => t.id === id) || {}).name)
        .join(", ");
      next.activityLog.push({
        id: uid("act", rng),
        period: next.currentPeriod,
        periodLabel: periodLabel(next.currentPeriod),
        ts: nowStamp(),
        type: "advance",
        text: "Advancing to " + periodLabel(next.currentPeriod) + ": " + advTeamNames + ".",
      });
    }
  } else {
    next.currentPeriod = { type: "week", number: period.number + 1, phase: "pre-deal" };
  }

  return { state: next };
}

export function seasonStandingsRows(state) {
  return state.teams.map((t) => {
    const cum = t.cumulative || emptyCumulative();
    return {
      teamId: t.id,
      teamName: t.name,
      rawScore: cum.standingsPoints,
      tb: [
        cum.standingsPoints,
        cum.weekWins,
        cum.coachWins,
        cum.totalTDs,
        cum.totalYards,
        cum.bestPlayer ? cum.bestPlayer.points : 0,
      ],
      cum,
    };
  });
}
