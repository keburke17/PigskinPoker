/* Pigskin Poker - ranking, tiebreaks, and period finalization.
 * Moved from PigskinPokerCode.jsx lines 683-834, with `rng` threaded through the uid()
 * calls. Behaviour is otherwise identical.
 */

import { defaultRng } from "./rng.js";
import { deepClone, defaultAdvancement, emptyCumulative, nowStamp, periodLabel, uid } from "./helpers.js";
import { getPlayer } from "./state.js";
import { computeStarterPoints, currentStandingsPointsArray, roundPoints, statLineTotals } from "./scoring.js";
import { ICON, STARTER_SLOTS } from "./constants.js";

/**
 * Generic ranking with tiebreakers.
 * rows: [{teamId, rawScore, tb:[standingsPts, weekWins, coachWins, tds, yards, bestPlayerPts]}]
 *
 * All SIX tiebreakers apply, matching what the rules screen has always documented:
 *   Standings Points -> Week Wins -> Coach Wins -> Total TDs -> Total Yards ->
 *   Best single-player score in a week.
 *
 * OQ-A, ANSWERED 2026-09-06 by Scott: "yes that should be a 6th tiebreaker if at all
 * necessary." Until that answer this loop ran `i < 5` over a SIX-element tb array, so the
 * sixth tiebreaker never broke a tie - while the rank-grouping check below compared all
 * six via .every(). Two teams level on the first five but differing on the sixth sorted
 * arbitrarily (the comparator returned 0, and the stable sort kept input order) yet
 * received DIFFERENT ranks, and so different standings points - the beneficiary being
 * whichever team was created first. The bound is now `i < 6`, and the two agree.
 *
 * This is a real rules change, the second in the port. tests/parity.test.js records it;
 * see docs/OPEN-QUESTIONS.md.
 */
export function rankTeamsWithTiebreak(rows) {
  const sorted = rows.slice().sort((a, b) => {
    if (b.rawScore !== a.rawScore) return b.rawScore - a.rawScore;
    for (let i = 0; i < 6; i++) {
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
  /* Rounded again at the team boundary: twelve values that are each exact to one decimal
   * still sum to 40.99999999999999 often enough to matter on a scoreboard. */
  return roundPoints(total);
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
      /* Rounded at the team boundary for the same reason each player was: the column has
       * to add up by hand. Ranking compares these with !==, so they must be the settled
       * numbers rather than twelve accumulated fractions. */
      rawScore: roundPoints(rawScore),
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

/**
 * Which NFL week the period AFTER the current one will play.
 *
 * The engine does not own `nfl_week` - it is a server-owned column, handed to the browser
 * in `_meta` the same way kickoff times are, because the artifact's state shape has no
 * field for it and parity depends on that shape. So this reads the current week and adds
 * one, which is exactly what server/schedule.js's `nextNflWeek` does when a season
 * already has weeks mapped: the current period is the highest mapped, and the next one
 * follows it.
 *
 * Null when the league has no mapping yet. A league that cannot say which week of
 * football it is playing cannot be asked whether the playoffs are due, and the honest
 * answer to that is to keep playing regular weeks.
 */
export function nextPeriodNflWeek(state) {
  const cur = Number(state && state._meta ? state._meta.nflWeek : NaN);
  return Number.isFinite(cur) && cur > 0 ? cur + 1 : null;
}

/**
 * Have the playoffs come round?
 *
 * OQ-16, ANSWERED 2026-09-07 by Scott. The bracket used to wait on a Start Playoffs
 * button, and that button could not survive the weekly cycle running on a clock: a
 * league playing its last regular week 15 has its week 16 rosters dealt to EVERY team at
 * 6am on the Tuesday, hours before a commissioner is likely to be awake, and by then
 * teams with no business in the playoffs are holding lineups. Scott: "if the commish hit
 * start playoffs the rosters are already dealt, and multiple teams that are not in
 * playoff contention would have rosters. which shouldnt happen."
 *
 * SO THE DECISION MOVED TO FINALIZE rather than to the scheduler. It is asked at the
 * moment the previous week ends, whichever hand ended it - the clock at 6am Tuesday or
 * the commissioner on Monday night - so a league with automation switched off behaves
 * exactly the same way. Putting it in the scheduler instead would have left every manual
 * league with no way to reach the playoffs at all once the button was gone.
 *
 * THE WEEK IS AN NFL WEEK, NOT THE LEAGUE'S OWN COUNTER. Scott: "if the league selects to
 * have playoff start in week 16, that would be week 16 of the nfl season." A league that
 * joined in NFL week 3 calls that week 3, so the two counters differ and the football
 * calendar is the one that matters.
 *
 * @param {object} state  the league, after the previous period has been finalized
 * @param {number|null} nflWeek  the week the NEXT period would play
 */
export function playoffsDueToStart(state, nflWeek) {
  const cfg = state && state.playoffConfig;
  if (!cfg || cfg.started || cfg.completed) return false;
  const start = Number(cfg.startNflWeek);
  /* Unset is "never". See the note on startNflWeek in state.js - it is a real trap, and
   * it is guarded on screen rather than by guessing a week here. */
  if (!Number.isFinite(start) || start < 1) return false;
  if (nflWeek == null) return false;
  return nflWeek >= start;
}

/**
 * Seed the bracket into an ALREADY-CLONED state, in place.
 *
 * Lives in standings.js rather than in playoffs.js because both callers are here or
 * below it: `finalizeCurrentPeriod` starts the playoffs when the week comes round, and
 * `startPlayoffs` in playoffs.js is the thin clone-and-call wrapper the tests and the
 * parity harness still use. playoffs.js already imports this file; the reverse would be
 * a cycle.
 */
export function seedPlayoffBracket(next, bracketSize, advancement, rng = defaultRng) {
  const ranked = rankTeamsWithTiebreak(
    seasonStandingsRows(next).map((r) => ({ teamId: r.teamId, rawScore: r.rawScore, tb: r.tb }))
  );
  const orderedIds = ranked
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((r) => r.teamId);
  const bracketTeams = orderedIds.slice(0, bracketSize);
  next.teams.forEach((t) => {
    t.playoffCumulative = emptyCumulative();
  });
  next.playoffConfig = Object.assign({}, next.playoffConfig, {
    bracketSize,
    advancement,
    started: true,
    completed: false,
    currentRoundIndex: 0,
    activeTeamIds: bracketTeams,
    champion: null,
  });
  next.currentPeriod = { type: "playoff", number: 1, phase: "pre-deal" };
  next.schemes = {};
  next.statsEntry = {};
  next.lockedPlayerIds = {};
  next.rosterLocked = false;
  const names = bracketTeams.map((id) => (next.teams.find((t) => t.id === id) || {}).name).join(", ");
  next.activityLog.push({
    id: uid("act", rng),
    period: next.currentPeriod,
    periodLabel: periodLabel(next.currentPeriod),
    ts: nowStamp(),
    type: "playoffs-start",
    text:
      "Playoffs started! Regular-season standings are now frozen. Bracket (" +
      bracketTeams.length +
      "): " +
      names +
      ".",
  });
  return next;
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
  } else if (playoffsDueToStart(next, nextPeriodNflWeek(next))) {
    /* The last regular week has just been scored, and the next NFL week is the one the
     * league nominated for its playoffs. Seed the bracket INSTEAD of opening week N+1,
     * so no roster is ever dealt to a team that is out of it. Everything the bracket is
     * seeded from - standings points, week wins, the tiebreakers - was written a few
     * lines above, so the seeding reads the season complete. */
    const cfg = next.playoffConfig;
    const size = Math.max(1, Math.min(Number(cfg.bracketSize) || 1, next.teams.length));
    const adv = Array.isArray(cfg.advancement) && cfg.advancement.length
      ? cfg.advancement
      : defaultAdvancement(size);
    seedPlayoffBracket(next, size, adv, rng);
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
