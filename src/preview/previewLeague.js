/* A 12-team league for the weekly-recap preview, ten weeks played and Week 11 freshly
 * dealt - the screen a manager actually opens on a Tuesday morning.
 *
 * Built from the engine the same way src/storage/demoLeague.js builds the six-team demo,
 * but in the browser and with nothing persisted. Every week is dealt, schemed, scored and
 * finalized by the real engine, with random schemes and random stat lines.
 *
 * It also keeps what the free (template) recaps need for the last two weeks: the rosters
 * before and after schemes, every player's line - bench and free agents included, the way
 * the stats pull records them in `_meta.playerWeeks` - and an injury tag on a few players.
 * The hand-written samples in recapExamples.js do NOT come from here.
 */

import {
  createDefaultState,
  dealRosters,
  deepClone,
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

/** The weeks the free recaps are written for. */
export const RECAP_WEEKS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

function deal(state, ids, seed) {
  const res = dealRosters(state, ids, seededRng(seed));
  if (res.error) throw new Error("recap preview: deal failed - " + res.error);
  Object.entries(res.rosters).forEach(([id, roster]) => {
    state.teams.find((t) => t.id === id).roster = roster;
  });
  state.currentPeriod.phase = "dealt";
  return state;
}

/* One line per pool player, so the bench and free agents have points too. Roughly one in
 * twenty skilled players gets no line at all - inactive - which scores zero. */
function weekLines(state, seed) {
  const rng = seededRng(seed);
  const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const lines = {};
  state.playerPool.forEach((p) => {
    if (p.position === "Coach") {
      const r = rng();
      lines[p.id] = { result: r < 0.5 ? "Win" : r < 0.94 ? "Loss" : "Tie" };
      return;
    }
    if (rng() < 0.05) return;
    if (p.position === "QB") {
      lines[p.id] = { passYards: int(120, 360), passTds: int(0, 4), rushYards: rng() < 0.4 ? int(0, 50) : 0, rushTds: rng() < 0.1 ? 1 : 0 };
    } else if (p.position === "RB") {
      lines[p.id] = { rushYards: int(8, 140), rushTds: rng() < 0.45 ? int(1, 2) : 0, recYards: int(0, 45), recTds: rng() < 0.08 ? 1 : 0 };
    } else {
      lines[p.id] = { recYards: int(0, 140), recTds: rng() < 0.35 ? int(1, 2) : 0 };
    }
  });
  return lines;
}

/* A few starters carry an injury tag that week, as the injury report would show. */
function weekInjuries(state, seed) {
  const rng = seededRng(seed);
  const tags = {};
  state.teams.forEach((t) => {
    ["QB", "WR", "RB", "TE", "FLEX"].forEach((slot) => {
      if (rng() < 0.08) tags[t.roster.starters[slot]] = rng() < 0.7 ? "QUES" : "DOUBT";
    });
  });
  return tags;
}

/* A scheme for every team: mostly something, sometimes nothing. */
function randomSchemes(state, seed) {
  const rng = seededRng(seed);
  const schemes = {};
  state.teams.forEach((t) => {
    const r = rng();
    const pos = ["QB", "WR", "RB", "TE"][Math.floor(rng() * 4)];
    const pid = t.roster.starters[pos];
    if (r < 0.15) return;
    const type = r < 0.4 ? "block" : r < 0.75 ? "steal" : "redraw";
    schemes[t.id] = { type, position: pos, playerId: pid, submittedAt: "2026-10-01T15:00:00.000Z" };
  });
  return schemes;
}

/* `played` and `recapWeeks` exist so a whole simulated season can be run through the free
 * recap to measure how many lines it uses (the preview itself takes the defaults). */
export function createPreviewLeague({ played = 10, recapWeeks = RECAP_WEEKS, seed = 0 } = {}) {
  const salt = seed * 100000;
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
  const weeks = {};

  for (let week = 1; week <= played; week++) {
    state = deal(state, ids, salt + 4100 + week);
    state.schemes = randomSchemes(state, salt + 8100 + week);
    const beforeSchemes = deepClone(state);
    state = processSchemes(state, seededRng(salt + 5100 + week));
    state.currentPeriod.phase = "stats";
    state.rosterLocked = true;
    const lines = weekLines(state, salt + 6100 + week);
    state.teams.forEach((t) => {
      const entry = {};
      ["Coach", "QB", "WR", "RB", "TE", "FLEX"].forEach((slot) => {
        const line = lines[t.roster.starters[slot]];
        if (line) entry[slot] = line;
      });
      state.statsEntry[t.id] = entry;
    });
    const scored = deepClone(state);
    const done = finalizeCurrentPeriod(state, seededRng(salt + 7100 + week));
    if (done.error) throw new Error("recap preview: finalize failed - " + done.error);
    state = done.state;
    if (recapWeeks.includes(week)) {
      weeks[week] = { beforeSchemes, scored, lines, injuries: weekInjuries(scored, salt + 9100 + week) };
    }
  }

  /* The next week, Tuesday morning: a brand new roster and nothing submitted yet. */
  state = deal(state, ids, salt + 4100 + played + 1);
  return { state, weeks };
}
