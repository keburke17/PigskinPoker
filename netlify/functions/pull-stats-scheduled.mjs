/* The scheduled half of the stats pull. Stage 7 of docs/PHASE-4-PLAN.md.
 *
 * A PEER OF api.mjs, NOT A CLIENT OF IT. This runs inside our own deployment and reads
 * the same secret key from the same environment, so it calls server/operations.js
 * directly. That is the whole reason stage 7 needs no new credential: there is no
 * scheduler token to mint, store, rotate or leak, no new route into the API, and
 * `verifySession` is untouched. A scheduled function authenticating to our own HTTP
 * endpoint with a shared secret would have been a second way in, guarding the same
 * operation, for no benefit.
 *
 * Thin for the same reason api.mjs is thin: the decisions live in server/, where they
 * are tested against a real Postgres without a Netlify runtime in the way. This file
 * maps a cron tick to one function call and writes a log line a human can read.
 *
 * WHAT IT IS ALLOWED TO DO is exactly what the commissioner's button does, for leagues
 * that opted in (`leagues.auto_pull_stats`, default false). It cannot deal, process
 * schemes, lock, or finalize; it does not overwrite a line anybody typed; and it skips
 * any league whose week is not locked and mapped. See server/autoPull.js.
 */

import { createSecretClient } from "../../server/supabase.js";
import { scheduledStatsPull } from "../../server/operations.js";

export async function handler() {
  let db;
  try {
    db = createSecretClient();
  } catch (e) {
    console.error("[pull-stats] not configured:", e.message);
    return { statusCode: 500 };
  }

  try {
    const { body } = await scheduledStatsPull(db, {});
    /* One line per run, and it says what happened to every league it considered.
     * A run that skipped all of them is the normal Tuesday and reads as one. */
    console.log("[pull-stats]", JSON.stringify(body));
    for (const league of body.leagues ?? []) {
      if (league.status === "failed") console.error("[pull-stats] FAILED", league.league, "-", league.why);
    }
    return { statusCode: 200 };
  } catch (e) {
    /* Never throw out of a scheduled function: a crash is retried and logged as
     * infrastructure noise, where a logged error is something we can actually read. */
    console.error("[pull-stats] unexpected:", e?.stack || e?.message || e);
    return { statusCode: 500 };
  }
}
