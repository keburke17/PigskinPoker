/* Deterministic UUIDs.
 *
 * Why not gen_random_uuid(): the seed file is generated and committed, and the Phase 5
 * importer must be re-runnable. Random ids would churn the seed's git diff on every
 * regeneration and make an interrupted import impossible to resume safely.
 *
 * These are stable v5-style ids derived from (namespace, key). Not cryptographic - they
 * only need to be stable and collision-free across a few hundred rows per league.
 */

/** 32-bit FNV-1a. */
function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const hex8 = (n) => (n >>> 0).toString(16).padStart(8, "0");

/**
 * A stable RFC-4122-shaped UUID (version 5, variant 10xx) for a namespace + key.
 * Same inputs always give the same id; different inputs effectively never collide.
 */
export function stableUuid(namespace, key) {
  const s = namespace + " " + key;
  const a = fnv1a(s, 0x811c9dc5);
  const b = fnv1a(s, 0x01000193);
  const c = fnv1a(s + "#2", 0x9e3779b9);
  const d = fnv1a(s + "#3", 0x85ebca6b);

  const h = hex8(a) + hex8(b) + hex8(c) + hex8(d); // 32 hex chars
  const version = "5" + h.slice(13, 16);           // version 5 nibble
  const variantNibble = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const variant = variantNibble + h.slice(17, 20); // variant 10xx

  return [h.slice(0, 8), h.slice(8, 12), version, variant, h.slice(20, 32)].join("-");
}
