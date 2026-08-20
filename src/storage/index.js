/* Pigskin Poker - storage entry point.
 *
 * The rest of the app imports from HERE and nowhere deeper. Swapping the backend is a
 * change to this file plus one adapter module - which is what makes "adding real
 * accounts, or a stats feed, is a change to one module" actually true.
 *
 * ONE ADAPTER, deliberately.
 *
 * There used to be two: Supabase, and an in-memory store seeded with a demo league that
 * let `npm run dev` boot with no configuration at all. That was a good trade while the
 * app was the game and nothing else. It stopped being one.
 *
 * The in-memory adapter had no backend, so it could not authenticate anybody - which
 * meant it could only ever exercise the join-code half of `verifySession()`. Everything
 * from Phase 3b onwards - accounts, memberships, invitations, league-scoped RLS,
 * multi-league - existed only in production and in tests, and the fastest development
 * loop was the one that could not run any of it. Worse, it was a second full
 * implementation of every operation, so the rules it enforced could drift from the ones
 * that ship, and the tests covering it reported on code nobody runs.
 *
 * Keeping code-as-login alive in production so that the demo mode could log in was the
 * last thing holding up retiring the hand-rolled `sessions` mechanism, which
 * docs/AUTH.md has always described as the piece most likely to become a permanent
 * security problem.
 *
 * So local development runs the real stack now, and `npm run dev` starts it. See
 * README.md - it is one command, and it needs Docker.
 */

import { createSupabaseStore } from "./supabase.js";

export { loadIdentity, saveIdentity } from "./identity.js";
export { createSupabaseStore } from "./supabase.js";
export { hydrateLeague, vkey } from "./hydrate.js";
export { decomposeLeague } from "./decompose.js";
export { LEAGUE_KEY, IDENTITY_KEY } from "./types.js";

/**
 * Build the store this app instance should use.
 *
 * Only the URL and the PUBLISHABLE key are read here. The secret key is never
 * referenced from src/ - it exists solely in the Netlify Function. Vite would happily
 * inline any VITE_-prefixed variable into the bundle, which is exactly why the secret
 * one is not prefixed.
 */
export function createStore(env = import.meta.env, options = {}) {
  const url = env?.VITE_SUPABASE_URL;
  const publishableKey = env?.VITE_SUPABASE_PUBLISHABLE_KEY;

  /* NO CONFIGURATION MEANS NO APP, in every build.
   *
   * In PRODUCTION the danger is a site that LOOKS entirely healthy - six teams,
   * standings, a week in progress - but is a throwaway copy in each visitor's tab that
   * resets on every refresh and saves nothing. A typo in a Netlify environment variable
   * would have produced exactly that, silently, back when there was something to fall
   * back to.
   *
   * In DEVELOPMENT the danger is subtler and was the reason the fallback went away:
   * working all afternoon against a store that cannot sign anybody in, and only finding
   * out what the real one does at deploy time. */
  if (!(url && publishableKey)) {
    const missing = [
      !url && "VITE_SUPABASE_URL",
      !publishableKey && "VITE_SUPABASE_PUBLISHABLE_KEY",
    ].filter(Boolean);
    const are = missing.length > 1 ? "are" : "is";
    const them = missing.length > 1 ? "them" : "it";

    throw new Error(
      "Pigskin Poker is not configured: " + missing.join(" and ") + " " + are + " missing. " +
      (env?.PROD
        ? "Set " + them + " in your host's environment variables and redeploy."
        : "Start the local stack with `npm run dev`, which writes .env.local for you " +
          "(it needs Docker). See README.md.")
    );
  }

  return createSupabaseStore({
    url,
    publishableKey,
    apiPath: env.VITE_API_PATH || "/api",
    /* RETIRED BY MULTI-LEAGUE, and still read.
     *
     * `/l/<id>` is now how a league is chosen, so naming one in the environment is no
     * longer how this works. It is still honoured because an existing deployment sets
     * it, and an upgrade that needs a dashboard edit to keep working is an upgrade
     * that breaks on a Sunday. It only applies when no league id came from the URL. */
    leagueName: env.VITE_LEAGUE_NAME || null,
    leagueId: options.leagueId ?? null,
  });
}
