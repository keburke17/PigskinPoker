/* Secret hashing. Server-only - NEVER import this from src/.
 *
 * One consumer now: invite secrets (server/invites.js). It used to live in
 * server/auth.js and serve join codes as well; those are gone, and hashing had no
 * business staying in a file that no longer stores a secret of its own.
 *
 * KDF: scrypt, from node:crypto. No dependency, memory-hard, and the standard library
 * choice for this. The parameters are deliberately modest because these are short
 * shared codes typed by a dozen people, not passwords - N=16384 keeps a redemption well
 * under 100ms on a cold function while still making offline guessing expensive.
 */

import crypto from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, saltBytes: 16 };

/** Codes are typed by people, on phones. Case and surrounding space are never meaningful. */
const normalize = (s) => String(s ?? "").trim().toUpperCase();

/** Format: scrypt$N$r$p$saltHex$hashHex */
export function hashSecret(secret) {
  const salt = crypto.randomBytes(SCRYPT.saltBytes);
  const hash = crypto.scryptSync(normalize(secret), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("hex"), hash.toString("hex")].join("$");
}

/**
 * Constant-time comparison against a stored hash.
 *
 * The parameters come from the STORED string rather than the constants above, so a hash
 * written under different settings still verifies. Changing SCRYPT later must not lock
 * out every invite issued before the change.
 */
export function verifySecret(secret, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltHex, hashHex] = parts;
  let computed;
  try {
    computed = crypto.scryptSync(normalize(secret), Buffer.from(saltHex, "hex"), hashHex.length / 2, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  if (computed.length !== expected.length) return false;
  return crypto.timingSafeEqual(computed, expected);
}
