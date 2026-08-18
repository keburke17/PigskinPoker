/* A populated demo league, built deterministically from the engine.
 *
 * Purpose: `npm run dev` gives anyone a working, populated app in one step, with
 * standings, results, an activity feed and a week in progress - no Supabase, no
 * production data, no setup. Reproducible bug reports matter more than variety here,
 * so every deal is seeded and identical on every run.
 *
 * ============================ DEVELOPMENT CREDENTIALS ============================
 * These are OBVIOUSLY-FAKE local-only credentials. They are seeded into the in-memory
 * store, which never touches a network. They must never appear in a real league.
 *
 *   Commissioner: DEMO-COMMISH
 *   Managers:     DEMO-TEAM-1 .. DEMO-TEAM-6
 *
 * Phase 2 adds supabase/seed.sql for the local Postgres stack, built from this same
 * definition so the two cannot drift, and refusing to run against a non-local database.
 * ================================================================================
 */

import {
  createDefaultState,
  dealRosters,
  emptyCumulative,
  finalizeCurrentPeriod,
  processSchemes,
  seededRng,
} from "../engine/index.js";

export const DEMO_COMMISSIONER_CODE = "DEMO-COMMISH";
export const DEMO_TEAM_CODE_PREFIX = "DEMO-TEAM-";

const TEAM_NAMES = [
  "Gridiron Gamblers",
  "Full House Flyers",
  "Royal Flush Runners",
  "Pocket Aces",
  "Dead Man's Hand",
  "All-In Antlers",
];

/** Fixed seeds - change these and the demo league changes. That is the only knob. */
const SEED = { week1Deal: 20260817, week1Schemes: 5150, week1Final: 777, week2Deal: 31337 };

const teamId = (i) => "demo_team_" + (i + 1);

function makeTeams() {
  return TEAM_NAMES.map((name, i) => ({
    id: teamId(i),
    name,
    joinCode: DEMO_TEAM_CODE_PREFIX + (i + 1),
    roster: null,
    cumulative: emptyCumulative(),
    playoffCumulative: emptyCumulative(),
  }));
}

function applyDeal(state, ids, seed) {
  const res = dealRosters(state, ids, seededRng(seed));
  if (res.error) throw new Error("demo league: deal failed - " + res.error);
  Object.entries(res.rosters).forEach(([id, roster]) => {
    state.teams.find((t) => t.id === id).roster = roster;
  });
  state.currentPeriod.phase = "dealt";
  return state;
}

/** Plausible, deterministic stat lines. */
function enterStats(state, ids, seed) {
  const rng = seededRng(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  ids.forEach((id) => {
    const team = state.teams.find((t) => t.id === id);
    if (!team || !team.roster) return;
    const entry = {};
    ["Coach", "QB", "WR", "RB", "TE", "FLEX"].forEach((slot) => {
      const pid = team.roster.starters[slot];
      const player = state.playerPool.find((p) => p.id === pid);
      if (!player) return;
      if (player.position === "Coach") {
        entry[slot] = { result: pick(["Win", "Win", "Loss", "Tie"]) };
      } else if (player.position === "QB") {
        entry[slot] = { yards: String(180 + Math.floor(rng() * 180)), tds: String(Math.floor(rng() * 4)) };
      } else {
        entry[slot] = { yards: String(Math.floor(rng() * 130)), tds: String(Math.floor(rng() * 3)) };
      }
    });
    state.statsEntry[id] = entry;
  });
  return state;
}

/**
 * Builds the demo league:
 *   - Week 1 played all the way through and FINALIZED (standings + results have data)
 *   - Week 2 dealt, schemes submitted and processed, some stats entered (phase 'stats')
 */
export function createDemoLeague() {
  let state = createDefaultState();
  state.leagueName = "Pigskin Poker (Demo League)";
  state.commissionerCode = DEMO_COMMISSIONER_CODE;
  state.teams = makeTeams();
  const ids = state.teams.map((t) => t.id);

  /* ---- Week 1: deal -> schemes -> stats -> finalize ---- */
  state = applyDeal(state, ids, SEED.week1Deal);
  const starter = (id, slot) => state.teams.find((t) => t.id === id).roster.starters[slot];
  state.schemes = {
    [teamId(0)]: { type: "block", position: "QB", playerId: starter(teamId(0), "QB"), submittedAt: "2026-09-07T15:00:00.000Z" },
    [teamId(1)]: { type: "steal", position: "QB", playerId: starter(teamId(1), "QB"), submittedAt: "2026-09-07T15:04:00.000Z" },
    [teamId(2)]: { type: "redraw", position: "WR", playerId: starter(teamId(2), "WR"), submittedAt: "2026-09-07T15:11:00.000Z" },
    [teamId(3)]: { type: "noaction", position: null, playerId: null, submittedAt: "2026-09-07T15:20:00.000Z" },
    [teamId(4)]: { type: "steal", position: "TE", playerId: starter(teamId(4), "TE"), submittedAt: "2026-09-07T15:22:00.000Z" },
  };
  state = processSchemes(state, seededRng(SEED.week1Schemes));
  state.currentPeriod.phase = "schemes-processed";
  state.rosterLocked = true;
  state = enterStats(state, ids, SEED.week1Final);
  const finalized = finalizeCurrentPeriod(state, seededRng(SEED.week1Final));
  if (finalized.error) throw new Error("demo league: finalize failed - " + finalized.error);
  state = finalized.state; // now Week 2, phase 'pre-deal', rosters wiped

  /* ---- Week 2: dealt, schemes submitted and processed, stats part-entered ---- */
  state = applyDeal(state, ids, SEED.week2Deal);
  const s2 = (id, slot) => state.teams.find((t) => t.id === id).roster.starters[slot];
  state.schemes = {
    [teamId(0)]: { type: "redraw", position: "RB", playerId: s2(teamId(0), "RB"), submittedAt: "2026-09-14T14:30:00.000Z" },
    [teamId(2)]: { type: "block", position: "WR", playerId: s2(teamId(2), "WR"), submittedAt: "2026-09-14T14:41:00.000Z" },
    [teamId(5)]: { type: "steal", position: "QB", playerId: s2(teamId(5), "QB"), submittedAt: "2026-09-14T14:55:00.000Z" },
  };
  state = processSchemes(state, seededRng(SEED.week2Deal + 1));
  state.currentPeriod.phase = "stats";
  state.rosterLocked = true;
  // Only the first three teams have stats in - the commissioner is mid-entry, which is
  // the state the app is actually in on a Sunday afternoon.
  state = enterStats(state, ids.slice(0, 3), SEED.week2Deal + 2);

  return state;
}
