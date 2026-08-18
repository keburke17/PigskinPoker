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
import { createDemoLeague, DEMO_COMMISSIONER_CODE } from "./demoLeague.js";
import { decomposeLeague } from "./decompose.js";

export { loadIdentity, saveIdentity } from "./identity.js";
export { createMemoryStore } from "./memory.js";
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
 * Phase 2c reads configuration here and returns the Supabase adapter when it is
 * present, falling back to memory when it is not. Deliberately not stubbed yet -
 * docs/DATA-MODEL.md section 6 defines the shape, and guessing now would be undone.
 */
export function createStore() {
  const { db, codes } = createDemoRows();
  return createMemoryStore(db, { codes, leagueKey: "demo", year: 2026 });
}
