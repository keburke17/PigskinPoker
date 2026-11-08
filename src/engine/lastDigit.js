/* Last Digit - the third game on the site (Scott, 2026-11-05, OQ-37).
 *
 * NOT POKER, AND IT SHARES NONE OF POKER'S RULES. Nothing here is dealt from the player
 * pool, nothing is schemed, nothing is scored from a stat line. Each player holds ONE NFL
 * team for the whole season and scores the last digit of that team's real final score,
 * every week:
 *
 *   31 scores 1, 45 scores 5, 30 scores 0, 7 scores 7.
 *
 *   - A BYE keeps the points from the week before. So does a game that is never played
 *     (Scott: "if a game is never played, it is treated like a bye week").
 *   - A bye in the game's FIRST week still copies the real NFL week before it, even though
 *     the game had not started yet (Scott's answer, 2026-11-05).
 *   - Most points after Week 18 wins. Teams level on points are split by most 9s, then most
 *     8s, and on down to 0s. Teams level on EVERY count share the spot - and the counts
 *     only matter when the points are exactly level: 145 beats 144 however many 9s the 144
 *     has (Scott, 2026-11-05).
 *   - A game can start late in the NFL season. Weeks before its start week are not on the
 *     board and count for nothing.
 *
 * Pure, like everything in src/engine/: games and teams in, a board out. The server reads
 * the schedule off nflverse's games.csv and hands it over as `games`; the browser draws
 * whatever this returns. Nothing is stored about a week - the board is worked out fresh
 * from the real scores every time, so there is no second copy of a score to disagree.
 *
 * A game, as the server hands it over:
 *   { week, home, away, homeScore, awayScore, kickoff }
 * home/away are the three-letter abbreviations from ./nflTeams.js. A score is null until
 * the game is over; kickoff is an ISO timestamp, or null when the schedule has none yet.
 */

import { NFL_TEAM_ABBR } from "./nflTeams.js";

export const LAST_DIGIT = "lastdigit";
export const LAST_DIGIT_WEEKS = 18;
export const LAST_DIGIT_MAX_PLAYERS = 32;
export const LAST_DIGIT_DRAWS = Object.freeze(["random", "manual"]);

/* The 32 abbreviations, alphabetical - the order every team list in the game uses. */
export const NFL_ABBRS = Object.freeze(Object.values(NFL_TEAM_ABBR).slice().sort());

/* A game with no score this long after it kicked off was never played - postponed for
 * good, or cancelled, as Bills-Bengals was in 2023 - and is scored like a bye. Long enough
 * that a Monday night game, or nflverse posting late, is never mistaken for one. */
export const NO_SHOW_HOURS = 60;

export function isLastDigit(state) {
  return Boolean(state && state._meta && state._meta.mode === LAST_DIGIT);
}

/** The last digit of a final score. */
export function lastDigitOf(score) {
  const n = Number(score);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) % 10 : null;
}

const time = (iso) => (iso ? Date.parse(iso) : NaN);

/** One team's game in one week, from its side: { opp, home, score, oppScore, kickoff }. */
export function gameFor(games, team, week) {
  for (const g of games || []) {
    if (Number(g.week) !== Number(week)) continue;
    if (g.home === team) return { opp: g.away, home: true, score: g.homeScore, oppScore: g.awayScore, kickoff: g.kickoff || null };
    if (g.away === team) return { opp: g.home, home: false, score: g.awayScore, oppScore: g.homeScore, kickoff: g.kickoff || null };
  }
  return null;
}

const hasScore = (g) => g && g.score != null && g.oppScore != null && g.score !== "" && g.oppScore !== "";

/**
 * Every week 1..18 for one NFL team.
 *
 * Each cell is one of:
 *   final    the game is over; pts is its last digit
 *   bye      no game this week; pts is last week's, or null while last week is unsettled
 *   nogame   a game that was never played; scored exactly like a bye
 *   upcoming a game not over yet; pts is null
 *
 * Weeks before the game's start week are worked out too, because a bye in the first week
 * copies the real week before it. The board just does not show or count them.
 */
export function teamCells(games, team, { now = Date.now() } = {}) {
  /* A BYE IS ONLY WORTH ANYTHING ONCE ITS WEEK HAS STARTED. Without this, a schedule that
   * failed to load - or a week not yet published - would read as eighteen byes in a row,
   * every one copying a zero, and the board would crown a champion of nothing. */
  const started = weekStarts(games);
  const cells = [];
  let prev = 0; // nothing to copy before Week 1 - and no team has a Week 1 bye anyway
  let prevKnown = true;
  for (let week = 1; week <= LAST_DIGIT_WEEKS; week++) {
    const g = gameFor(games, team, week);
    const underway = started[week] != null && now >= started[week];
    let cell;
    if (g && hasScore(g)) {
      cell = { week, kind: "final", pts: lastDigitOf(g.score), raw: Number(g.score), oppScore: Number(g.oppScore), opp: g.opp, home: g.home, kickoff: g.kickoff };
    } else if (g && Number.isFinite(time(g.kickoff)) && now - time(g.kickoff) > NO_SHOW_HOURS * 3600 * 1000) {
      cell = { week, kind: "nogame", pts: prevKnown ? prev : null, opp: g.opp, home: g.home, kickoff: g.kickoff };
    } else if (g) {
      cell = { week, kind: "upcoming", pts: null, opp: g.opp, home: g.home, kickoff: g.kickoff };
    } else {
      cell = { week, kind: "bye", pts: prevKnown && underway ? prev : null };
    }
    if (cell.pts != null) {
      prev = cell.pts;
      prevKnown = true;
    } else {
      prevKnown = false;
    }
    cells.push(cell);
  }
  return cells;
}

/** Week -> the time its first game kicks off (ms). A week with no times is absent. */
export function weekStarts(games) {
  const out = {};
  for (const g of games || []) {
    const k = time(g.kickoff);
    if (!Number.isFinite(k)) continue;
    const w = Number(g.week);
    if (out[w] == null || k < out[w]) out[w] = k;
  }
  return out;
}

/**
 * The week being played now: the first week with a game still to finish. Past the last
 * one, it is Week 18 - the season is over and the board stays on its last week.
 */
export function currentWeekOf(games, { now = Date.now() } = {}) {
  for (let week = 1; week <= LAST_DIGIT_WEEKS; week++) {
    const open = (games || []).some((g) => {
      if (Number(g.week) !== week) return false;
      if (g.homeScore != null && g.awayScore != null && g.homeScore !== "" && g.awayScore !== "") return false;
      const k = time(g.kickoff);
      return !(Number.isFinite(k) && now - k > NO_SHOW_HOURS * 3600 * 1000);
    });
    if (open) return week;
  }
  return LAST_DIGIT_WEEKS;
}

/** Highest first: points, then 9s, 8s ... 0s. Zero means level on everything. */
export function compareLastDigit(a, b) {
  if (b.total !== a.total) return b.total - a.total;
  for (let d = 9; d >= 0; d--) {
    if (b.counts[d] !== a.counts[d]) return b.counts[d] - a.counts[d];
  }
  return 0;
}

/**
 * The board.
 *
 * @param {object} p
 * @param {Array} p.games       the season's games, as above
 * @param {Array} p.entries     [{ teamId, name, nflTeam }] - one per player; nflTeam is null
 *                              until the commissioner hands one out
 * @param {number} p.startWeek  the game's first week, 1..18
 * @param {number} [p.now]
 * @returns {{ rows, waiting, unheld, currentWeek, complete, champions }}
 *   rows      players with a team, ranked. Each: { teamId, name, nflTeam, cells, total,
 *             counts, rank, tied }. `rank` is the shared place; `tied` says somebody shares it.
 *   waiting   players still waiting for a team
 *   unheld    the NFL teams nobody holds
 *   complete  every square from the start week to Week 18 is settled
 *   champions the rows in first place once the season is complete, else []
 */
export function lastDigitBoard({ games, entries, startWeek = 1, now = Date.now() }) {
  const start = Math.min(Math.max(Number(startWeek) || 1, 1), LAST_DIGIT_WEEKS);
  const held = (entries || []).filter((e) => e.nflTeam);
  const rows = held.map((e) => {
    const cells = teamCells(games, e.nflTeam, { now });
    const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let total = 0;
    let settled = true;
    cells.forEach((c) => {
      if (c.week < start) return;
      if (c.pts == null) { settled = false; return; }
      total += c.pts;
      counts[c.pts] += 1;
    });
    return { teamId: e.teamId, name: e.name, nflTeam: e.nflTeam, cells, total, counts, settled };
  });

  /* Ties go to the team that comes first alphabetically only for DRAWING ORDER - the rank
   * itself is shared. A stable, readable order beats one that shuffles on every refresh. */
  rows.sort((a, b) => compareLastDigit(a, b) || String(a.nflTeam).localeCompare(String(b.nflTeam)));
  rows.forEach((r, i) => {
    let first = i;
    while (first > 0 && compareLastDigit(rows[first - 1], r) === 0) first--;
    r.rank = first + 1;
    r.tied = (i > 0 && compareLastDigit(rows[i - 1], r) === 0) || (i < rows.length - 1 && compareLastDigit(rows[i + 1], r) === 0);
  });

  const complete = rows.length > 0 && rows.every((r) => r.settled);
  const taken = new Set(held.map((e) => e.nflTeam));
  return {
    rows,
    waiting: (entries || []).filter((e) => !e.nflTeam),
    unheld: NFL_ABBRS.filter((a) => !taken.has(a)),
    currentWeek: Math.max(currentWeekOf(games, { now }), start),
    complete,
    champions: complete ? rows.filter((r) => r.rank === 1) : [],
  };
}

/**
 * The pairs level on points, and the count that split them. `digit` is null when they
 * are level on every count and share the spot. Drawn by the Tiebreaker table.
 */
export function lastDigitTies(rows) {
  const out = [];
  for (let i = 1; i < (rows || []).length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (a.total !== b.total) continue;
    let digit = null;
    for (let d = 9; d >= 0; d--) {
      if (a.counts[d] !== b.counts[d]) { digit = d; break; }
    }
    out.push({ ahead: a.teamId, behind: b.teamId, digit });
  }
  return out;
}

/**
 * When joining and handing out teams closes: the first kickoff, in the game's start week
 * or later, after the game was made.
 *
 * Usually that is simply the start week's first kickoff. A game made mid-season with a
 * start week already played (Scott allowed that, 2026-11-05) closes at the first game
 * still to come instead - otherwise it would be closed before anyone could join it.
 *
 * @returns {string|null} ISO timestamp, or null when the schedule has no time to give
 */
export function lastDigitLockAt({ games, startWeek = 1, createdAt = null }) {
  const made = time(createdAt);
  let best = null;
  for (const g of games || []) {
    if (Number(g.week) < Number(startWeek) || Number(g.week) > LAST_DIGIT_WEEKS) continue;
    const k = time(g.kickoff);
    if (!Number.isFinite(k)) continue;
    if (Number.isFinite(made) && k <= made) continue;
    if (best == null || k < best) best = k;
  }
  return best == null ? null : new Date(best).toISOString();
}

/** True once joining and handing out teams has closed. Unknown schedule: still open. */
export function lastDigitLocked({ games, startWeek, createdAt, now = Date.now() }) {
  const at = lastDigitLockAt({ games, startWeek, createdAt });
  return at != null && now >= Date.parse(at);
}

/**
 * The random draw: a different NFL team for every player still waiting for one, from the
 * teams nobody holds. Players who already have a team keep it.
 *
 * @param {Array} entries  [{ teamId, nflTeam }]
 * @param {Function} rng   () => [0, 1)
 * @returns {{ assign: Object<teamId, abbr> } | { error: string }}
 */
export function dealLastDigit(entries, rng = Math.random) {
  const taken = new Set((entries || []).map((e) => e.nflTeam).filter(Boolean));
  const free = NFL_ABBRS.filter((a) => !taken.has(a));
  const waiting = (entries || []).filter((e) => !e.nflTeam);
  if (!waiting.length) return { error: "Everyone already has a team." };
  if (waiting.length > free.length) return { error: "There are more players than NFL teams left." };
  /* Fisher-Yates over the free teams, the same shuffle the poker deal uses. */
  const pool = free.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const assign = {};
  waiting.forEach((e, i) => { assign[e.teamId] = pool[i]; });
  return { assign };
}
