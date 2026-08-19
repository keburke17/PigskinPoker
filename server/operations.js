/* Privileged operations. The ONLY place league state is written.
 *
 * Fixes P2. In the artifact these rules existed solely as UI conditionals - a client
 * that ignored the UI could write anything. Here every operation:
 *
 *   1. verifies the session token,
 *   2. authorizes it (commissioner-only, or manager-owns-this-team),
 *   3. checks the period is in a phase where the action is legal,
 *   4. checks the caller's write is based on the current version,
 *   5. and only then writes.
 *
 * Steps 3 and 4 do different jobs. A version catches "we both edited the same thing".
 * A phase check catches "the world moved on" - a finalize landing while someone is
 * mid-edit - which a version alone would miss.
 *
 * DEALING AND SCHEME RESOLUTION HAPPEN HERE, NOT IN THE BROWSER (fixes P5). The seed is
 * minted server-side and stored on the period, so a week can be replayed and audited,
 * and a client cannot re-roll a deal it did not like.
 */

import { createDefaultState } from "../src/engine/index.js";
import { decomposeLeague } from "../src/storage/decompose.js";
import {
  dealRosters,
  finalizeCurrentPeriod,
  newSeed,
  processSchemes as engineProcessSchemes,
  seedFromString,
  seededRng,
  startPlayoffs as engineStartPlayoffs,
} from "../src/engine/index.js";
import { vkey } from "../src/storage/hydrate.js";
import { fetchLeagueRows, hydrate, persistBlob } from "./league.js";
import {
  generateInviteCode,
  hashInviteSecret,
  inviteProblem,
  parseInviteCode,
  verifyInviteSecret,
} from "./invites.js";
import {
  AUTH_ERRORS,
  canActForTeam,
  createSession,
  destroySession,
  destroySessionsForTeam,
  hashCode,
  isCommissioner,
  validateCode,
  verifyCode,
  verifySession,
} from "./auth.js";
import {
  THROTTLED,
  checkThrottle,
  clearBuckets,
  ipBucket,
  leagueBucket,
  recordFailure,
  teamBucket,
} from "./throttle.js";

const PHASE_RULES = {
  dealPeriod: ["pre-deal"],
  submitScheme: ["dealt"],
  swapLineupSlot: ["dealt", "schemes-processed"],
  processSchemes: ["dealt"],
  setStatLine: ["schemes-processed", "stats"],
  toggleSlotLock: ["schemes-processed", "stats"],
  toggleRosterLock: ["dealt", "schemes-processed", "stats"],
  finalizePeriod: ["schemes-processed", "stats"],
};

const fail = (status, error, extra = {}) => ({ status, body: { ok: false, error, ...extra } });
const good = (body) => ({ status: 200, body: { ok: true, ...body } });

/* ------------------------------- context -------------------------------- */

async function context(db, leagueId, token) {
  const session = await verifySession(db, token, { leagueId });
  // Distinguish "not signed in" from "signed in but not allowed". The client reacts
  // differently: a 401 means log in again, a 403 means you never could.
  if (!session) return { error: fail(AUTH_ERRORS.noSession.status, AUTH_ERRORS.noSession.error) };
  const rows = await fetchLeagueRows(db, leagueId);
  if (!rows) return { error: fail(404, "League not found.") };
  const view = hydrate(rows);
  const period = rows.periods.find((p) => p.id === view?._meta?.periodId) ?? null;
  return { session, rows, view, period };
}

function guard(ctx, opName, expect, keys) {
  const { view, period } = ctx;
  const allowed = PHASE_RULES[opName];
  if (allowed && period && !allowed.includes(period.phase)) {
    return fail(409, "This week has moved on (it is now '" + period.phase + "'). Your change wasn't saved.", {
      reason: "phase",
      phase: period.phase,
      view,
    });
  }
  for (const key of keys ?? []) {
    if (expect == null || expect[key] == null) continue;
    const actual = view._meta.versions[key];
    if (actual != null && actual !== expect[key]) {
      return fail(409, "Someone else just updated the league - reloaded.", {
        reason: "stale",
        key,
        view,
      });
    }
  }
  return null;
}

const teamRow = (rows, legacyId) => rows.teams.find((t) => t.legacy_id === legacyId) ?? null;
const playerRow = (rows, legacyId) =>
  legacyId == null ? null : (rows.players.find((p) => p.legacy_id === legacyId) ?? null);

/* --------------------------------- auth ---------------------------------- */

/* `ip` comes from the Netlify edge (x-nf-client-connection-ip), plumbed through
 * netlify/functions/api.mjs. It is optional everywhere: the operations are unit-tested
 * directly, with no HTTP layer to supply one, and a missing address simply means the
 * per-IP bucket is not counted while the per-target bucket still is. */
export async function loginCommissioner(db, { leagueId, code, ip = null }) {
  /* CHECKED BEFORE ANY WORK, and before scrypt above all. scrypt is the expensive
   * part by design, which makes it the thing an attacker is trying to spend on our
   * behalf as well as the thing slowing him down. */
  const buckets = [ipBucket(ip), leagueBucket(leagueId)];
  const throttled = await checkThrottle(db, buckets);
  if (throttled) return fail(THROTTLED.status, THROTTLED.error, { retryAfter: throttled.retryAfterSeconds });

  const { data } = await db
    .from("league_secrets")
    .select("commissioner_code_hash")
    .eq("league_id", leagueId)
    .maybeSingle();
  if (!data || !verifyCode(code, data.commissioner_code_hash)) {
    await recordFailure(db, buckets);
    return fail(AUTH_ERRORS.badCode.status, AUTH_ERRORS.badCode.error);
  }
  // Getting it right wipes the slate: four mistyped codes then a correct one leaves no
  // strike behind.
  await clearBuckets(db, buckets);
  const { token, expiresAt } = await createSession(db, { leagueId, role: "commissioner" });
  return good({ token, expiresAt, role: "commissioner", teamId: null });
}

export async function loginManager(db, { leagueId, teamLegacyId, code, ip = null }) {
  const buckets = [ipBucket(ip), teamBucket(leagueId, teamLegacyId)];
  const throttled = await checkThrottle(db, buckets);
  if (throttled) return fail(THROTTLED.status, THROTTLED.error, { retryAfter: throttled.retryAfterSeconds });

  const rows = await fetchLeagueRows(db, leagueId);
  if (!rows) return fail(404, "League not found.");
  const team = teamRow(rows, teamLegacyId);
  /* A bad team id is NOT counted as a failed attempt. It is a 404 about the shape of
   * the request, not a wrong guess at a credential, and counting it would let a typo
   * in a link burn someone's allowance. */
  if (!team) return fail(404, "That team doesn't exist.");

  const { data } = await db
    .from("team_secrets")
    .select("join_code_hash")
    .eq("team_id", team.id)
    .maybeSingle();
  if (!data) {
    return fail(401, "This team doesn't have a join code set yet - ask your commissioner to set one.");
  }
  if (!verifyCode(code, data.join_code_hash)) {
    await recordFailure(db, buckets);
    return fail(AUTH_ERRORS.badCode.status, AUTH_ERRORS.badCode.error);
  }
  await clearBuckets(db, buckets);
  const { token, expiresAt } = await createSession(db, {
    leagueId,
    role: "manager",
    teamId: team.id,
  });
  return good({ token, expiresAt, role: "manager", teamId: teamLegacyId });
}

export async function logout(db, { token }) {
  await destroySession(db, token);
  return good({});
}

/* ----------------------------- accounts ---------------------------------- */

/**
 * Who is this token, and what may it do?
 *
 * Needed because an ACCOUNT does not carry its role. A join-code login answers "which
 * team am I" in its own response - the code you typed was for exactly one team - but an
 * account is just a person until league_members is consulted, and the browser cannot
 * consult it (the policy there is scoped to the reader's own rows, and the role must be
 * the server's answer regardless).
 *
 * Returns the LEGACY team id, not the row uuid: the whole UI is written against legacy
 * ids, which is why ~90 components survived the port untouched.
 */
export async function whoami(db, { leagueId, token }) {
  const session = await verifySession(db, token, { leagueId });
  if (!session) return fail(AUTH_ERRORS.noSession.status, AUTH_ERRORS.noSession.error);
  const rows = await fetchLeagueRows(db, leagueId);
  if (!rows) return fail(404, "League not found.");
  const team = session.teamId ? (rows.teams.find((t) => t.id === session.teamId) ?? null) : null;
  return good({
    role: session.role,
    teamId: team?.legacy_id ?? null,
    hasAccount: !!session.userId,
  });
}

/**
 * Attach a real account to the membership the caller already holds.
 *
 * MIGRATION BY INVITATION, NOT BY FORCE - the single most important property here.
 * Nobody is locked out mid-season, nobody has to create an account to keep playing, and
 * the join code keeps working afterwards. Each person moves when they next happen to
 * log in, and the league notices nothing.
 *
 * It needs BOTH credentials at once, which is the whole point:
 *
 *   token         - the join-code session. Proves what you are ALLOWED to be: this
 *                   league, this role, this team. The server never takes the client's
 *                   word for any of it; the membership is minted from the session, not
 *                   from anything in the request body.
 *   accountToken  - the Supabase JWT. Proves WHO you are.
 *
 * Idempotent on purpose. Signing in again, on a second device or a month later, must be
 * a no-op rather than a second membership or an error - and `unique (league_id,
 * user_id)` is what makes that guarantee real rather than a matter of getting the
 * check-then-insert right.
 */
export async function linkAccount(db, { leagueId, token, accountToken, displayName = null }) {
  /* Deliberately verified as a CODE SESSION, not through verifySession's either/or.
   * Someone already signed in with an account has nothing to link, and letting a JWT
   * authorize its own membership would be circular - the account would be granting
   * itself the role it is supposed to be receiving. */
  const session = token && !token.includes(".") ? await verifySession(db, token, { leagueId }) : null;
  if (!session) {
    return fail(401, "Log in with your team's join code first, then connect your email.");
  }

  const { data: userData, error: userError } = await db.auth.getUser(accountToken);
  const user = userData?.user;
  if (userError || !user) return fail(401, "That sign-in link is no longer valid - request a new one.");

  // The email lives in auth.users, where Supabase manages it. Storing it again here
  // would be a second source of truth for something we do not own.
  const { error: profileError } = await db
    .from("profiles")
    .upsert({ user_id: user.id, display_name: displayName }, { onConflict: "user_id" });
  if (profileError) return fail(500, profileError.message);

  const { data: existing } = await db
    .from("league_members")
    .select("id, role, team_id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    /* Already a member. Do NOT quietly rewrite the role from the session - a
     * commissioner who happens to be holding a manager's join code must not be demoted
     * by signing in. Changing someone's role is an administrative act, not a side
     * effect of logging in. */
    return good({ linked: true, alreadyMember: true, role: existing.role });
  }

  const { error } = await db.from("league_members").insert({
    league_id: leagueId,
    user_id: user.id,
    role: session.role,
    team_id: session.teamId,
  });
  // A race between two devices linking at once loses to the unique constraint, which is
  // the correct outcome and not an error worth showing anyone.
  if (error && !String(error.message).includes("duplicate key")) return fail(500, error.message);

  return good({ linked: true, alreadyMember: false, role: session.role });
}

/* --------------------- leagues, invites, membership ---------------------- */

/** The account behind a request, or null. Used where an ACCOUNT specifically is required
 *  - creating a league and redeeming an invite both mint a membership, and a membership
 *  has to belong to a person rather than to whoever is holding a code. */
async function accountUser(db, accountToken) {
  if (!accountToken) return null;
  const { data, error } = await db.auth.getUser(accountToken);
  if (error || !data?.user) return null;
  return data.user;
}

/**
 * Create a league. The creator becomes its commissioner.
 *
 * THIS RETIRES THE LAND-GRAB. The Artifact let the first person to type a code become
 * the commissioner, which was fine behind a private link and a free-for-all on a public
 * URL; `scripts/bootstrap-league.mjs` exists only to close that window by setting the
 * code before anyone can claim it. With league creation the commissioner is simply
 * whoever made the league, so that script becomes a development convenience rather than
 * a deployment step.
 *
 * Requires an ACCOUNT. There is deliberately no way to create a league with a join code:
 * a league whose owner is "whoever holds this string" is the thing this phase exists to
 * get away from.
 */
export async function createLeague(db, { accountToken, name, year, visibility = "members" }) {
  const user = await accountUser(db, accountToken);
  if (!user) return fail(401, "Sign in to create a league.");

  const trimmed = String(name ?? "").trim();
  if (!trimmed) return fail(400, "Give your league a name.");
  if (trimmed.length > 80) return fail(400, "That league name is too long.");
  if (!["members", "public"].includes(visibility)) return fail(400, "Unknown visibility.");

  const seasonYear = Number(year) || new Date().getFullYear();

  /* The same blank league bootstrap-league.mjs builds: one season, week 1 pre-deal, the
   * full player pool, and ZERO teams. Sharing createDefaultState() rather than
   * reimplementing it is what keeps a league made here identical to one made there. */
  const blank = createDefaultState();
  blank.leagueName = trimmed;
  const rows = decomposeLeague(blank, {
    leagueKey: trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ":" + seasonYear + ":" + user.id,
    year: seasonYear,
  });

  for (const table of ["leagues", "seasons", "players", "periods"]) {
    const data = rows[table] ?? [];
    if (!data.length) continue;
    const { error } = await db.from(table).insert(data);
    if (error) return fail(500, "Could not create the league: " + error.message);
  }

  const leagueId = rows.leagues[0].id;
  const { error: visError } = await db.from("leagues").update({ visibility }).eq("id", leagueId);
  if (visError) return fail(500, visError.message);

  const { error: memberError } = await db.from("league_members").insert({
    league_id: leagueId, user_id: user.id, role: "commissioner", team_id: null,
  });
  if (memberError) {
    /* Without a commissioner row the league would exist and be reachable by nobody -
     * an orphan that only a database console could fix. Undo it. */
    await db.from("leagues").delete().eq("id", leagueId);
    return fail(500, "Could not make you the commissioner: " + memberError.message);
  }

  await db.from("profiles").upsert({ user_id: user.id }, { onConflict: "user_id" });
  return good({ leagueId, name: trimmed, visibility });
}

/** Every league this account belongs to. The landing page's "your leagues" door. */
export async function myLeagues(db, { accountToken }) {
  const user = await accountUser(db, accountToken);
  if (!user) return fail(401, "Sign in to see your leagues.");

  const { data: members, error } = await db
    .from("league_members").select("league_id, role, team_id").eq("user_id", user.id);
  if (error) return fail(500, error.message);
  if (!members?.length) return good({ leagues: [] });

  const { data: leagues } = await db
    .from("leagues").select("id, name, visibility").in("id", members.map((m) => m.league_id));
  const { data: teams } = await db
    .from("teams").select("id, name").in("id", members.map((m) => m.team_id).filter(Boolean));

  return good({
    leagues: members.map((m) => {
      const league = leagues?.find((l) => l.id === m.league_id);
      return {
        id: m.league_id,
        name: league?.name ?? "(unavailable)",
        visibility: league?.visibility ?? null,
        role: m.role,
        teamName: teams?.find((t) => t.id === m.team_id)?.name ?? null,
      };
    }),
  });
}

/**
 * Issue an invite. Commissioner only. The code is returned ONCE and never stored.
 *
 * Multi-use and non-expiring by default, because the actual social flow is pasting one
 * code into a group chat - a single-use code would mean issuing six and tracking who
 * used which. It is revocable, which is the control that matters, and revoking one now
 * costs nobody their access.
 */
export async function createInvite(db, { leagueId, token, teamId = null, role = "manager", expiresAt = null, maxUses = null }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  if (!["commissioner", "manager"].includes(role)) return fail(400, "Unknown role.");

  let teamUuid = null;
  if (role === "manager") {
    const team = teamRow(ctx.rows, teamId);
    if (!team) return fail(404, "Pick a team for this invite.");
    teamUuid = team.id;
  }

  const { code, ref, secret } = generateInviteCode();
  const { error } = await db.from("invites").insert({
    league_id: leagueId,
    team_id: teamUuid,
    role,
    code_ref: ref,
    code_hash: hashInviteSecret(secret),
    created_by: ctx.session.userId ?? null,
    expires_at: expiresAt,
    max_uses: maxUses,
  });
  if (error) return fail(500, error.message);

  // Shown once. There is no route that reads it back, by design - reissuing is free.
  return good({ code, role, teamId: role === "manager" ? teamId : null });
}

/** Invites a commissioner can see - never the codes, which are not recoverable. */
export async function listInvites(db, { leagueId, token }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const { data, error } = await db
    .from("invites")
    .select("id, team_id, role, code_ref, created_at, expires_at, max_uses, uses, revoked_at")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false });
  if (error) return fail(500, error.message);

  return good({
    invites: (data ?? []).map((i) => ({
      id: i.id,
      role: i.role,
      // The public half only. Enough to tell two invites apart in a list; useless alone.
      ref: i.code_ref,
      teamId: ctx.rows.teams.find((t) => t.id === i.team_id)?.legacy_id ?? null,
      createdAt: i.created_at,
      expiresAt: i.expires_at,
      maxUses: i.max_uses,
      uses: i.uses,
      revoked: !!i.revoked_at,
    })),
  });
}

export async function revokeInvite(db, { leagueId, token, inviteId }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const { error } = await db
    .from("invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("league_id", leagueId); // scoped, so one league cannot revoke another's invites
  if (error) return fail(500, error.message);
  // Deliberately does NOT sign anyone out: an invite authorizes a join, it does not
  // sustain access. Removing a person is `league_members`, a different act.
  return good({ revoked: true });
}

/**
 * Redeem an invite. The only genuinely new flow in Phase 3d.
 *
 * Requires a signed-in account, because redemption mints a MEMBERSHIP and a membership
 * belongs to a person. This is the "type the code first, then sign in" door: the code is
 * what gets texted to you, so it must not be gated behind a sign-in wall - but it cannot
 * complete without one either.
 *
 * Idempotent. Redeeming twice is a no-op rather than a second membership or an error,
 * which matters because "did that work?" is the most natural reason to press it again.
 */
export async function redeemInvite(db, { code, accountToken }) {
  const user = await accountUser(db, accountToken);
  if (!user) return fail(401, "Sign in to redeem an invite.");

  const parsed = parseInviteCode(code);
  if (!parsed) return fail(400, "That does not look like an invite code.");

  const { data: invite } = await db
    .from("invites")
    .select("id, league_id, team_id, role, code_hash, expires_at, max_uses, uses, revoked_at")
    .eq("code_ref", parsed.ref)
    .maybeSingle();

  /* A wrong REFERENCE and a wrong SECRET must be indistinguishable from outside,
   * otherwise the reference half becomes an oracle for enumerating live invites. Both
   * paths return the same message. */
  if (!invite || !verifyInviteSecret(parsed.secret, invite.code_hash)) {
    return fail(401, "That invite code is not valid.");
  }
  const problem = inviteProblem(invite);
  if (problem) return fail(410, problem);

  const { data: existing } = await db
    .from("league_members")
    .select("id, role")
    .eq("league_id", invite.league_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    // Already in. Not an error, and the use is NOT counted - a multi-use invite should
    // not be burned down by one person pressing the button twice.
    return good({ leagueId: invite.league_id, role: existing.role, alreadyMember: true });
  }

  await db.from("profiles").upsert({ user_id: user.id }, { onConflict: "user_id" });
  const { error } = await db.from("league_members").insert({
    league_id: invite.league_id,
    user_id: user.id,
    role: invite.role,
    team_id: invite.team_id,
  });
  if (error && !String(error.message).includes("duplicate key")) return fail(500, error.message);

  await db.from("invites").update({ uses: invite.uses + 1 }).eq("id", invite.id);
  return good({ leagueId: invite.league_id, role: invite.role, alreadyMember: false });
}

/**
 * Change a member's role, or remove them.
 *
 * Commissioner transfer and second commissioners both live here, because both are the
 * same act: a role on a row. That is the point of putting the role there.
 *
 * THE LAST COMMISSIONER CANNOT STEP DOWN OR BE REMOVED. A league with no commissioner
 * cannot deal a week, add a team, or issue an invite - it is unadministrable, and no
 * screen in the app could fix it. Transfer is therefore promote-then-demote, in that
 * order, and the guard makes the wrong order impossible rather than merely discouraged.
 */
export async function setMemberRole(db, { leagueId, token, userId, role }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  if (!["commissioner", "manager", "remove"].includes(role)) return fail(400, "Unknown role.");

  const { data: target } = await db
    .from("league_members").select("id, role, team_id")
    .eq("league_id", leagueId).eq("user_id", userId).maybeSingle();
  if (!target) return fail(404, "That person is not in this league.");

  if (target.role === "commissioner" && role !== "commissioner") {
    const { data: commissioners } = await db
      .from("league_members").select("id").eq("league_id", leagueId).eq("role", "commissioner");
    if ((commissioners?.length ?? 0) <= 1) {
      return fail(409, "This is the league's only commissioner. Make someone else a commissioner first.");
    }
  }

  if (role === "remove") {
    const { error } = await db.from("league_members").delete().eq("id", target.id);
    if (error) return fail(500, error.message);
    return good({ removed: true });
  }

  // A commissioner acts for every team, so demoting to manager needs a team to act for.
  if (role === "manager" && !target.team_id) {
    return fail(400, "Give them a team before making them a manager.");
  }
  const { error } = await db
    .from("league_members")
    .update({ role, team_id: role === "commissioner" ? target.team_id : target.team_id })
    .eq("id", target.id);
  if (error) return fail(500, error.message);
  return good({ role });
}

/** Who is in this league. Commissioner only - it is a list of real people. */
export async function listMembers(db, { leagueId, token }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const { data: members, error } = await db
    .from("league_members").select("user_id, role, team_id").eq("league_id", leagueId);
  if (error) return fail(500, error.message);

  const out = [];
  for (const m of members ?? []) {
    const { data: userData } = await db.auth.admin.getUserById(m.user_id);
    out.push({
      userId: m.user_id,
      email: userData?.user?.email ?? null,
      role: m.role,
      teamId: ctx.rows.teams.find((t) => t.id === m.team_id)?.legacy_id ?? null,
    });
  }
  return good({ members: out });
}

/** Public, or members-only. The decision from the plan, as a setting. */
export async function setLeagueVisibility(db, { leagueId, token, visibility }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  if (!["members", "public"].includes(visibility)) return fail(400, "Unknown visibility.");
  const { error } = await db.from("leagues").update({ visibility }).eq("id", leagueId);
  if (error) return fail(500, error.message);
  return good({ visibility });
}

/* -------------------- fine-grained writes: the hot path ------------------- */

export async function setStatLine(db, { leagueId, token, teamId, slot, line, expect }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const bad = guard(ctx, "setStatLine", expect, [vkey.statLine(teamId, slot)]);
  if (bad) return bad;

  /* OQ-E: stats are keyed by SLOT, not by player. If a lineup swap lands after a stat
   * line is entered, the numbers stay attached to the slot and silently apply to
   * whoever now occupies it - the points move to a different player with nothing in the
   * UI to show it happened.
   *
   * The rule is preserved (slot-keyed is the designer's behaviour, and changing it
   * would move real scores). What is closed is the window in which it can bite: the
   * roster is already locked throughout the stats phase in normal play, so this rejects
   * only requests the UI could never have produced. Nobody following the weekly flow
   * will ever see this message.
   *
   * Provisionally confirmed, on the same footing as OQ-B above; it is the designer's
   * rule and is on his confirmation list. */
  if (!ctx.period.roster_locked) {
    return fail(409, "Lock the rosters before entering stats - otherwise a lineup change would move these numbers to a different player.", {
      reason: "unlocked",
      view: ctx.view,
    });
  }

  const team = teamRow(ctx.rows, teamId);
  if (!team) return fail(404, "Unknown team.");

  const num = (x) => (x === "" || x == null ? null : Number(x));
  const slotRow = ctx.rows.roster_slots.find(
    (r) => r.period_id === ctx.period.id && r.team_id === team.id && r.slot === slot
  );
  const existing = ctx.rows.stat_lines.find(
    (s) => s.period_id === ctx.period.id && s.team_id === team.id && s.slot === slot
  );

  const payload = {
    period_id: ctx.period.id,
    team_id: team.id,
    slot,
    player_id: slotRow?.player_id ?? null,
    yards: num(line.yards),
    tds: num(line.tds),
    coach_result: line.result ?? null,
    source: "manual",
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    // Compare-and-swap: zero rows updated means someone else moved first.
    const { data, error } = await db
      .from("stat_lines")
      .update({ ...payload, version: existing.version + 1 })
      .eq("id", existing.id)
      .eq("version", existing.version)
      .select();
    if (error) return fail(500, error.message);
    if (!data || data.length === 0) {
      const fresh = hydrate(await fetchLeagueRows(db, leagueId));
      return fail(409, "Someone else just updated the league - reloaded.", {
        reason: "stale",
        key: vkey.statLine(teamId, slot),
        view: fresh,
      });
    }
  } else {
    const { error } = await db.from("stat_lines").insert({ ...payload, version: 1 });
    if (error) return fail(500, error.message);
  }
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

export async function swapLineupSlot(db, { leagueId, token, teamId, slot, benchIndex, expect }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  const team = teamRow(ctx.rows, teamId);
  if (!team) return fail(404, "Unknown team.");
  if (!canActForTeam(ctx.session, team.id)) {
    return fail(AUTH_ERRORS.notYourTeam.status, AUTH_ERRORS.notYourTeam.error);
  }
  const bad = guard(ctx, "swapLineupSlot", expect, [
    vkey.starterSlot(teamId, slot),
    vkey.benchSlot(teamId, benchIndex),
  ]);
  if (bad) return bad;

  const starter = ctx.rows.roster_slots.find(
    (r) => r.period_id === ctx.period.id && r.team_id === team.id && r.area === "starter" && r.slot === slot
  );
  const bench = ctx.rows.roster_slots.find(
    (r) => r.period_id === ctx.period.id && r.team_id === team.id && r.area === "bench" && r.bench_index === benchIndex
  );
  if (!starter || !bench) return fail(404, "That roster slot doesn't exist.");
  if (starter.locked || bench.locked) return fail(409, "That player is locked.", { reason: "locked" });

  const a = await db
    .from("roster_slots")
    .update({ player_id: bench.player_id, version: starter.version + 1 })
    .eq("id", starter.id)
    .eq("version", starter.version)
    .select();
  if (a.error) return fail(500, a.error.message);
  if (!a.data?.length) {
    return fail(409, "Someone else just updated the league - reloaded.", {
      reason: "stale",
      view: hydrate(await fetchLeagueRows(db, leagueId)),
    });
  }
  const b = await db
    .from("roster_slots")
    .update({ player_id: starter.player_id, version: bench.version + 1 })
    .eq("id", bench.id)
    .eq("version", bench.version)
    .select();
  if (b.error || !b.data?.length) {
    // Put the first half back rather than leaving a duplicated player.
    await db.from("roster_slots").update({ player_id: starter.player_id, version: starter.version + 2 }).eq("id", starter.id);
    return fail(409, "Someone else just updated the league - reloaded.", {
      reason: "stale",
      view: hydrate(await fetchLeagueRows(db, leagueId)),
    });
  }
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

export async function submitScheme(db, { leagueId, token, teamId, scheme, expect }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  const team = teamRow(ctx.rows, teamId);
  if (!team) return fail(404, "Unknown team.");
  if (!canActForTeam(ctx.session, team.id)) {
    return fail(AUTH_ERRORS.notYourTeam.status, AUTH_ERRORS.notYourTeam.error);
  }
  const bad = guard(ctx, "submitScheme", expect, [vkey.scheme(teamId)]);
  if (bad) return bad;
  if (ctx.period.roster_locked) return fail(409, "Schemes are locked.", { reason: "locked" });

  /* OQ-B: a Block must protect one of your OWN STARTERS. The artifact's form allowed
   * nothing else but the engine never re-checked, which stops being harmless the
   * moment a request can be crafted by hand. Provisionally confirmed; awaiting the
   * original designer's final word. */
  if (scheme.type === "block") {
    const player = playerRow(ctx.rows, scheme.playerId);
    const owned = ctx.rows.roster_slots.find(
      (r) =>
        r.period_id === ctx.period.id &&
        r.team_id === team.id &&
        r.area === "starter" &&
        r.player_id === player?.id
    );
    if (!owned) return fail(400, "You can only block one of your own starters.");
  }

  const existing = ctx.rows.schemes.find(
    (s) => s.period_id === ctx.period.id && s.team_id === team.id && s.resolved_at == null
  );
  const payload = {
    period_id: ctx.period.id,
    team_id: team.id,
    type: scheme.type,
    position: scheme.type === "noaction" ? null : scheme.position,
    player_id: scheme.type === "noaction" ? null : (playerRow(ctx.rows, scheme.playerId)?.id ?? null),
    submitted_at: new Date().toISOString(),
  };
  if (existing) {
    const { data, error } = await db
      .from("schemes")
      .update({ ...payload, version: existing.version + 1 })
      .eq("id", existing.id)
      .eq("version", existing.version)
      .select();
    if (error) return fail(500, error.message);
    if (!data?.length) {
      return fail(409, "Someone else just updated the league - reloaded.", {
        reason: "stale",
        view: hydrate(await fetchLeagueRows(db, leagueId)),
      });
    }
  } else {
    const { error } = await db.from("schemes").insert({ ...payload, version: 1 });
    if (error) return fail(500, error.message);
  }
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

export async function toggleSlotLock(db, { leagueId, token, teamId, playerId }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const bad = guard(ctx, "toggleSlotLock", null, []);
  if (bad) return bad;
  const team = teamRow(ctx.rows, teamId);
  const player = playerRow(ctx.rows, playerId);
  const row = ctx.rows.roster_slots.find(
    (r) => r.period_id === ctx.period.id && r.team_id === team?.id && r.player_id === player?.id
  );
  if (!row) return fail(404, "That player isn't on that roster.");
  const { error } = await db
    .from("roster_slots")
    .update({ locked: !row.locked, version: row.version + 1 })
    .eq("id", row.id);
  if (error) return fail(500, error.message);
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

export async function toggleRosterLock(db, { leagueId, token, expect }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const bad = guard(ctx, "toggleRosterLock", expect, [vkey.period()]);
  if (bad) return bad;
  const { error } = await db
    .from("periods")
    .update({ roster_locked: !ctx.period.roster_locked, version: ctx.period.version + 1 })
    .eq("id", ctx.period.id)
    .eq("version", ctx.period.version);
  if (error) return fail(500, error.message);
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

/* ----------------- coarse: lifecycle, commissioner only ------------------ */

async function commissionerLifecycle(db, leagueId, token, opName, expect, apply) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const bad = guard(ctx, opName, expect, [vkey.period()]);
  if (bad) return bad;

  const outcome = await apply(ctx);
  if (outcome.error) return fail(400, outcome.error, { reason: "invalid", view: ctx.view });

  await persistBlob(db, ctx.rows, outcome.blob, {
    leagueKey: ctx.rows.leagues[0].name === "Pigskin Poker (Demo League)" ? "demo" : leagueId,
    year: ctx.rows.seasons[0].year,
  });
  if (outcome.afterPersist) await outcome.afterPersist(db, leagueId);
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

export async function dealPeriod(db, { leagueId, token, expect }) {
  return commissionerLifecycle(db, leagueId, token, "dealPeriod", expect, async (ctx) => {
    const v = ctx.view;
    const teamIds =
      v.currentPeriod.type === "playoff" ? v.playoffConfig.activeTeamIds : v.teams.map((t) => t.id);
    if (teamIds.length === 0) return { error: "Add at least one team before dealing rosters." };

    // Minted HERE, server-side, and stored on the period: the deal can be replayed and
    // audited, and a client cannot re-roll one it did not like (P5).
    const seed = newSeed();
    const result = dealRosters(v, teamIds, seededRng(seedFromString(seed)));
    if (result.error) return { error: result.error };

    const blob = JSON.parse(JSON.stringify(v));
    Object.entries(result.rosters).forEach(([teamId, roster]) => {
      const t = blob.teams.find((x) => x.id === teamId);
      if (t) t.roster = roster;
    });
    blob.currentPeriod.phase = "dealt";
    blob.schemes = {};
    blob.statsEntry = {};
    blob.lockedPlayerIds = {};
    blob.rosterLocked = false;
    const label =
      (blob.currentPeriod.type === "playoff" ? "Playoff Round " : "Week ") + blob.currentPeriod.number;
    blob.activityLog.push({
      id: "act_deal_" + blob.currentPeriod.type + blob.currentPeriod.number,
      period: { ...blob.currentPeriod },
      periodLabel: label,
      ts: new Date().toISOString(),
      type: "deal",
      text:
        "Rosters dealt for " + label + " (" + teamIds.length +
        " team" + (teamIds.length === 1 ? "" : "s") + ").",
    });

    return {
      blob,
      afterPersist: async (client) => {
        await client
          .from("periods")
          .update({ deal_seed: seed, dealt_at: new Date().toISOString() })
          .eq("id", ctx.period.id);
      },
    };
  });
}

export async function processSchemes(db, { leagueId, token, expect }) {
  return commissionerLifecycle(db, leagueId, token, "processSchemes", expect, async (ctx) => {
    const seed = newSeed();
    const blob = engineProcessSchemes(ctx.view, seededRng(seedFromString(seed)));
    blob.currentPeriod.phase = "schemes-processed";
    blob.rosterLocked = true;
    return {
      blob,
      afterPersist: async (client) => {
        await client.from("periods").update({ scheme_seed: seed }).eq("id", ctx.period.id);
        // Schemes are retained, not deleted (OQ-9): mark them resolved so the RLS
        // gate opens and the history becomes queryable.
        await client
          .from("schemes")
          .update({ resolved_at: new Date().toISOString(), outcome: "applied" })
          .eq("period_id", ctx.period.id)
          .is("resolved_at", null);
      },
    };
  });
}

export async function finalizePeriod(db, { leagueId, token, expect }) {
  return commissionerLifecycle(db, leagueId, token, "finalizePeriod", expect, async (ctx) => {
    const result = finalizeCurrentPeriod(ctx.view);
    if (result.error) return { error: result.error };
    return {
      blob: result.state,
      afterPersist: async (client) => {
        await client
          .from("periods")
          .update({ phase: "finalized", finalized_at: new Date().toISOString() })
          .eq("id", ctx.period.id);
      },
    };
  });
}

export async function startPlayoffs(db, { leagueId, token, bracketSize, advancement }) {
  return commissionerLifecycle(db, leagueId, token, "startPlayoffs", null, async (ctx) => ({
    blob: engineStartPlayoffs(ctx.view, bracketSize, advancement),
  }));
}

/* --------------------------- league administration ----------------------- */

/** Commissioner-only, low-frequency, genuinely league-wide (teams, pool, scoring). */
export async function replaceLeague(db, { leagueId, token, blob }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  await persistBlob(db, ctx.rows, blob, {
    leagueKey: ctx.rows.leagues[0].name === "Pigskin Poker (Demo League)" ? "demo" : leagueId,
    year: ctx.rows.seasons[0].year,
  });
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

export async function setTeamJoinCode(db, { leagueId, token, teamId, code }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const team = teamRow(ctx.rows, teamId);
  if (!team) return fail(404, "Unknown team.");

  // On SET only. See the note on validateCode: enforcing this on verify would sign out
  // whoever is holding a short code today, and no query can find them to warn first.
  const badCode = validateCode(code);
  if (badCode) return fail(400, badCode, { reason: "code-policy" });

  const { error } = await db
    .from("team_secrets")
    .upsert({ team_id: team.id, join_code_hash: hashCode(code), updated_at: new Date().toISOString() });
  if (error) return fail(500, error.message);
  // Keep the public flag in step with the hash it describes, or the team picker will
  // lie about whether the team is joinable.
  await db.from("teams").update({ has_join_code: true }).eq("id", team.id);

  /* Rotating a code means "someone should no longer have this" - there is no other
   * reason to do it. Leaving their 30-day session alive made the rotation cosmetic.
   * The commissioner path already did this (scripts/set-commissioner-code.mjs); this
   * is the same delete on the team path. */
  const signedOut = await destroySessionsForTeam(db, team.id);
  return good({ signedOut, view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

/**
 * Sign out every device holding a session for one team, without changing its code.
 *
 * The code-rotation path above covers "this person should be locked out". This covers
 * the other case - a phone left somewhere, a shared laptop - where the code is fine and
 * only the live sessions are the problem. Rotating a code to achieve it would force the
 * whole team to be told a new one.
 */
export async function signOutTeam(db, { leagueId, token, teamId }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const team = teamRow(ctx.rows, teamId);
  if (!team) return fail(404, "Unknown team.");
  const signedOut = await destroySessionsForTeam(db, team.id);
  return good({ signedOut, view: hydrate(await fetchLeagueRows(db, leagueId)) });
}
