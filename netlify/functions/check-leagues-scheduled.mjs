/* The hourly league checker. docs/PLAN-AUTOMATIC-LEAGUES.md, step 3.
 *
 * A PEER OF run-cycle-scheduled.mjs, with the same shape: it reads the secret key from
 * the deployment's own environment and calls server/ directly, so there is no new route
 * into the API and nothing to authenticate. Thin on purpose - the rules are in
 * server/leagueHealth.js and the reading and emailing in server/leagueCheck.js, both
 * tested against a real Postgres.
 *
 * RUNS AT TWENTY PAST, after the weekly cycle at the top of the hour, so it reads what
 * that run left behind. It changes nothing in any league: it records what it found in
 * `league_alerts` and emails the site admins about anything new.
 */

import { createSecretClient } from "../../server/supabase.js";
import { scheduledLeagueCheck } from "../../server/leagueCheck.js";

export async function handler() {
  let db;
  try {
    db = createSecretClient();
  } catch (e) {
    console.error("[league-check] not configured:", e.message);
    return { statusCode: 500 };
  }
  try {
    const summary = await scheduledLeagueCheck(db, {});
    console.log("[league-check]", JSON.stringify(summary));
    return { statusCode: 200 };
  } catch (e) {
    /* Most likely the league_alerts migration has not been applied. Non-2xx so Netlify
     * records a failed run rather than a green one. */
    console.error("[league-check] RUN FAILED:", e?.stack || e?.message || e);
    return { statusCode: 500 };
  }
}
