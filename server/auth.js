/* Server-side authentication. NEVER import this from src/ - it runs only in a
 * Netlify Function, holding the secret key.
 *
 * ONE CREDENTIAL: a real account.
 *
 * There used to be two. Phase 2c introduced hashed join codes verified here, returning
 * an opaque session token stored in a hand-rolled `sessions` table - a big improvement
 * on the artifact, where every visitor's browser downloaded every code and
 * `isCommissioner` merely decided what UI rendered. Phase 3b/3c then added Supabase
 * accounts beside it, and `verifySession` resolved either to the same shape.
 *
 * Both halves are now gone except the account one, and that is the whole point:
 *
 *   - docs/AUTH.md always described the hand-rolled sessions table as the piece most
 *     likely to become a permanent security problem. Hand-rolled auth that quietly
 *     becomes load-bearing is a normal way for a project like this to end up with one.
 *   - a join code IS the identity, so sharing it is account sharing, rotating it signs
 *     people out, and it cannot be read back to whoever lost it. An invitation
 *     authorizes ONE join and is then spent, which is what people actually wanted.
 *   - the only thing keeping code-login alive was the in-memory adapter, which needed
 *     something it could check without a backend. That adapter is gone.
 *
 * So: Supabase says WHO you are, `league_members` says WHAT YOU MAY DO, and nothing in
 * this file hashes, stores or compares a secret of our own.
 */

/* Idle expiry, absolute TTL, refresh windows and the login rate limiter all went with
 * the sessions table. Supabase issues, refreshes and revokes access tokens, and rate
 * limits its own sign-in endpoints - see [auth.rate_limit] in supabase/config.toml. */

/**
 * Resolve a request's credential to what it may do IN ONE LEAGUE.
 *
 * `leagueId` is required, not optional: an account's role lives on `league_members`,
 * and a person can be a commissioner in one league and a manager in another. There is
 * no league-independent answer to "what is this person".
 *
 * Verification is delegated to Supabase rather than done here with the JWT secret.
 * Checking a signature locally would miss the things that actually matter in practice -
 * a revoked session, a deleted user, a rotated signing key - and would be one more
 * piece of security-critical code to keep correct. The cost is a round trip; the
 * benefit is that revocation works.
 *
 * The ROLE never comes from the token. A perfectly valid account that nobody invited is
 * correctly nobody in this league, which is what makes multi-league safe.
 *
 * @returns {{leagueId, role, teamId, userId}|null}
 */
export async function verifySession(db, token, { leagueId = null } = {}) {
  if (!token || typeof token !== "string") return null;
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

/**
 * Who is this, independent of any league? Used only where there is genuinely no league
 * yet - creating one, listing your own, redeeming an invitation into one.
 *
 * @returns {{id, email}|null}  `id` is the auth.users uuid, which is what every
 *   membership, profile and invite redemption is keyed on.
 */
export async function verifyAccount(db, token) {
  if (!token || typeof token !== "string") return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
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
};
