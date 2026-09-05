/* Which leagues a scheduled stats pull should touch, and why not when it should not.
 *
 * Split out of operations.js and kept free of I/O for the same reason server/stats.js
 * and server/pool.js are: the rule that matters is testable on its own, and this one
 * is answered dozens of times a week by a job nobody is watching.
 *
 * THE SCHEDULER IS NOT A NEW PERMISSION. It runs the same operation the commissioner's
 * button runs, under the same guards, and every one of those guards is a reason to do
 * NOTHING rather than a reason to fail:
 *
 *   - the league has not opted in            -> not our business
 *   - no current week                        -> nothing to fill in
 *   - the week is in the wrong phase         -> the commissioner has not got there yet,
 *                                               or has already finalized
 *   - the rosters are unlocked               -> numbers would land on the wrong player
 *                                               if a lineup moved (the same reason
 *                                               setStatLine and pullStats refuse)
 *   - the week is not mapped to an NFL week  -> we would be guessing which Sunday
 *
 * None of those is an error and none of them should page anybody. A league sitting in
 * `pre-deal` on a Tuesday is the normal state of the world, not a fault, and the job's
 * log says so in those terms.
 *
 * WHY THIS MATTERS FOR COST AS WELL AS CORRECTNESS. The guards run BEFORE the feed is
 * fetched, so the weekly stats file is only downloaded for a league that could actually
 * receive it. Most of the week every league is ineligible and the job makes no outbound
 * request at all - which is what keeps a schedule this frequent polite to a free,
 * community-run data source.
 *
 * See docs/PHASE-4-PLAN.md section 7, stage 7.
 */

import { isValidNflWeek } from "./schedule.js";

/** Phases in which a stats pull is allowed. Mirrors PHASE_RULES.pullStats. */
export const PULLABLE_PHASES = ["schemes-processed", "stats"];

/**
 * Should the scheduler pull this league's stats right now?
 *
 * Deliberately takes rows rather than a client: "is this league eligible" is a question
 * about two records, and answering it should not require a database.
 *
 * @param {object|null} league  the `leagues` row
 * @param {object|null} period  the league's CURRENT period, or null when it has none
 * @returns {{ eligible: boolean, why: string }} `why` is written for a log line a human
 *          reads on a Monday morning, not for a screen.
 */
export function pullEligibility(league, period) {
  if (!league) return { eligible: false, why: "no such league" };
  if (!league.auto_pull_stats) return { eligible: false, why: "automatic pulls are off" };
  if (!period) return { eligible: false, why: "no current week" };

  if (!PULLABLE_PHASES.includes(period.phase)) {
    return { eligible: false, why: "the week is in '" + period.phase + "'" };
  }
  if (!period.roster_locked) {
    return { eligible: false, why: "the rosters are not locked yet" };
  }
  if (!isValidNflWeek(period.nfl_week)) {
    return { eligible: false, why: "the week is not mapped to an NFL week" };
  }
  return { eligible: true, why: "week " + period.nfl_week + ", phase '" + period.phase + "'" };
}

/**
 * Fold each league's outcome into the one line the function logs and returns.
 *
 * A run that skipped every league is a SUCCESS, and the shape says so: `pulled` counts
 * the leagues that actually received numbers, `skipped` the ones that were not ready,
 * and `failed` only the ones where something genuinely went wrong. Collapsing the
 * middle case into either of the others is how a job like this ends up either crying
 * wolf every Tuesday or hiding a real outage.
 */
export function summarize(outcomes) {
  const pulled = outcomes.filter((o) => o.status === "pulled");
  const skipped = outcomes.filter((o) => o.status === "skipped");
  const failed = outcomes.filter((o) => o.status === "failed");
  return {
    ok: failed.length === 0,
    considered: outcomes.length,
    pulled: pulled.length,
    skipped: skipped.length,
    failed: failed.length,
    leagues: outcomes,
  };
}
