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

/* The code rule and its normalization live in src/storage/codePolicy.js so the browser
 * and the server cannot disagree about what a valid code is - see the note there.
 * server/ importing from src/ is the allowed direction; the reverse never is. */
import { CODE_POLICY, normalizeCode, validateCode } from "../src/storage/codePolicy.js";

export { CODE_POLICY, validateCode };

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, saltBytes: 16 };
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days; a league season is long

/* Idle expiry, added in Phase 3a. The absolute cap above answers "how long may a
 * session live"; it never answered "how long may an ABANDONED one live". A token left
 * on a borrowed phone or a library computer stayed valid for a month of not being
 * touched.
 *
 * 14 days is chosen against the actual usage pattern: this league logs in weekly. Two
 * weeks is a bye plus a miss, so an active manager is never signed out mid-season,
 * while a genuinely forgotten session dies well before the 30-day cap.
 *
 * The refresh below is what makes that true - without it, idle expiry would sign
 * everyone out on day 14 regardless of use. */
const SESSION_IDLE_MS = 14 * 24 * 60 * 60 * 1000;

/* Refreshing `last_used_at` on EVERY verified request would mean a database write on
 * every privileged action, purely to move a timestamp a few seconds. The refresh is
 * therefore coarse: only write when the stored value is more than an hour old. That
 * costs at most one hour of idle-expiry precision against a 14-day window, and saves
 * a write on effectively every request. */
const SESSION_REFRESH_AFTER_MS = 60 * 60 * 1000;

/** Format: scrypt$N$r$p$saltHex$hashHex */
export function hashCode(code) {
  const salt = crypto.randomBytes(SCRYPT.saltBytes);
  const hash = crypto.scryptSync(normalizeCode(code), salt, SCRYPT.keylen, {
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
    const actual = crypto.scryptSync(normalizeCode(code), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ------------------------------- sessions -------------------------------- */

/* The token is 32 random bytes - already high entropy, so it is stored as a plain
 * SHA-256 (fast, and there is nothing to brute-force). Only the hash is persisted;
 * the token itself exists only in the caller's browser. */
const tokenHash = (token) => crypto.createHash("sha256").update(token).digest("hex");

export async function createSession(db, { leagueId, role, teamId = null }) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const now = new Date().toISOString();
  const { error } = await db.from("sessions").insert({
    token_hash: tokenHash(token),
    league_id: leagueId,
    role,
    team_id: teamId,
    expires_at: expiresAt,
    last_used_at: now,
  });
  if (error) throw new Error("Could not create session: " + error.message);
  return { token, expiresAt };
}

/**
 * Resolve EITHER credential to the same answer.
 *
 * This is the hinge of the whole accounts migration. A join-code session token and a
 * Supabase JWT are completely different objects, but every caller downstream only wants
 * to know {leagueId, role, teamId} - so this is the one place that has to know there
 * are two kinds of sign-in at all. Nothing in server/operations.js changes.
 *
 * That is what lets the league carry on typing codes while people move to accounts one
 * at a time, at whatever pace they like, instead of everyone being cut over on a
 * Tuesday. Code-as-login is switched off only when everyone has an account, at a season
 * boundary.
 *
 * @param {string} token   a join-code session token, or a Supabase access token
 * @param {object} [opts]
 * @param {string} [opts.leagueId]  which league the caller is asking about. Required to
 *   resolve a JWT, because an account's role lives on league_members and a person can
 *   be a commissioner in one league and a manager in another.
 * @returns {{leagueId, role, teamId, userId}|null}
 */
export async function verifySession(db, token, { leagueId = null } = {}) {
  if (!token || typeof token !== "string") return null;
  /* Which kind of credential is this? Decided on SHAPE rather than by trying one lookup
   * and falling back to the other: a JWT is three base64url segments separated by dots,
   * a session token is 64 hex characters, and neither can be mistaken for the other.
   * Guessing wrong costs a wasted round trip on every single request. */
  if (token.includes(".")) return verifyAccountToken(db, token, leagueId);
  return verifyCodeSession(db, token);
}

/** The Phase 2c credential: a random token, stored only as its SHA-256. */
async function verifyCodeSession(db, token) {
  const hash = tokenHash(token);
  const { data, error } = await db
    .from("sessions")
    .select("league_id, role, team_id, expires_at, last_used_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) return null;

  const now = Date.now();
  if (new Date(data.expires_at).getTime() < now) return null;

  /* Idle expiry. An expired-by-idleness row is DELETED rather than left to rot: it can
   * never become valid again, and leaving it means the sessions table grows a tail of
   * dead rows that only the 30-day cap ever clears. */
  const lastUsed = new Date(data.last_used_at ?? data.expires_at).getTime();
  if (now - lastUsed > SESSION_IDLE_MS) {
    await db.from("sessions").delete().eq("token_hash", hash);
    return null;
  }

  if (now - lastUsed > SESSION_REFRESH_AFTER_MS) {
    // Best effort. A failed refresh must not fail an otherwise valid request - the
    // worst case is that the session expires by idleness slightly early.
    await db.from("sessions").update({ last_used_at: new Date(now).toISOString() }).eq("token_hash", hash);
  }

  return { leagueId: data.league_id, role: data.role, teamId: data.team_id, userId: null };
}

/* The Phase 3c credential: a real account.
 *
 * Verification is delegated to Supabase rather than done here with the JWT secret.
 * Checking a signature locally would miss the things that actually matter in practice -
 * a revoked session, a deleted user, a rotated signing key - and would be one more
 * piece of security-critical code to keep correct. The cost is a round trip; the
 * benefit is that revocation works.
 *
 * The ROLE does not come from the token. Supabase says who you are; league_members says
 * what you may do, which is the separation that makes multi-league possible at all. A
 * valid account with no membership in this league is correctly nobody here. */
async function verifyAccountToken(db, token, leagueId) {
  if (!leagueId) return null; // cannot resolve a role without knowing the league

  const { data, error } = await db.auth.getUser(token);
  const user = data?.user;
  if (error || !user) return null;

  const { data: member } = await db
    .from("league_members")
    .select("league_id, role, team_id")
    .eq("user_id", user.id)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (!member) return null;

  return {
    leagueId: member.league_id,
    role: member.role,
    teamId: member.team_id,
    userId: user.id,
  };
}

export async function destroySession(db, token) {
  if (!token) return;
  await db.from("sessions").delete().eq("token_hash", tokenHash(token));
}

/* Every session belonging to one team, signed out at once.
 *
 * This is what makes rotating a join code MEAN something. Before Phase 3a, a
 * commissioner who changed a team's code - which is the "someone should no longer have
 * this" action, there is no other reason to do it - left the person he was removing
 * holding a token valid for another 30 days. The rotation looked like it worked and
 * did nothing.
 *
 * It is also the mechanism behind the commissioner's explicit "sign out this team's
 * devices" action, for the phone-left-at-a-bar case where the code itself is fine. */
export async function destroySessionsForTeam(db, teamUuid) {
  if (!teamUuid) return 0;
  const { data, error } = await db.from("sessions").delete().eq("team_id", teamUuid).select("id");
  if (error) throw new Error("Could not sign out that team: " + error.message);
  return data?.length ?? 0;
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
  badCodePolicy: { status: 400 },
};
