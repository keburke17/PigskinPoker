/* Which feed a refresh reads from.
 *
 * There are two: ./nflverse.js, the live one, and ./fixture.js, a recording of it that
 * makes local development deterministic and lets the stats half be built before the
 * season has produced any stats at all.
 *
 * THE FIXTURE MUST NEVER SERVE PRODUCTION, and "we set the variable correctly" is not a
 * guarantee - it is a thing someone can get wrong once, in a Netlify environment nobody
 * looks at again, and the symptom would be a refresh that reports success and freezes
 * the league's pool at whatever the recording says. So the environment variable is not
 * sufficient on its own: the database this process is talking to must ALSO be local.
 * That check is not a warning, it is the gate, and tests/feed.test.js asserts it holds
 * with the variable set.
 */

import { isLocalUrl } from "../localUrl.js";

export const FEED_ENV = "PIGSKIN_FEED";

/**
 * Which feed this environment gets, and why - so a caller can say it out loud rather
 * than leaving people to guess which data they are looking at.
 *
 * @returns {{ feed: "fixture"|"live", why: string }}
 */
export function feedChoice(env = process.env) {
  const asked = String(env[FEED_ENV] || "").toLowerCase();
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  if (asked !== "fixture") {
    return { feed: "live", why: asked ? "PIGSKIN_FEED=" + asked : "the default" };
  }
  if (!isLocalUrl(url)) {
    return {
      feed: "live",
      why: "PIGSKIN_FEED=fixture was IGNORED - the database is not local (" + (url || "unset") + ")",
    };
  }
  return { feed: "fixture", why: "PIGSKIN_FEED=fixture against a local database" };
}

/** The chosen feed module. Imported lazily: a request that never refreshes loads neither. */
export async function selectFeed(env = process.env) {
  return feedChoice(env).feed === "fixture"
    ? await import("./fixture.js")
    : await import("./nflverse.js");
}
