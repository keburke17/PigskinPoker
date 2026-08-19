/* Pigskin Poker - storage entry point.
 *
 * The rest of the app imports from HERE and nowhere deeper. Swapping the backend is a
 * change to this file plus one adapter module - which is what makes "adding real
 * accounts, or a stats feed, is a change to one module" actually true.
 *
 * Phase 2b ships one adapter: in-memory over normalized rows, seeded with the demo
 * league. Phase 2c adds the Supabase adapter and selects on configuration.
 */

import { createMemoryStore } from "./memory.js";
import { createSupabaseStore } from "./supabase.js";
import { createDemoLeague, DEMO_COMMISSIONER_CODE } from "./demoLeague.js";
import { decomposeLeague } from "./decompose.js";

export { loadIdentity, saveIdentity } from "./identity.js";
export { createMemoryStore } from "./memory.js";
export { createSupabaseStore, loadSessionToken, saveSessionToken } from "./supabase.js";
export { hydrateLeague, vkey } from "./hydrate.js";
export { decomposeLeague } from "./decompose.js";
export { createDemoLeague, DEMO_COMMISSIONER_CODE, DEMO_TEAM_CODE_PREFIX } from "./demoLeague.js";
export { LEAGUE_KEY, IDENTITY_KEY } from "./types.js";

/** Build the demo league as normalized rows, plus its (fake, local-only) codes. */
export function createDemoRows() {
  const blob = createDemoLeague();
  const db = decomposeLeague(blob, {
    leagueKey: "demo",
    year: 2026,
    hashCode: () => "in-memory-unused",
  });
  const codes = {
    commissioner: DEMO_COMMISSIONER_CODE,
    teams: Object.fromEntries(blob.teams.map((t) => [t.id, t.joinCode])),
  };
  return { db, codes };
}

/**
 * Build the store this app instance should use.
 *
 * Supabase when it is configured; the in-memory demo league when it is not. That
 * fallback is not a stub - it is how `npm run dev` gives anyone a working, populated
 * app with no backend at all, and it is the same code path the tests exercise.
 *
 * Only the URL and the PUBLISHABLE key are read here. The secret key is never
 * referenced from src/ - it exists solely in the Netlify Function. Vite would happily
 * inline any VITE_-prefixed variable into the bundle, which is exactly why the secret
 * one is not prefixed.
 */
export function createStore(env = import.meta.env, options = {}) {
  const url = env?.VITE_SUPABASE_URL;
  const publishableKey = env?.VITE_SUPABASE_PUBLISHABLE_KEY;

  /* A PRODUCTION build with no Supabase configuration must fail loudly.
   *
   * Falling back to the in-memory demo here would deploy a site that LOOKS entirely
   * healthy - six teams, standings, a week in progress - but is a throwaway copy in
   * each visitor's tab that resets on every refresh and saves nothing. A typo in a
   * Netlify environment variable would produce exactly that, silently. Better to
   * refuse to start and say which variable is missing. */
  if (env?.PROD && !(url && publishableKey)) {
    const missing = [
      !url && "VITE_SUPABASE_URL",
      !publishableKey && "VITE_SUPABASE_PUBLISHABLE_KEY",
    ].filter(Boolean);
    throw new Error(
      "Pigskin Poker is not configured: " + missing.join(" and ") + " " +
      (missing.length > 1 ? "are" : "is") + " missing. Set " +
      (missing.length > 1 ? "them" : "it") + " in your host's environment variables " +
      "and redeploy. (Refusing to fall back to the in-memory demo league in production.)"
    );
  }

  if (url && publishableKey) {
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

  const { db, codes } = createDemoRows();
  return createMemoryStore(db, { codes, leagueKey: "demo", year: 2026 });
}
