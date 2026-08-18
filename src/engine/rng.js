/* Pigskin Poker - the randomness seam.
 *
 * THE ONE PERMITTED SIGNATURE CHANGE in the port. The artifact called Math.random()
 * directly inside the engine (PigskinPokerCode.jsx lines 329, 336, 534, 535, 584, 617),
 * which made deals impossible to replay or audit and made tests non-deterministic.
 *
 * Every engine function that needs randomness now takes an `rng` parameter: a function
 * returning a float in [0, 1), exactly like Math.random. It defaults to Math.random, so
 * behaviour is unchanged for any caller that does not pass one.
 *
 * Two things this buys, beyond deterministic tests:
 *   - Phase 2 moves dealing server-side with a seed stored on the period, so a week can
 *     be replayed and audited (fixes P5), and a client cannot re-roll a deal it disliked.
 *   - The demo league seeds identically every time, so bug reports are reproducible.
 *
 * NOTE: the clock is deliberately NOT part of this seam. `nowStamp()` still calls
 * Date.now(). Tests freeze it with vi.setSystemTime(), which is the standard tool and
 * keeps this change to precisely "inject the randomness" and nothing more.
 */

/** The real random source. The default everywhere. */
export const defaultRng = Math.random;

/**
 * mulberry32 - a small, fast, well-distributed seeded PRNG.
 * Chosen because it is ~5 lines, has no dependencies, and is a known-good generator.
 * Any function returning [0, 1) works here; nothing depends on this specific algorithm.
 *
 * @param {number} seed - any 32-bit integer.
 * @returns {() => number} a Math.random-compatible function.
 */
export function seededRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a numeric seed from a string, so a period can store a human-readable seed
 * ("week-1-a3f9") and still produce a deterministic deal.
 */
export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mint a fresh, human-readable seed string for a new period. */
export function newSeed(rng = defaultRng) {
  return Math.floor(rng() * 0xffffffff).toString(36);
}
