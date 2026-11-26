/* What counts as a league gone wrong - the rules the hourly checker applies.
 *
 * docs/PLAN-AUTOMATIC-LEAGUES.md, step 3. Scott, 2026-11-25: with thousands of leagues
 * nobody here commissions, "how am I to know what league is experiencing this issue?"
 * This answers it: every hour, every league is held up against the states that should
 * be impossible, and anything found is emailed to the site admins with the league's
 * name and id (server/leagueCheck.js does the reading, the storing and the email).
 *
 * PURE, like server/autoCycle.js: two rows and a schedule in, a list of problems out.
 * Each check is something that has really happened, or is the shape of a step that
 * stopped halfway:
 *
 *   empty_week        a week finished with every team on 0 - Week 12, 2026-11-24
 *   ahead_of_nfl      a week dealt while the NFL week before it is still being played -
 *                     the Week 13 that was dealt in Week 12
 *   behind_nfl        a week still open after the NFL week after it is over
 *   schemes_overdue   the scheme deadline passed and the clock did not process them
 *   finalize_overdue  the week's football is over, Tuesday has passed, not finalized
 *   deal_overdue      Tuesday has passed and the next week was not dealt
 *   deal_unrecorded   a week is dealt but its deal time was never saved
 *   unmapped          an open week with no NFL week - no stats, no lock times
 *   email_mismatch    the roster email went out before the deal the league kept - the
 *                     table's double deals of Nov 10 onwards
 *
 * THE OVERDUE CHECKS ASK THE CLOCK'S OWN QUESTION, two hours late. They call the same
 * eligibility functions the weekly cycle calls, with the clock wound back by GRACE_MS:
 * "would the clock have acted two hours ago?" If so and the week has not moved, the
 * clock is stuck. Using the clock's own rules means the checker cannot disagree with it
 * about what was due - including the Wednesday-game deadline (OQ-40).
 *
 * A WRONG ALARM COSTS AN EMAIL; A MISSED ONE COSTS A LEAGUE. So where a check cannot
 * tell (no schedule, a season over, a game with no kickoff time) it stays quiet rather
 * than guessing, and every message says what to look at.
 */

import { NFL_TEAMS } from "./feed/nflverse.js";
import {
  FINALIZABLE_PHASES,
  advanceEligibility,
  dealEligibility,
  schemesEligibility,
  zoneOf,
} from "./autoCycle.js";

/** How late a step may be before it counts as stuck. Two hourly runs. */
export const GRACE_MS = 2 * 60 * 60 * 1000;
/** A roster email this long before the deal it describes means a second deal. */
export const EMAIL_SLACK_MS = 60 * 1000;

const OPEN_PHASES = ["dealt", "schemes-processed", "stats"];

const label = (p) => (p.type === "playoff" ? "Playoff Round " : "Week ") + p.number;

/** The current period, chosen exactly as hydrate.js chooses it. */
export function currentPeriodOf(periods) {
  const sorted = (periods ?? [])
    .slice()
    .sort((a, b) => (a.type === b.type ? a.number - b.number : a.type === "week" ? -1 : 1));
  return sorted.find((p) => p.phase !== "finalized") ?? sorted[sorted.length - 1] ?? null;
}

/** The most recently finished period, ordered the way hydrate.js orders them. */
export function lastFinalizedOf(periods) {
  const done = (periods ?? [])
    .filter((p) => p.phase === "finalized")
    .sort((a, b) => (a.type === b.type ? a.number - b.number : a.type === "week" ? -1 : 1));
  return done[done.length - 1] ?? null;
}

/** One NFL week's games, from `fetchSeasonGames`. */
const gamesOf = (games, week) => (games ?? []).filter((g) => g.week === week);
const played = (g) => g.homeScore != null && g.awayScore != null;

/** Win / Tie / Loss by full team name, the shape `weekIsComplete` reads. */
export function resultsFromSeasonGames(games, week) {
  const out = new Map();
  for (const g of gamesOf(games, week)) {
    if (!played(g)) continue;
    const home = NFL_TEAMS[g.home];
    const away = NFL_TEAMS[g.away];
    if (home) out.set(home, g.homeScore > g.awayScore ? "Win" : g.homeScore < g.awayScore ? "Loss" : "Tie");
    if (away) out.set(away, g.awayScore > g.homeScore ? "Win" : g.awayScore < g.homeScore ? "Loss" : "Tie");
  }
  return out;
}

/**
 * Everything wrong with one league right now.
 *
 * @param {object} p
 * @param {object} p.league        leagues row (id, name, mode, tz, auto_* switches)
 * @param {object} p.season        seasons row (year, playoff_completed)
 * @param {Array}  p.periods       every period of the season (light columns)
 * @param {object} p.current       the current period, full row (kickoffs, dealt_at ...)
 * @param {Array}  p.lastResults   period_results of the most recent finished period
 * @param {number} p.teamCount     teams that play the current period
 * @param {string|null} p.dealtEmailAt  earliest week_dealt email for the current period
 * @param {Array|null}  p.games    the season's games (fetchSeasonGames), null if unread
 * @param {number} p.now
 * @returns {Array<{kind: string, key: string, message: string}>}
 */
export function findLeagueProblems({
  league, season, periods = [], current, lastResults = [], teamCount = 0,
  dealtEmailAt = null, games = null, now,
}) {
  const out = [];
  if (!league || league.mode === "lastdigit") return out; // nothing is ever dealt there
  const add = (kind, key, message) => out.push({ kind, key: String(key), message });

  /* ---- the finished week ---- */
  const last = lastFinalizedOf(periods);
  if (last && lastResults.length >= 2 && lastResults.every((r) => Number(r.raw_score) === 0)) {
    const undealt = !last.dealt_at && !last.deal_seed;
    add("empty_week", last.id,
      label(last) + " was finished with every team on 0 points" +
      (undealt ? ", and it was never dealt." : ".") +
      " Its standings points and week win were handed out on nothing.");
  }

  if (!current || current.phase === "finalized" || season?.playoff_completed) return out;
  const name = label(current);
  const week = current.nfl_week;

  /* ---- a step that stopped halfway ---- */
  if (OPEN_PHASES.includes(current.phase) && !current.dealt_at) {
    add("deal_unrecorded", current.id,
      name + " is dealt, but its deal time was never saved - the deal did not finish. " +
      "Deadlines measured from it (schemes, Tuesday) will not fire.");
  }
  if (current.type === "week" && week == null) {
    add("unmapped", current.id,
      name + " has no NFL week, so its stats, kickoff times and deadlines cannot be read.");
  }
  if (dealtEmailAt && current.dealt_at &&
      Date.parse(dealtEmailAt) < Date.parse(current.dealt_at) - EMAIL_SLACK_MS) {
    add("email_mismatch", current.id,
      "The " + name + " roster email went out at " + dealtEmailAt + ", before the deal the league " +
      "is using (" + current.dealt_at + "). The week was dealt twice, and managers were emailed " +
      "rosters they do not have.");
  }

  /* ---- out of step with the NFL ---- */
  if (current.type === "week" && Number.isInteger(week) && games) {
    if (OPEN_PHASES.includes(current.phase) && week >= 2) {
      const before = gamesOf(games, week - 1);
      const unplayed = before.filter((g) => !played(g) && g.kickoff && Date.parse(g.kickoff) > now);
      if (before.length && unplayed.length) {
        add("ahead_of_nfl", current.id,
          name + " is dealt as NFL week " + week + ", but NFL week " + (week - 1) +
          " still has " + unplayed.length + " game" + (unplayed.length === 1 ? "" : "s") +
          " to play. The league is a week ahead of the NFL.");
      }
    }
    const after = gamesOf(games, week + 1);
    if (after.length && after.every(played)) {
      add("behind_nfl", current.id,
        name + " is still open on NFL week " + week + ", but NFL week " + (week + 1) +
        " is already over. The league has fallen behind.");
    }
  }

  /* ---- the clock's own question, two hours late ---- */
  const then = now - GRACE_MS;
  const tz = zoneOf(league);
  if (current.phase === "dealt" && league.auto_process_schemes) {
    const v = schemesEligibility({ league, period: current, teamCount, now: then });
    if (v.eligible) {
      add("schemes_overdue", current.id,
        "Schemes for " + name + " should have processed (" + v.why + ", " + tz + ") and have not.");
    }
  }
  if (FINALIZABLE_PHASES.includes(current.phase) && league.auto_advance_week && games && Number.isInteger(week)) {
    const results = resultsFromSeasonGames(games, week);
    const v = advanceEligibility({ league, period: current, teamCount, results, now: then });
    if (v.eligible) {
      add("finalize_overdue", current.id,
        name + " should have been finalized (" + v.why + ", and Tuesday's deadline has passed) and has not.");
    }
  }
  /* Not for a table: a hand waiting for players is the lobby working, not the clock
   * stuck (tableDealProblem in server/operations.js). */
  if (current.phase === "pre-deal" && league.auto_advance_week && league.mode !== "table") {
    const stamps = periods.map((p) => p.finalized_at).filter(Boolean).sort();
    const v = dealEligibility({
      league, next: current, teamCount,
      playoffsComplete: Boolean(season?.playoff_completed),
      previousFinalizedAt: stamps[stamps.length - 1] ?? null,
      now: then,
    });
    if (v.eligible) {
      add("deal_overdue", current.id, name + " should have been dealt by now and has not.");
    }
  }

  return out;
}
