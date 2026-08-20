/* Pigskin Poker - the persistence interface.
 *
 * NOTHING OUTSIDE src/storage/ MAY KNOW HOW DATA IS STORED. The app talks to this
 * interface only; window.storage does not appear anywhere in src/.
 *
 * ---------------------------------------------------------------------------
 * PHASE 1 SCOPE - read this before "improving" the shape.
 * ---------------------------------------------------------------------------
 * This interface is deliberately BLOB-SHAPED (loadLeague / saveLeague over the whole
 * state object), because that is a drop-in replacement for the artifact's
 * window.storage and it keeps the Phase 1 move mechanical. It is NOT the final shape.
 *
 * docs/DATA-MODEL.md concluded that the schema decomposes into real tables, so Phase 2
 * replaces this with an OPERATION-SHAPED interface - submitScheme, swapLineupSlot,
 * setStatLine, dealPeriod, finalizePeriod - where each call writes only what it touches.
 * That is what actually fixes P1 (silent clobbering) and P3 (write amplification); a
 * whole-state save() on Postgres would just recreate the artifact's problem.
 *
 * The `version` plumbing below carries that optimistic-concurrency path: every
 * fine-grained write sends the version it was based on, and a write whose version has
 * moved is rejected rather than merged or forced.
 *
 * ---------------------------------------------------------------------------
 * @typedef {Object} LeagueStore
 * @property {() => Promise<{state: object, version: number} | null>} loadLeague
 *   Resolves null when no league exists yet (a genuinely new league - safe to start
 *   fresh). REJECTS on any other failure. That distinction is load-bearing: see the
 *   note on refusing to start blank in src/App.jsx.
 * @property {(state: object, expectedVersion?: number) => Promise<SaveResult>} saveLeague
 *
 * @typedef {{ok: true, version: number}
 *         | {ok: false, reason: "stale", version: number, state: object}} SaveResult
 */

export const LEAGUE_KEY = "pigskin_league_state_v1";
export const IDENTITY_KEY = "pigskin_my_identity_v1";
