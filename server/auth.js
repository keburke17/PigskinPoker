/* Server-side authentication. NEVER import this from src/ - it runs only in a
 * Netlify Function, holding the secret key.
 *
 * This is Phase 3's enforcement, borrowed forward into Phase 2c on purpose: Phase 2
 * needs manager writes authorized somewhere, and shipping a half-enforced write path
 * is worse than doing auth once, properly.
 *
 * WHAT CHANGED FROM THE ARTIFACT (fixes P2):
 *   Before - commissionerCode and each team's joinCode were stored INSIDE the league
 *            blob and compared in the browser. Every visitor downloaded all of them,
 *            and `isCommissioner` only decided what UI rendered; nothing stopped a
 *            client writing whatever it liked.
 *   Now    - codes are stored hashed, in tables the publishable key cannot read, and
 *            verified here. A successful login returns an opaque session token; every
 *            privileged write re-checks it. The LOGIN EXPERIENCE is unchanged - the
 *            league still just types a code.
 *
 * KDF: scrypt, from node:crypto. No dependency, memory-hard, and the standard library
 * choice for this. Parameters below are deliberately modest because these are short
 * shared codes typed by a dozen people, not passwords - N=16384 keeps a login well
 * under 100ms on a cold function while still making offline guessing expensive.
 */

import crypto from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, saltBytes: 16 };
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days; a league season is long

/** Format: scrypt$N$r$p$saltHex$hashHex */
export function hashCode(code) {
  const salt = crypto.randomBytes(SCRYPT.saltBytes);
  const hash = crypto.scryptSync(normalize(code), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("hex"), hash.toString("hex")].join("$");
}

/** Constant-time verification. Returns false for anything malformed rather than throwing. */
export function verifyCode(code, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltHex, hashHex] = parts;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(normalize(code), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* Codes are shared, spoken aloud and typed on phones. Trim and case-fold so
 * "demo-commish " logs in the same as "DEMO-COMMISH" - this is a usability decision,
 * applied identically at hash time and verify time so the two can never disagree. */
function normalize(code) {
  return String(code ?? "").trim().toUpperCase();
}

/* ------------------------------- sessions -------------------------------- */

/* The token is 32 random bytes - already high entropy, so it is stored as a plain
 * SHA-256 (fast, and there is nothing to brute-force). Only the hash is persisted;
 * the token itself exists only in the caller's browser. */
const tokenHash = (token) => crypto.createHash("sha256").update(token).digest("hex");

export async function createSession(db, { leagueId, role, teamId = null }) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { error } = await db.from("sessions").insert({
    token_hash: tokenHash(token),
    league_id: leagueId,
    role,
    team_id: teamId,
    expires_at: expiresAt,
  });
  if (error) throw new Error("Could not create session: " + error.message);
  return { token, expiresAt };
}

/** @returns {{leagueId, role, teamId}|null} */
export async function verifySession(db, token) {
  if (!token || typeof token !== "string") return null;
  const { data, error } = await db
    .from("sessions")
    .select("league_id, role, team_id, expires_at")
    .eq("token_hash", tokenHash(token))
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return { leagueId: data.league_id, role: data.role, teamId: data.team_id };
}

export async function destroySession(db, token) {
  if (!token) return;
  await db.from("sessions").delete().eq("token_hash", tokenHash(token));
}

/* ------------------------------ authorization ---------------------------- */

/* The rules the artifact only expressed as UI conditionals. These are the real ones. */
export const isCommissioner = (session) => !!session && session.role === "commissioner";

/** A manager may only act on their own team. The commissioner may act on any. */
export function canActForTeam(session, teamUuid) {
  if (!session) return false;
  if (session.role === "commissioner") return true;
  return session.role === "manager" && session.teamId === teamUuid;
}

export const AUTH_ERRORS = {
  noSession: { status: 401, error: "Not signed in." },
  notCommissioner: { status: 403, error: "Only the commissioner can do that." },
  notYourTeam: { status: 403, error: "You can only change your own team." },
  badCode: { status: 401, error: "Incorrect code." },
};
