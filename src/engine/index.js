/* Pigskin Poker - engine barrel.
 *
 * Everything in src/engine/ is pure, framework-independent JavaScript: no React, no I/O,
 * no network, no storage. It takes state in and returns state or an { error } object.
 * This is the most valuable code in the project and the part that is fully unit tested.
 *
 * The single concession to the outside world is the `rng` parameter (see ./rng.js),
 * which defaults to Math.random. Phase 2 runs this same module server-side so that
 * dealing and scheme resolution are literally the tested code, not a reimplementation.
 */

export * from "./rng.js";
export * from "./constants.js";
export * from "./helpers.js";
export * from "./pool.js";
export * from "./state.js";
export * from "./lineupLock.js";
export * from "./deal.js";
export * from "./schemes.js";
export * from "./scoring.js";
export * from "./standings.js";
export * from "./playoffs.js";
