/* Shared test fixtures. Everything here is deterministic: no Math.random, no real clock. */

import {
  createDefaultState,
  dealRosters,
  emptyCumulative,
  seededRng,
} from "../../src/engine/index.js";

export const STARTER_SLOTS = ["Coach", "QB", "WR", "RB", "TE", "FLEX"];

export function makeTeams(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: "team_" + i,
    name: "Team " + String.fromCharCode(65 + i),
    joinCode: "",
    roster: null,
    cumulative: emptyCumulative(),
    playoffCumulative: emptyCumulative(),
  }));
}

export function baseState(teamCount = 6) {
  const s = createDefaultState();
  s.teams = makeTeams(teamCount);
  return s;
}

/** A state with rosters dealt for every team, phase 'dealt'. */
export function dealtState(teamCount = 6, seed = 42) {
  const s = baseState(teamCount);
  const res = dealRosters(s, s.teams.map((t) => t.id), seededRng(seed));
  if (res.error) throw new Error("fixture deal failed: " + res.error);
  Object.entries(res.rosters).forEach(([id, roster]) => {
    s.teams.find((t) => t.id === id).roster = roster;
  });
  s.currentPeriod.phase = "dealt";
  return s;
}

export const team = (s, id) => s.teams.find((t) => t.id === id);
export const starter = (s, id, slot) => team(s, id).roster.starters[slot];

/** Ids of every player currently on a roster. */
export function rosteredIds(s) {
  const set = new Set();
  s.teams.forEach((t) => {
    if (!t.roster) return;
    Object.values(t.roster.starters).forEach((i) => i && set.add(i));
    t.roster.bench.forEach((i) => i && set.add(i));
  });
  return set;
}

/** Mark every un-rostered Active player at `pos` as OUT, emptying the free-agent pool. */
export function emptyFreeAgents(s, pos) {
  const rostered = rosteredIds(s);
  s.playerPool.forEach((p) => {
    if (p.position === pos && !rostered.has(p.id)) p.status = "OUT";
  });
  return s;
}

/**
 * Deterministic stat lines for every starter of every listed team.
 * Merges into statsEntry rather than replacing it, so it composes with setStats().
 */
export function fillStats(s, teamIds, seed = 7) {
  const rng = seededRng(seed);
  if (!s.statsEntry) s.statsEntry = {};
  teamIds.forEach((tid) => {
    const t = team(s, tid);
    if (!t || !t.roster) return;
    const entry = {};
    STARTER_SLOTS.forEach((slot) => {
      const p = s.playerPool.find((pp) => pp.id === t.roster.starters[slot]);
      if (!p) return;
      entry[slot] =
        p.position === "Coach"
          ? { result: ["Win", "Loss", "Tie"][Math.floor(rng() * 3)] }
          : { yards: String(Math.floor(rng() * 140)), tds: String(Math.floor(rng() * 4)) };
    });
    s.statsEntry[tid] = entry;
  });
  return s;
}

/** Set one team's stat line explicitly. */
export function setStats(s, teamId, lines) {
  if (!s.statsEntry) s.statsEntry = {};
  s.statsEntry[teamId] = lines;
  return s;
}
