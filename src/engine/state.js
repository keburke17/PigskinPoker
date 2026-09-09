/* Pigskin Poker - canonical state shape and roster/team lookups.
 * Moved verbatim from PigskinPokerCode.jsx lines 402-472.
 *
 * NOTE ON schemaVersion: still 1, and still the shape the artifact wrote, because
 * Phase 1 deliberately changes no data. Phase 2 introduces the migration chain that
 * reads it (fixes P4). Do not bump this without writing the migration.
 */

import { generatePlayerPool } from "./pool.js";
import { DEFAULT_SCORING, POSITIONS } from "./constants.js";
import { deepClone } from "./helpers.js";

export function createDefaultState() {
  return {
    schemaVersion: 1,
    leagueName: "Pigskin Poker",
    commissionerCode: null,
    teams: [], // {id, name, joinCode, roster:{starters,bench}, cumulative, playoffCumulative}
    playerPool: generatePlayerPool(),
    scoringConfig: deepClone(DEFAULT_SCORING),
    standingsPointsOverride: null, // DEAD since OQ-13 - kept for parity, read by nothing
    currentPeriod: { type: "week", number: 1, phase: "pre-deal" },
    // phase: pre-deal | dealt | schemes-processed | stats | finalized
    schemes: {}, // teamId -> {type:'block'|'steal'|'redraw'|'noaction', position, playerId, submittedAt}
    rosterLocked: false,
    lockedPlayerIds: {}, // playerId -> true (this period)
    statsEntry: {}, // teamId -> { Coach:{result}, QB:{yards,tds}, ... }
    weeklyResults: [], // {id, period, periodLabel, teamId, rank, rawScore, standingsPoints, ...}
    activityLog: [], // {id, period, periodLabel, ts, type, text}
    playoffConfig: {
      bracketSize: 4,
      advancement: [4, 2, 1],
      /* The NFL week the playoffs take over from the regular season, or null for a
       * league that has not set one. Added 2026-09-07 (OQ-16): the bracket now starts
       * itself when that week comes round, so the season does not depend on somebody
       * pressing a button between the last week ending and the next one being dealt.
       *
       * NULL MEANS "NEVER", NOT "SOON". There is no manual start any more, so a league
       * that leaves this unset plays regular weeks until the schedule runs out - which
       * is why the setup screen asks for it and the Playoffs panel says so plainly. */
      startNflWeek: null,
      started: false,
      completed: false,
      currentRoundIndex: 0,
      activeTeamIds: [],
      champion: null,
    },
  };
}

/* ---- roster/team helpers ---- */

export function allRosteredPlayerIds(state) {
  const set = new Set();
  state.teams.forEach((t) => {
    const r = t.roster;
    if (!r) return;
    POSITIONS.concat(["FLEX"]).forEach((slot) => {
      if (r.starters[slot]) set.add(r.starters[slot]);
    });
    r.bench.forEach((id) => id && set.add(id));
  });
  return set;
}

export function getPlayer(state, id) {
  if (!id) return null;
  return state.playerPool.find((p) => p.id === id) || null;
}

export function teamRosterPlayerIds(team) {
  if (!team.roster) return [];
  const ids = [];
  POSITIONS.concat(["FLEX"]).forEach((slot) => {
    if (team.roster.starters[slot]) ids.push(team.roster.starters[slot]);
  });
  team.roster.bench.forEach((id) => id && ids.push(id));
  return ids;
}

export function findTeamHoldingPlayer(state, playerId) {
  return state.teams.find((t) => teamRosterPlayerIds(t).includes(playerId)) || null;
}

export function slotForPlayer(team, playerId) {
  const r = team.roster;
  for (const slot of POSITIONS.concat(["FLEX"])) {
    if (r.starters[slot] === playerId) return { area: "starters", slot };
  }
  const benchIdx = r.bench.indexOf(playerId);
  if (benchIdx >= 0) return { area: "bench", index: benchIdx };
  return null;
}
