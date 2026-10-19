/* A 12-team league for the weekly-recap preview, six weeks played and Week 7 freshly
 * dealt - the screen a manager actually opens on a Tuesday morning.
 *
 * Built from the engine the same way src/storage/demoLeague.js builds the six-team demo,
 * but in the browser and with nothing persisted. It exists so the recap pop-up has the
 * real My Team, Week and League screens behind it. Its numbers are random and do NOT
 * match the words in recapExamples.js, which are written by hand.
 */

import {
  createDefaultState,
  dealRosters,
  emptyCumulative,
  finalizeCurrentPeriod,
  processSchemes,
  seededRng,
} from "../engine/index.js";

export const PREVIEW_TEAMS = [
  "Gridiron Gangsters",
  "Pocket Aces",
  "Hail Mary Poppins",
  "Dead Man's Hand",
  "Fantasy Island Boys",
  "Full House Flyers",
  "All-In Antlers",
  "Mahomes Alone",
  "Royal Flush Runners",
  "Sofa King Good",
  "Tua Legit Tua Quit",
  "Couch Cowboys",
];

export const previewTeamId = (i) => "preview_team_" + (i + 1);

function deal(state, ids, seed) {
  const res = dealRosters(state, ids, seededRng(seed));
  if (res.error) throw new Error("recap preview: deal failed - " + res.error);
  Object.entries(res.rosters).forEach(([id, roster]) => {
    state.teams.find((t) => t.id === id).roster = roster;
  });
  state.currentPeriod.phase = "dealt";
  return state;
}

function enterStats(state, ids, seed) {
  const rng = seededRng(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  ids.forEach((id) => {
    const team = state.teams.find((t) => t.id === id);
    const entry = {};
    ["Coach", "QB", "WR", "RB", "TE", "FLEX"].forEach((slot) => {
      const player = state.playerPool.find((p) => p.id === team.roster.starters[slot]);
      if (!player) return;
      if (player.position === "Coach") entry[slot] = { result: pick(["Win", "Win", "Loss", "Tie"]) };
      else if (player.position === "QB") entry[slot] = { yards: String(160 + Math.floor(rng() * 200)), tds: String(Math.floor(rng() * 4)) };
      else entry[slot] = { yards: String(Math.floor(rng() * 140)), tds: String(Math.floor(rng() * 3)) };
    });
    state.statsEntry[id] = entry;
  });
  return state;
}

export function createPreviewLeague() {
  let state = createDefaultState();
  state.leagueName = "Ball So Hard League";
  state.teams = PREVIEW_TEAMS.map((name, i) => ({
    id: previewTeamId(i),
    name,
    roster: null,
    cumulative: emptyCumulative(),
    playoffCumulative: emptyCumulative(),
  }));
  const ids = state.teams.map((t) => t.id);

  for (let week = 1; week <= 6; week++) {
    state = deal(state, ids, 4100 + week);
    state = processSchemes(state, seededRng(5100 + week));
    state.currentPeriod.phase = "stats";
    state.rosterLocked = true;
    state = enterStats(state, ids, 6100 + week);
    const done = finalizeCurrentPeriod(state, seededRng(7100 + week));
    if (done.error) throw new Error("recap preview: finalize failed - " + done.error);
    state = done.state;
  }

  /* Week 7, Tuesday morning: a brand new roster and nothing submitted yet. */
  return deal(state, ids, 4107);
}
