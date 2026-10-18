/* The scheduled injury pull. OQ-29.
 *
 * A PEER OF api.mjs, NOT A CLIENT OF IT - the same shape as pull-stats-scheduled.mjs, for
 * the same reasons: it holds the secret key already, so it calls server/operations.js
 * directly, with no scheduler token and no new way into the API.
 *
 * WHAT IT IS ALLOWED TO DO: write the NFL injury report onto every league's players. That
 * is a label beside a name. It cannot deal, process schemes, lock, score or finalize, and
 * it never touches `players.status` - the field the deal reads. See server/injuries.js.
 */

import { createSecretClient } from "../../server/supabase.js";
import { scheduledInjuryPull } from "../../server/operations.js";

export async function handler() {
  let db;
  try {
    db = createSecretClient();
  } catch (e) {
    console.error("[pull-injuries] not configured:", e.message);
    return { statusCode: 500 };
  }

  try {
    const { body } = await scheduledInjuryPull(db, {});
    console.log("[pull-injuries]", JSON.stringify(body));
    /* Non-2xx on a real failure, or Netlify records a green run while nothing happens -
     * the reasoning is in pull-stats-scheduled.mjs. A skipped league is still a success. */
    if (!body.ok) {
      console.error("[pull-injuries] RUN FAILED:", body.error || body.failed + " league(s)");
      for (const league of body.leagues ?? []) {
        if (league.status === "failed") console.error("[pull-injuries] FAILED", league.league, "-", league.why);
      }
      return { statusCode: 500 };
    }
    return { statusCode: 200 };
  } catch (e) {
    console.error("[pull-injuries] unexpected:", e?.stack || e?.message || e);
    return { statusCode: 500 };
  }
}
