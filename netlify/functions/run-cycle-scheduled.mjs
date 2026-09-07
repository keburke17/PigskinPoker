/* The clock that runs the weekly cycle. Issue #52, OQ-14.
 *
 * A PEER OF api.mjs, NOT A CLIENT OF IT - the same shape pull-stats-scheduled.mjs
 * established. It runs inside our own deployment and reads the same secret key from the
 * same environment, so it calls server/operations.js directly. There is no scheduler
 * token to mint, store, rotate or leak, no new route into the API, and `verifySession`
 * is untouched. A scheduled function authenticating to our own HTTP endpoint with a
 * shared secret would be a second way in, guarding the same operations, for no benefit.
 *
 * Thin, for the same reason api.mjs is thin: the decisions live in server/, where they
 * are tested against a real Postgres without a Netlify runtime in the way. This file
 * maps a cron tick to one function call and writes a log line a human can read.
 *
 * ---------------------------------------------------------------------------
 * WHY IT RUNS EVERY HOUR when it only ever acts twice a week.
 *
 * Cron is UTC and both deadlines are local. 3am Eastern is 07:00Z under EDT and 08:00Z
 * under EST, and the 2026 season crosses the change on 1 November - so a single UTC
 * schedule would fire an hour early or an hour late for half the season, which for the
 * scheme deadline means processing at 2am or 4am relative to the time the league was
 * told. Running hourly and letting each league answer for its own timezone
 * (`leagues.tz`) is the standard fix, and it is cheap here: the eligibility guards in
 * server/autoCycle.js are pure comparisons on two rows and run BEFORE any feed is
 * fetched, so an ordinary hour costs one small query and nothing else.
 *
 * It also makes a MISSED tick harmless. The deadline is "has Thursday 3am passed with
 * this week still undealt-with", not "is it 3am right now", so an hour lost to a deploy
 * or a cold start is picked up on the next one instead of costing the league a week.
 * ---------------------------------------------------------------------------
 *
 * WHAT IT IS ALLOWED TO DO is exactly what the commissioner's buttons do, for leagues
 * that opted in (`leagues.auto_process_schemes` / `auto_advance_week`, both default
 * false). It cannot start the playoffs, cannot deal past the end of the regular season,
 * and will not finalize a week until every game of the mapped NFL week is final. See
 * server/autoCycle.js.
 */

import { createSecretClient } from "../../server/supabase.js";
import { scheduledWeeklyCycle } from "../../server/operations.js";

export async function handler() {
  let db;
  try {
    db = createSecretClient();
  } catch (e) {
    console.error("[run-cycle] not configured:", e.message);
    return { statusCode: 500 };
  }

  try {
    const { body } = await scheduledWeeklyCycle(db, {});
    /* One line per run, and it says what happened to every league it considered - which
     * step ran, or which guard stopped it. A run that skipped all of them is the normal
     * hour and reads as one. */
    console.log("[run-cycle]", JSON.stringify(body));

    /* `ok` is false when a league genuinely failed, or when the run could not even list
     * them - which is what an unapplied migration looks like from in here. Both have to
     * come back NON-2xx, or Netlify records a green run every hour while nothing is
     * happening. That is the lesson pull-stats-scheduled.mjs carries, and it applies
     * three times over to a job that deals rosters and writes standings.
     *
     * A skip is still a success: see server/autoCycle.js for why those are separated. */
    if (!body.ok) {
      console.error("[run-cycle] RUN FAILED:", body.error || body.failed + " league(s)");
      for (const league of body.leagues ?? []) {
        if (league.status === "failed") console.error("[run-cycle] FAILED", league.league, "-", league.why);
      }
      return { statusCode: 500 };
    }
    return { statusCode: 200 };
  } catch (e) {
    /* Never throw out of a scheduled function: a crash is retried and logged as
     * infrastructure noise, where a logged error is something we can actually read. */
    console.error("[run-cycle] unexpected:", e?.stack || e?.message || e);
    return { statusCode: 500 };
  }
}
