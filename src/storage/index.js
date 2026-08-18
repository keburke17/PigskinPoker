/* Pigskin Poker - storage entry point.
 *
 * The rest of the app imports from HERE and nowhere deeper. Swapping the backend is a
 * change to this file plus one new adapter module - which is the whole point of the
 * layer, and what makes "adding real accounts or a stats feed is a change to one
 * module" true.
 *
 * Phase 1 ships one adapter: in-memory, seeded with the demo league.
 * Phase 2 adds the Supabase adapter and selects on configuration.
 */

import { createMemoryStore } from "./memory.js";
import { createDemoLeague } from "./demoLeague.js";

export { loadIdentity, saveIdentity } from "./identity.js";
export { createMemoryStore } from "./memory.js";
export { createDemoLeague, DEMO_COMMISSIONER_CODE, DEMO_TEAM_CODE_PREFIX } from "./demoLeague.js";
export { LEAGUE_KEY, IDENTITY_KEY } from "./types.js";

/**
 * Build the store this app instance should use.
 *
 * Phase 2 will read configuration here and return the Supabase adapter when it is
 * present, falling back to memory when it is not. Deliberately not stubbed out yet -
 * docs/DATA-MODEL.md section 6 defines the shape it has to take, and guessing at it now
 * would just have to be undone.
 */
export function createStore() {
  return createMemoryStore(createDemoLeague());
}
