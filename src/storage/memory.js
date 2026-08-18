/* In-memory league store.
 *
 * Two jobs:
 *   1. `npm run dev` works with no Supabase running at all - the fastest possible loop
 *      for pure UI work, and how anyone new gets a populated app in one command.
 *   2. It is the test double. Same interface, same result shapes, same version
 *      semantics as the real adapter, so Phase 2's concurrency path can be tested
 *      before Supabase is in the picture.
 *
 * State lives in a module-level variable, so it survives hot reloads within a session
 * but resets on a full page refresh. That is intentional: refresh is the reset button.
 */

import { deepClone } from "../engine/index.js";

/** @returns {import("./types.js").LeagueStore} */
export function createMemoryStore(initialState = null, opts = {}) {
  let state = initialState ? deepClone(initialState) : null;
  let version = initialState ? 1 : 0;
  const latency = opts.latencyMs ?? 0;

  const wait = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());

  return {
    async loadLeague() {
      await wait();
      if (opts.failLoad) throw new Error(opts.failLoad);
      if (state === null) return null; // no league yet - safe to start fresh
      return { state: deepClone(state), version };
    },

    async saveLeague(next, expectedVersion) {
      await wait();
      if (opts.failSave) throw new Error(opts.failSave);
      // Optimistic concurrency. The in-memory store is single-client in normal use, so
      // this only fires in tests - which is the point: Phase 2 needs this path proven.
      if (expectedVersion != null && expectedVersion !== version) {
        return { ok: false, reason: "stale", version, state: deepClone(state) };
      }
      state = deepClone(next);
      version += 1;
      return { ok: true, version };
    },

    /** Test/debug helper. Not part of the LeagueStore interface. */
    _peek() {
      return state === null ? null : deepClone(state);
    },
  };
}
