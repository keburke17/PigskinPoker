/* When the clock may move a league's week along, and why not when it may not.
 *
 * Issue #52, and OQ-14. Scott asked for the cycle to run itself: "Rosters are dealt
 * automatically Tuesday morning. Schemes are processed Thursday morning at like 3am
 * (just how waivers would process in real fantasy football) ... Tuesday morning rosters
 * are dealt automatically for the next week. Standings are updated."
 *
 * Split out of operations.js and kept free of I/O for exactly the reason
 * server/autoPull.js is: the rule that matters is testable on its own, and this one is
 * answered every hour of the season by a job nobody is watching. The one fact it cannot
 * work out from two rows - whether the week's football has finished - is handed in by
 * the caller as data (`results`), so even that stays a pure question.
 *
 * THE SCHEDULER IS NOT A NEW PERMISSION. It runs the same operations the commissioner's
 * buttons run, under the same phase guards, and it is off until he turns it on. What it
 * changes is who presses them and when. It cannot deal past the end of the regular
 * season and cannot touch a league that has not opted in.
 *
 * IT DOES NOW REACH THE PLAYOFFS, and that is worth being precise about, because the
 * sentence above used to say it could not. The scheduler still starts nothing: what it
 * calls is `finalizePeriod`, and finalize seeds the bracket itself when the league's
 * nominated week arrives (OQ-16, src/engine/standings.js). The decision is the
 * commissioner's, made in advance in the Playoffs panel; the clock only carries it out,
 * on exactly the same code path his own Finalize button takes.
 *
 * EVERY GUARD IS A REASON TO DO NOTHING RATHER THAN TO FAIL - the same discipline
 * autoPull.js sets out. Not opted in, wrong phase, deadline not reached, games still
 * running, no teams, season over: none of those is an error and none should page
 * anybody. A league sitting in `pre-deal` on a Friday is the normal state of the world.
 *
 * ---------------------------------------------------------------------------
 * THE TWO THINGS THIS CHANGES ABOUT PLAYING IN THE LEAGUE, written down because they
 * are rules changes rather than plumbing, and OQ-14 is where they were agreed:
 *
 *   1. THE SCHEME DEADLINE BECOMES REAL. `processSchemes` skips a team with no scheme
 *      on file - it is not an error, nothing happens for them. Today the commissioner
 *      waits until everyone is in; on a clock, "forgot to pick" costs you your scheme
 *      for the week with no appeal. That is the waivers analogy working as intended,
 *      and it is still a change in feel.
 *   2. AN UNATTENDED FINALIZE HAS NO UNDO. `finalizePeriod` is legal from
 *      `schemes-processed` as well as `stats`, and it will happily write a week of
 *      zeros into `cumulative` for everybody. That is what `advanceEligibility` guards
 *      against and why the readiness test below is about FOOTBALL being finished rather
 *      than about the stat boxes being full.
 * ---------------------------------------------------------------------------
 */

import { isValidNflWeek } from "./schedule.js";
import { isValidTimeZone, lastLocalDeadline, wallClock } from "./tz.js";
import { CYCLE_DEADLINES, describeDeadline } from "../src/engine/weeklyClock.js";

/** Fallback when a league's stored zone is one this runtime cannot use. */
export const DEFAULT_TZ = "America/New_York";

/**
 * The two deadlines, re-exported from the engine.
 *
 * DEFINED IN src/engine/weeklyClock.js, NOT HERE, because the browser has to name them
 * too - a manager who discovers that 3am Thursday is real by losing a week is the
 * failure this feature was supposed to prevent. `server/` may import from `src/`; the
 * reverse is forbidden, so the shared half lives on the side both can reach. Same
 * arrangement as the lineup lock.
 */
export const DEADLINES = CYCLE_DEADLINES;

/** Phases in which the scheme step is legal. Mirrors PHASE_RULES.processSchemes. */
export const PROCESSABLE_PHASES = ["dealt"];
/** Phases in which a finalize is legal. Mirrors PHASE_RULES.finalizePeriod. */
export const FINALIZABLE_PHASES = ["schemes-processed", "stats"];
/** The last week of the regular season. Past this, the commissioner starts the playoffs. */
export const LAST_REGULAR_WEEK = 18;

/** A league's timezone, or Eastern when the stored one is unusable. */
export function zoneOf(league) {
  const tz = league?.tz;
  return isValidTimeZone(tz) ? tz : DEFAULT_TZ;
}

/** "Thursday 3am", for a log line and for a sentence on screen. */
export const deadlineWords = describeDeadline;

/**
 * Has this league's deadline for the current week passed, with the week still sitting
 * where it was when the deadline arrived?
 *
 * MEASURED AGAINST `dealt_at`, NOT AGAINST THE CURRENT HOUR, and that is what makes the
 * job both safe to run every hour and safe to MISS an hour:
 *
 *   - a tick lost to a deploy or a cold start is picked up on the next one, because
 *     the deadline is still in the past;
 *   - it cannot fire twice, because acting moves the phase;
 *   - a week dealt LATE - Friday, say - correctly waits for the following Thursday
 *     rather than processing itself thirty seconds later, because it was dealt after
 *     the most recent deadline rather than before it.
 *
 * @returns {{ passed: boolean, at: number }} `at` is the deadline instant, for the log
 */
export function deadlinePassed(league, dealtAt, deadline, now) {
  const at = lastLocalDeadline(now, zoneOf(league), deadline);
  const dealt = Date.parse(dealtAt ?? "");
  /* A period with no deal time cannot be reasoned about, so it waits. In practice only
   * a hand-edited row gets here: dealPeriod always stamps it. */
  if (!Number.isFinite(dealt)) return { passed: false, at };
  return { passed: dealt < at, at };
}

/**
 * Should the scheduler process this league's schemes right now?
 *
 * @param {object} league  the `leagues` row
 * @param {object|null} period  the league's CURRENT period row
 * @param {number} teamCount  teams eligible for this period
 * @param {number} now  epoch ms
 * @returns {{ eligible: boolean, why: string }} `why` is written for a log line a human
 *          reads on a Thursday morning, not for a screen.
 */
export function schemesEligibility({ league, period, teamCount, now }) {
  if (!league) return { eligible: false, why: "no such league" };
  if (!league.auto_process_schemes) {
    return { eligible: false, why: "automatic scheme processing is off" };
  }
  if (!period) return { eligible: false, why: "no current week" };
  if (!PROCESSABLE_PHASES.includes(period.phase)) {
    /* Covers the commissioner who did it himself an hour ago, and the week that has
     * not been dealt yet. Both are him being ahead of the clock, not a fault. */
    return { eligible: false, why: "the week is in '" + period.phase + "'" };
  }
  if (!teamCount) return { eligible: false, why: "the league has no teams" };

  const { passed, at } = deadlinePassed(league, period.dealt_at, DEADLINES.schemes, now);
  if (!passed) {
    return {
      eligible: false,
      why: "the " + deadlineWords(DEADLINES.schemes) + " deadline has not come round yet",
    };
  }
  return { eligible: true, why: "the " + deadlineWords(DEADLINES.schemes) + " deadline passed at " + new Date(at).toISOString() };
}

/**
 * Is every game of this NFL week over?
 *
 * THE READINESS TEST IS ABOUT FOOTBALL, NOT ABOUT STAT BOXES, and that distinction is
 * the reason an unattended finalize is safe at all. The obvious guard - "the pull
 * reported nothing missing" - is wrong, because a missing line is also exactly what a
 * healthy starter who was inactive looks like, and Scott's answer on OQ-4c is that he
 * scores 0. So we ask the schedule instead: every team with a kickoff this week must
 * have a result. A postponed game has a kickoff and no result, so the job waits and
 * tries again next hour, which is precisely the case an unattended finalize would do
 * the most damage in.
 *
 * READ OFF THE PERIOD'S OWN `kickoffs`, the same times the lineup lock fires on, so the
 * week the job thinks it is finalizing is the week the league actually played. No
 * kickoffs at all is NOT complete: a league whose schedule was never read would
 * otherwise pass this vacuously and finalize on nothing.
 *
 * @param {Object<string,string>} kickoffs  NFL team -> ISO, from `periods.kickoffs`
 * @param {Map<string,string>|object} results  NFL team -> Win/Tie/Loss, from the feed
 */
export function weekIsComplete(kickoffs, results) {
  const teams = Object.keys(kickoffs ?? {});
  if (!teams.length) {
    return { complete: false, why: "this week's kickoff times have not been read" };
  }
  const has = (team) =>
    results instanceof Map ? results.has(team) : Boolean(results && results[team]);
  const unfinished = teams.filter((t) => !has(t));
  if (unfinished.length) {
    return {
      complete: false,
      why: unfinished.length + " team" + (unfinished.length === 1 ? "" : "s") + " have not finished playing",
    };
  }
  return { complete: true, why: "every game of the week is final" };
}

/**
 * Should the scheduler finalize this league's week and deal the next one?
 *
 * Takes `results` rather than fetching them, so the whole rule is testable without a
 * network - but note the ORDER the caller must respect: every cheap guard here is
 * checked before `results` is needed, so the feed is only fetched for a league that
 * could actually act on it. That is what keeps an hourly job polite to a free,
 * community-run data source, and it is the same argument autoPull.js makes.
 *
 * @param {object|null} results  NFL team -> result, or null when not fetched yet. Null
 *        returns `needsResults`, which is the caller's cue to go and get them.
 */
export function advanceEligibility({ league, period, teamCount, results = null, now }) {
  if (!league) return { eligible: false, why: "no such league" };
  if (!league.auto_advance_week) {
    return { eligible: false, why: "automatic week advance is off" };
  }
  if (!period) return { eligible: false, why: "no current week" };
  if (!FINALIZABLE_PHASES.includes(period.phase)) {
    /* `pre-deal` means the week was already advanced - by the clock an hour ago or by
     * the commissioner on Monday night. `dealt` means the schemes step has not run, and
     * finalizing over the top of it would score a week nobody played. */
    return { eligible: false, why: "the week is in '" + period.phase + "'" };
  }
  if (!teamCount) return { eligible: false, why: "the league has no teams" };
  if (!isValidNflWeek(period.nfl_week)) {
    return { eligible: false, why: "the week is not mapped to an NFL week" };
  }

  const { passed } = deadlinePassed(league, period.dealt_at, DEADLINES.advance, now);
  if (!passed) {
    return {
      eligible: false,
      why: "the " + deadlineWords(DEADLINES.advance) + " deadline has not come round yet",
    };
  }

  if (results == null) return { eligible: false, needsResults: true, why: "results not read yet" };

  const done = weekIsComplete(period.kickoffs, results);
  if (!done.complete) return { eligible: false, why: done.why };

  return { eligible: true, why: "NFL week " + period.nfl_week + " is final" };
}

/**
 * Is it Tuesday morning as far as THIS week is concerned?
 *
 * A DEAL IS NOT SIMPLY "AS SOON AS THE LAST WEEK ENDED", and getting that wrong is the
 * difference between Scott's request and something close to it. Two cases have to work:
 *
 *   - the commissioner finalizes on MONDAY NIGHT. The week is then sitting in
 *     `pre-deal`, and dealing at the next hourly tick would hand everyone their new
 *     roster at 11pm Monday. He asked for Tuesday morning, so it waits.
 *   - the finalize happens ON Tuesday - by the clock at 6am, or by him at 10am. Waiting
 *     for "the next Tuesday" would cost the league a week of football.
 *
 * So the window is open when the last week ended BEFORE the most recent Tuesday
 * deadline, or when it is currently Tuesday and that deadline has passed.
 *
 * @param {string|null} previousFinalizedAt  when the season's last finished week ended
 */
export function dealWindowOpen(league, previousFinalizedAt, now) {
  const tz = zoneOf(league);
  const at = lastLocalDeadline(now, tz, DEADLINES.advance);
  const finalized = Date.parse(previousFinalizedAt ?? "");
  if (!Number.isFinite(finalized)) return { open: false, why: "no finished week to follow" };
  if (finalized < at) return { open: true, why: "the last week ended before this morning" };

  const here = wallClock(now, tz);
  const today = here.weekday === DEADLINES.advance.weekday && here.hour >= DEADLINES.advance.hour;
  return today
    ? { open: true, why: "it is " + deadlineWords(DEADLINES.advance) + " and the week has ended" }
    : { open: false, why: "waiting for " + deadlineWords(DEADLINES.advance) };
}

/**
 * May the scheduler deal this pre-deal week?
 *
 * A SEPARATE QUESTION FROM THE FINALIZE for two reasons, and both are cases the league
 * actually hits.
 *
 * FIRST, the commissioner often finalizes himself on Monday night. The week is then in
 * `pre-deal` with nothing left to finalize, so a Tuesday job that only knew how to
 * "finalize and then deal" would skip it forever and the league would never be dealt.
 * This step runs whether or not a finalize just happened.
 *
 * SECOND, the honest answer differs at the end of a season. `finalizeCurrentPeriod`
 * just increments the week number, and nothing in the engine knows how long a regular
 * season is - left alone the clock would cheerfully deal week 19, 20 and 21 into
 * January. So the stop condition is the NFL week mapping: deal week 18, then stop and
 * say so.
 *
 * REACHING THAT STOP NOW MEANS SOMETHING WENT UNSET. Since OQ-16 the playoffs start
 * themselves at a week the league nominated, and finalize seeds the bracket rather than
 * opening another regular week - so a league with its playoffs configured never gets
 * here at all. A league that does get here left `playoff_start_nfl_week` null, and the
 * honest thing is to stop and say exactly that rather than to guess a bracket.
 *
 * THE FIRST WEEK OF A SEASON IS NEVER DEALT BY THE CLOCK. There is no finished week
 * behind it, so `dealWindowOpen` says no - which is the behaviour you want anyway: week
 * 1 waits until the commissioner has his teams in and his managers invited. The rule is
 * "the clock deals every week except the first", and it is worth saying that way on
 * screen rather than leaving people to discover it.
 *
 * @param {object} next  the pre-deal period row, freshly read
 * @param {boolean} playoffsComplete  `playoffConfig.completed` - a champion is crowned
 * @param {string|null} previousFinalizedAt  when the season's last finished week ended
 */
export function dealEligibility({ league, next, teamCount, playoffsComplete, previousFinalizedAt, now }) {
  if (!league?.auto_advance_week) return { eligible: false, why: "automatic week advance is off" };
  if (playoffsComplete) return { eligible: false, why: "the season is over" };
  if (!next) return { eligible: false, why: "no next week was created" };
  if (next.phase !== "pre-deal") return { eligible: false, why: "the next week is in '" + next.phase + "'" };
  if (!teamCount) return { eligible: false, why: "the league has no teams" };

  if (next.type === "week") {
    if (!isValidNflWeek(next.nfl_week) || next.nfl_week > LAST_REGULAR_WEEK) {
      return {
        eligible: false,
        endOfSeason: true,
        why: "the regular season is over and this league has no playoff week set",
      };
    }
  }

  const window = dealWindowOpen(league, previousFinalizedAt, now);
  if (!window.open) return { eligible: false, why: window.why };

  return { eligible: true, why: "dealing " + next.type + " " + next.number };
}

/**
 * Fold each league's outcome into the one line the function logs and returns.
 *
 * Same shape and same reasoning as `summarize` in server/autoPull.js: A RUN THAT
 * SKIPPED EVERY LEAGUE IS A SUCCESS. Collapsing "not ready" into either "acted" or
 * "failed" is how a job like this ends up either crying wolf every Friday or hiding a
 * real outage behind a green tick.
 */
export function summarize(outcomes) {
  const acted = outcomes.filter((o) => o.status === "acted");
  const skipped = outcomes.filter((o) => o.status === "skipped");
  const failed = outcomes.filter((o) => o.status === "failed");
  return {
    ok: failed.length === 0,
    considered: outcomes.length,
    acted: acted.length,
    skipped: skipped.length,
    failed: failed.length,
    leagues: outcomes,
  };
}
