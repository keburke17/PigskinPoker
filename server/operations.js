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
import { splitColumnsFor } from "../src/storage/statLine.js";
import { planPoolRefresh, poolWriteRows } from "./pool.js";
import { planStatsPull, statWriteRows } from "./stats.js";
import { pullEligibility, summarize } from "./autoPull.js";
import {
  DEADLINES,
  advanceEligibility,
  dealEligibility,
  deadlineWords,
  schemesEligibility,
  summarize as summarizeCycle,
  zoneOf,
} from "./autoCycle.js";
import { isValidTimeZone } from "./tz.js";
import { isValidNflWeek, nextNflWeek } from "./schedule.js";
import { selectFeed } from "./feed/index.js";
import {
  LINEUP_LOCK,
  LINEUP_LOCK_MODES,
  dealRosters,
  finalizeCurrentPeriod,
  lockedByClock,
  normalizeLineupLock,
  newSeed,
  processSchemes as engineProcessSchemes,
  seedFromString,
  seededRng,
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
  isCommissioner,
  verifyAccount,
  verifySession,
  verifySiteAdmin,
} from "./auth.js";
import { planCoachUpdate, summarizeCoaches, NFL_TEAM_NAMES } from "./coaches.js";

const PHASE_RULES = {
  dealPeriod: ["pre-deal"],
  submitScheme: ["dealt"],
  swapLineupSlot: ["dealt", "schemes-processed"],
  processSchemes: ["dealt"],
  setStatLine: ["schemes-processed", "stats"],
  toggleSlotLock: ["schemes-processed", "stats"],
  toggleRosterLock: ["dealt", "schemes-processed", "stats"],
  finalizePeriod: ["schemes-processed", "stats"],
  /* Pre-deal only, and that is the whole safety argument. In pre-deal no rosters exist
   * for the week - finalize deletes them - so a refresh cannot move a player who is on
   * somebody's team. It is also what the designer asked for: a player who stops being a
   * starter finishes his week and is simply absent from the next deal. */
  refreshPlayerPool: ["pre-deal"],
  /* The same phases stat entry itself allows, for the same reason: a pull is stat entry
   * done quickly, and there is no week in which typing the numbers is legal but reading
   * them off the feed is not. */
  pullStats: ["schemes-processed", "stats"],
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

/**
 * The same context, for a caller that is not a person.
 *
 * The SCHEDULED weekly cycle (issue #52) runs inside our own deployment on the secret
 * key, with no session to verify and nobody to return a 401 to. It gets the rows and
 * the view the same way every other operation does; what it does NOT get is a way past
 * any check - `server/autoCycle.js` re-asks every question `PHASE_RULES` asks, and the
 * league has to have opted in before it is even considered.
 *
 * Not exported. Nothing outside this file may build a context without a token.
 */
async function systemContext(db, leagueId) {
  const rows = await fetchLeagueRows(db, leagueId);
  if (!rows) return { error: fail(404, "League not found.") };
  const view = hydrate(rows);
  const period = rows.periods.find((p) => p.id === view?._meta?.periodId) ?? null;
  return { session: null, rows, view, period };
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

/**
 * The league's lineup-lock policy as a question you can ask about one roster row:
 * "is this player's game already under way?" Returns the sentence to refuse with, or
 * null when the swap is allowed.
 *
 * Reads the same two facts the browser reads - `seasons.lineup_lock` and this period's
 * `kickoffs` - and reaches the verdict with the same engine function, so the screen and
 * the server cannot drift apart. A player whose team has no kickoff (a bye, a week
 * whose times were never read) is never locked by the clock.
 */
function kickoffLock(ctx, now = Date.now()) {
  const mode = normalizeLineupLock(ctx.rows.seasons[0]?.lineup_lock);
  const kickoffs = ctx.period?.kickoffs ?? {};
  return (playerId) => {
    if (!playerId) return null;
    const player = ctx.rows.players.find((p) => p.id === playerId);
    if (!player) return null;
    if (!lockedByClock(mode, kickoffs, player.nfl_team, now)) return null;
    return mode === LINEUP_LOCK.WEEKLY
      ? "Lineups are locked - this league locks every lineup at the week's first kickoff."
      : player.name + "'s game has started, so that lineup slot is locked.";
  };
}

const teamRow = (rows, legacyId) => rows.teams.find((t) => t.legacy_id === legacyId) ?? null;
const playerRow = (rows, legacyId) =>
  legacyId == null ? null : (rows.players.find((p) => p.legacy_id === legacyId) ?? null);

/**
 * When each NFL week of this season starts, or null if the schedule cannot be read.
 *
 * BEST EFFORT ON PURPOSE. This only improves a DEFAULT that the commissioner can
 * already override with `setNflWeek`, so a feed that is down, slow or reshaped must not
 * fail the finalize or the league creation that asked for it - it falls back to the
 * behaviour that shipped before issue #45.
 */
async function readWeekStarts(season, feed) {
  if (!season) return null;
  try {
    const source = feed || (await selectFeed());
    if (!source.fetchWeekStarts) return null;
    const { weekStarts } = await source.fetchWeekStarts({ season });
    return weekStarts && Object.keys(weekStarts).length ? weekStarts : null;
  } catch {
    return null;
  }
}

/**
 * Give a period the app just created its NFL week.
 *
 * A period is born unmapped: it is written by decompose along with the rest of the
 * blob, and decompose does not carry `nfl_week` on purpose (server/schedule.js explains
 * why at length). So without this nothing would ever set it, and a stats pull would
 * have no week to ask the feed for - which is exactly the state the app was in until
 * now, with only the demo seed filling the column.
 *
 * Runs AFTER the blob is persisted, because that is when the new row exists. Never
 * overwrites a mapping that is already there, which makes it safe to call twice and
 * keeps it away from a commissioner's correction.
 */
async function mapNewPeriod(client, seasonId, current, { season, feed } = {}) {
  if (!current) return;
  const { data: periods } = await client
    .from("periods")
    .select("id, type, number, nfl_week")
    .eq("season_id", seasonId);
  if (!periods) return;
  const row = periods.find((p) => p.type === current.type && p.number === current.number);
  if (!row || row.nfl_week != null) return;
  /* Only worth reading the schedule when nothing is mapped yet - once one period has a
   * week, the mapping counts forward from it and the calendar has no say (issue #45,
   * server/schedule.js). Skipping the fetch in the ordinary case keeps a finalize from
   * waiting on a 8.6 MB file it will not use. */
  const anyMapped = periods.some((p) => isValidNflWeek(p.nfl_week));
  const weekStarts = anyMapped ? null : await readWeekStarts(season, feed);
  const week = nextNflWeek({ periods, period: row, weekStarts });
  if (week == null) return;
  /* A failure here is not worth failing the deal or the finalize over: the week is
   * still playable, and the commissioner can set the mapping himself. */
  await client.from("periods").update({ nfl_week: week }).eq("id", row.id);
}

/**
 * Read this period's kickoff times from the schedule and store them on the period.
 *
 * WHAT IT IS FOR. The lineup lock fires on a clock, and this is where that clock comes
 * from: `periods.kickoffs` maps each NFL team to when it plays this week, and every
 * lock verdict - the server's refusal and the browser's greyed-out row alike - is read
 * off it. See src/engine/lineupLock.js.
 *
 * SERVER-OWNED, LIKE nfl_week. Written by direct update, never through the blob, so an
 * ordinary write cannot put null over a week's times (server/schedule.js, same rule).
 *
 * NEVER FAILS THE CALLER. A deal is not worth failing over a schedule file being slow:
 * no kickoffs means nothing locks on the clock, the commissioner's manual locks still
 * work exactly as they always have, and `refreshKickoffs` picks it up later. The one
 * caller that reports the outcome is `refreshKickoffs`, which the commissioner pressed.
 *
 * @returns {{ ok: boolean, count: number, error?: string }}
 */
async function readKickoffs(client, periodRow, season, feed) {
  const fetched = await fetchKickoffsFor(periodRow, season, feed);
  if (!fetched.ok) return { ok: false, count: 0, error: fetched.error };

  const { error } = await client
    .from("periods")
    .update({ kickoffs: fetched.kickoffs, kickoffs_read_at: new Date().toISOString() })
    .eq("id", periodRow.id);
  if (error) return { ok: false, count: 0, error: error.message };
  return { ok: true, count: fetched.count };
}

/**
 * The fetch half of the above, WITHOUT the write.
 *
 * SPLIT OUT FOR THE DEAL (OQ-25, 2026-09-08). Dealing has to know which teams are playing
 * before it deals, because a player whose team has no game is no longer dealt - and the
 * write half needs a database client that the operation body does not have (it only reaches
 * one in `afterPersist`, which runs after the deal has already happened). So `applyDeal`
 * fetches here, deals against the answer, and lets `afterPersist` do the storing.
 *
 * @returns {{ ok: boolean, count: number, kickoffs?: object, error?: string }}
 */
async function fetchKickoffsFor(periodRow, season, feed) {
  if (!periodRow) return { ok: false, count: 0, error: "no current week" };
  if (!isValidNflWeek(periodRow.nfl_week)) {
    return { ok: false, count: 0, error: "this week is not mapped to an NFL week yet" };
  }
  let kickoffs;
  try {
    const source = feed || (await selectFeed());
    ({ kickoffs } = await source.fetchKickoffs({ season, week: periodRow.nfl_week }));
  } catch (err) {
    return { ok: false, count: 0, error: err.message };
  }
  const count = Object.keys(kickoffs || {}).length;
  /* An empty answer is not written over times we already have. Before a schedule is
   * published the feed genuinely returns nothing, and replacing a good week's times
   * with {} would silently unlock a league mid-Sunday. */
  if (count === 0) return { ok: false, count: 0, error: "the schedule has no times for that week yet" };
  return { ok: true, count, kickoffs };
}

/* ----------------------------- accounts ---------------------------------- */

/**
 * Who is this token, and what may it do IN THIS LEAGUE?
 *
 * Needed because an account does not carry its role: it is just a person until
 * `league_members` is consulted, and the browser cannot consult it (the policy there is
 * scoped to the reader's own rows, and the role must be the server's answer regardless).
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
  return good({ role: session.role, teamId: team?.legacy_id ?? null });
}

/* --------------------- leagues, invites, membership ---------------------- */

/**
 * Create a league. The creator becomes its commissioner.
 *
 * THIS RETIRES THE LAND-GRAB. The Artifact let the first person to type a code become
 * the commissioner, which was fine behind a private link and a free-for-all on a public
 * URL. `scripts/bootstrap-league.mjs` existed only to close that window by setting the
 * code before anyone could claim it; with league creation the commissioner is simply
 * whoever made the league, so the script was deleted along with codes themselves.
 *
 * Requires an ACCOUNT. There is deliberately no way to create a league with a join code:
 * a league whose owner is "whoever holds this string" is the thing this phase exists to
 * get away from.
 */
export async function createLeague(db, { accountToken, name, year, visibility = "members" }) {
  const user = await verifyAccount(db, accountToken);
  if (!user) return fail(401, "Sign in to create a league.");

  const trimmed = String(name ?? "").trim();
  if (!trimmed) return fail(400, "Give your league a name.");
  if (trimmed.length > 80) return fail(400, "That league name is too long.");
  if (!["members", "public"].includes(visibility)) return fail(400, "Unknown visibility.");

  const seasonYear = Number(year) || new Date().getFullYear();

  /* A blank league: one season, week 1 pre-deal, and ZERO teams. Sharing
   * createDefaultState() rather than reimplementing it is what keeps a league made here
   * identical to one made anywhere else. */
  const blank = createDefaultState();
  blank.leagueName = trimmed;
  const rows = decomposeLeague(blank, {
    leagueKey: trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ":" + seasonYear + ":" + user.id,
    year: seasonYear,
  });

  /* The blank league's week 1, mapped to an NFL week before it is written. decompose
   * does not carry the column (server/schedule.js), so this is the only chance to set
   * it at creation.
   *
   * SINCE ISSUE #45 IT ASKS THE CALENDAR rather than assuming opening weekend. A league
   * created in October now starts on the NFL week October is playing; it used to start
   * on week 1, which fetched the wrong stats and locked rosters against a schedule from
   * a month earlier. Still correctable with setNflWeek, and a schedule that cannot be
   * read falls back to the old answer. */
  const weekStarts = await readWeekStarts(seasonYear);
  rows.periods = (rows.periods ?? []).map((p) => ({
    ...p,
    nfl_week: nextNflWeek({ periods: [], period: p, weekStarts }),
  }));

  /* PLAYERS ARE NOT IN THAT LIST any more. They are copied from `player_pool` in one
   * statement instead of being shipped as 223 rows of JSON per league, which also means
   * a pool corrected in the database is picked up by the next league without a deploy.
   * The blob still carries a pool - the engine state shape is the artifact's and parity
   * depends on it - so this drops it rather than persisting it twice. */
  for (const table of ["leagues", "seasons", "periods"]) {
    const data = rows[table] ?? [];
    if (!data.length) continue;
    const { error } = await db.from(table).insert(data);
    if (error) return fail(500, "Could not create the league: " + error.message);
  }

  const leagueId = rows.leagues[0].id;

  const { data: copied, error: poolError } = await db.rpc("copy_player_pool_into", {
    target_league: leagueId,
  });
  if (poolError || !copied) {
    /* A league with no players cannot deal a week, and no screen in the app can add
     * them. Better to leave nothing behind than something unusable. */
    await db.from("leagues").delete().eq("id", leagueId);
    return fail(500, "Could not stock the player pool: " + (poolError?.message ?? "the pool is empty"));
  }
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
  const user = await verifyAccount(db, accountToken);
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
  const user = await verifyAccount(db, accountToken);
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

/**
 * Delete a league, and everything that was ever in it.
 *
 * Scott asked for this on 2026-09-08 (OQ-18). The live site had collected test leagues
 * from him learning the app, and nothing in the product could be rid of one - the only
 * way was a database console, which is Kyle's.
 *
 * IT IS THE ONE OPERATION WITH NOTHING BEHIND IT. Every league-scoped table hangs off
 * `leagues` with `on delete cascade` (supabase/migrations/20260818000000_initial_schema.sql),
 * so deleting the row takes the teams, players, rosters, schemes, stat lines, results,
 * standings, invites, memberships and the activity log with it, in one statement. There
 * is no bin and no undo. `npm run db:backup` is the only copy there is, and it is Kyle's
 * - so a league deleted between backups is gone.
 *
 * THE COMMISSIONER MUST NAME THE LEAGUE. The screen makes him type it and this checks it
 * again, deliberately twice. Everywhere else here, a write aimed at the wrong league is
 * corrected by writing again; this one cannot be, so the id is not allowed to be the only
 * thing pointing at what dies.
 *
 * Deliberately NOT built on `context()`. That hydrates the whole league to reach a role,
 * and the league most likely to be deleted is the one that has gone wrong - a league too
 * broken to load should still be removable. The role comes from `league_members`, which
 * is the only authority on it anyway.
 */
export async function deleteLeague(db, { leagueId, token, confirmName }) {
  const session = await verifySession(db, token, { leagueId });
  if (!session) return fail(AUTH_ERRORS.noSession.status, AUTH_ERRORS.noSession.error);
  if (!isCommissioner(session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }

  const { data: league, error: readError } = await db
    .from("leagues").select("name").eq("id", leagueId).maybeSingle();
  if (readError) return fail(500, readError.message);
  if (!league) return fail(404, "League not found.");

  const typed = String(confirmName ?? "").trim().toLowerCase();
  if (!typed || typed !== String(league.name ?? "").trim().toLowerCase()) {
    return fail(400, "Type the league's name exactly - " + league.name + " - to delete it.");
  }

  const { error } = await db.from("leagues").delete().eq("id", leagueId);
  if (error) return fail(500, "Could not delete the league: " + error.message);
  return good({ leagueId, name: league.name });
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
    /* The six per-category columns, from the 2026-08-28 split (OQ-4c). The combined
     * pair below is written as whatever the caller sent, which for anything entered
     * through the stats screen is null - the entry UI drops the combined keys the
     * moment a category is typed. Old rows keep the values they were entered with;
     * nothing here converts them, because a total does not say how much was passing. */
    ...splitColumnsFor(line),
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

  /* The league's lineup-lock policy, enforced HERE rather than only on screen. The
   * browser greys the row out from the same kickoff times, but a client that ignores
   * the UI must not be able to move a player whose game has started - that is the whole
   * point of a lock. Manual locks are checked above; this is the clock.
   *
   * Both ends of the swap are checked. Under `gametime` the bench player matters as
   * much as the starter: benching a receiver whose game is over to promote one who has
   * not played is exactly the move the lock exists to prevent. */
  const clockLock = kickoffLock(ctx);
  const refusal = clockLock(starter.player_id) || clockLock(bench.player_id);
  if (refusal) return fail(409, refusal, { reason: "locked", view: ctx.view });

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

/**
 * Rename a team.
 *
 * A manager's OWN team, or any team in the league when the commissioner asks - the same
 * `canActForTeam` question the lineup and the scheme ask, so one route serves both the
 * button on My Team and the field on Manage Teams.
 *
 * IT NEEDED A ROUTE AT ALL because both of those buttons used to go through
 * `ops.mutate`, which sends the whole league blob to `replaceLeague`. That is
 * commissioner-only on purpose - the blob can rewrite the pool, the scoring and every
 * team - so a MANAGER renaming his own team was refused every single time, and the
 * refusal was then dropped by the client rather than shown: the editor closed, the old
 * name came back, and nothing said why. Found on 2026-09-09. The other half of that bug
 * is in src/hooks/opError.js.
 *
 * NO PHASE RULE, deliberately. There is no week in which naming your own team is
 * illegal, and a name cannot move a point - it is not roster state, so a rename
 * mid-week takes nothing with it.
 *
 * NO VERSION KEY either, for the same reason a coach's name has none (see setCoach):
 * last writer wins on a label, and two people renaming one team in the same second is
 * not a race worth a column.
 */
export async function renameTeam(db, { leagueId, token, teamId, name }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  const team = teamRow(ctx.rows, teamId);
  if (!team) return fail(404, "Unknown team.");
  if (!canActForTeam(ctx.session, team.id)) {
    return fail(AUTH_ERRORS.notYourTeam.status, AUTH_ERRORS.notYourTeam.error);
  }

  const trimmed = String(name ?? "").trim();
  if (!trimmed) return fail(400, "Give your team a name.");
  if (trimmed.length > 80) return fail(400, "That team name is too long.");

  const { error } = await db
    .from("teams")
    .update({ name: trimmed, version: team.version + 1 })
    .eq("id", team.id);
  if (error) return fail(500, error.message);
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

/**
 * WHICH teams have a scheme in for the current week - and nothing else about it.
 *
 * The commissioner's Weeks panel has always offered to show "N of M teams have
 * submitted", but nothing on his screen could ever learn it. `read_resolved_schemes`
 * hides an UNRESOLVED scheme from every browser read (OQ-9, and
 * tests/rls.test.js asserts it), the commissioner's included, and `schemes` is
 * deliberately absent from the Realtime publication as well. The count only ever
 * appeared as a side effect of his OWN writes - those return a server-built view,
 * which is assembled with the secret key and so sees everything - which is exactly
 * why his own submissions counted and no manager's ever did.
 *
 * So the count has to be ASKED for, by someone entitled to it. This is deliberately
 * the narrowest thing that answers the question: a list of team ids. Not the type,
 * not the position, not the player. A scheme's CONTENTS stay secret until they
 * resolve - that is the rule the game is built on, and the commissioner is not an
 * exception to it.
 */
export async function schemeStatus(db, { leagueId, token }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  if (!ctx.period) return good({ submittedTeamIds: [] });
  /* Legacy ids, not row uuids - the whole UI is written against legacy ids. */
  const submittedTeamIds = ctx.rows.schemes
    .filter((s) => s.period_id === ctx.period.id && s.resolved_at == null)
    .map((s) => ctx.rows.teams.find((t) => t.id === s.team_id)?.legacy_id)
    .filter((id) => id != null);
  return good({ submittedTeamIds });
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
  return runLifecycle(db, leagueId, ctx, apply);
}

/**
 * A lifecycle step, with no opinion about who asked for it.
 *
 * Split out of `commissionerLifecycle` so the SCHEDULED cycle (issue #52) runs the same
 * code rather than a second implementation of it - the same reason `runStatsPull` was
 * split out of `pullStats`, and the same reason `src/engine/` is shared with the
 * server. Two implementations of "deal a week" would be a very quiet way to hand out
 * different rosters on a Tuesday morning than on a Tuesday afternoon.
 *
 * THE AUTHORIZATION AND THE PHASE GUARDS STAY WITH THE CALLERS, because they genuinely
 * differ. The button answers to a commissioner's session and returns 409s he reads on
 * screen; the scheduler answers to a cron and treats the same conditions as reasons to
 * skip a league quietly (server/autoCycle.js). What must NOT differ is what gets
 * written, which is everything below.
 */
async function runLifecycle(db, leagueId, ctx, apply) {
  const outcome = await apply(ctx);
  if (outcome.error) return fail(400, outcome.error, { reason: "invalid", view: ctx.view });

  await persistBlob(db, ctx.rows, outcome.blob, {
    leagueKey: ctx.rows.leagues[0].name === "Pigskin Poker (Demo League)" ? "demo" : leagueId,
    year: ctx.rows.seasons[0].year,
  });
  if (outcome.afterPersist) await outcome.afterPersist(db, leagueId);
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

/**
 * What the deal says about the refresh that ran before it.
 *
 * Always says something. A pool that changes with nobody pressing refresh must not
 * change invisibly, and "nothing changed" is itself worth reading on a Thursday - it
 * means the depth charts agree with the pool, not that the refresh failed to run.
 */
function poolRefreshNote(refresh) {
  if (!refresh) return "";
  if (!refresh.ok) {
    return " Pool NOT refreshed - " + refresh.why + " Dealt from the existing pool.";
  }
  const r = refresh.report;
  const added = r.added?.length ?? 0;
  const renamed = r.renamed?.length ?? 0;
  const sidelined = r.sidelined?.length ?? 0;
  const parts = [];
  if (added) parts.push(added + " added");
  if (r.retired) parts.push(r.retired + " retired");
  if (renamed) parts.push(renamed + " renamed");
  if (sidelined) parts.push(sidelined + " hurt, replaced by the next man up");
  return parts.length
    ? " Pool refreshed first: " + parts.join(", ") + "."
    : " Pool refreshed first - no changes.";
}

/**
 * Deal the week - refreshing the player pool from the live depth charts first.
 *
 * THE REFRESH RUNS BEFORE THE LIFECYCLE, and that ordering is the whole design.
 * `persistBlob` rewrites the entire `players` table from the blob it is handed, so a
 * refresh performed *inside* the lifecycle callback would be silently reverted: the blob
 * was built from a view read before the refresh, and upserting it puts every status back.
 * Running the refresh first, as its own committed operation, means the lifecycle then
 * reads the world fresh and deals from what the refresh just wrote.
 *
 * WHY IT IS HERE AT ALL. Scott, 2026-09-06: "when a deal is dealt, i want the rosters to
 * be live each time." Refreshing when the week *ends* does not deliver that - finalize
 * on Monday night and deal on Thursday and the pool is three days stale at the only
 * moment that matters. The deal is the moment, so the refresh belongs on the deal.
 *
 * This is a deliberate departure from "commissioner-pressed, never automatic" as written
 * in docs/PHASE-4-PLAN.md section 6. What that rule was protecting against is an
 * unattended refresh nobody sees; three things keep that protection:
 *
 *   1. It is still a commissioner pressing a button, in the same phase, doing the same
 *      operation. One press instead of two - not a schedule, and not a background job.
 *   2. It says what it did, in the activity log, every time. A pool that changes with
 *      nobody pressing anything must not change invisibly.
 *   3. `refreshPlayerPool` is untouched and still on its own button, for the times he
 *      wants to look at the pool and correct it before dealing.
 *
 * A FEED FAILURE MUST NOT STOP THE WEEK. If the feed is down, late or has changed shape,
 * the refresh returns 502, the pool is left exactly as it was, and the deal goes ahead on
 * the pool he has - saying so in the log. A week that cannot start because nflverse is
 * having a bad morning is a far worse failure than a slightly stale pool.
 *
 * ANY OTHER FAILURE DOES STOP IT, and is returned unchanged. A refused phase, a stale
 * version or somebody who is not the commissioner would fail the deal identically a
 * moment later, so there is one error rather than two. More importantly a write failure
 * mid-refresh (500) leaves the pool half-updated, and dealing out of a half-written pool
 * is exactly the silent damage the original rule existed to prevent.
 *
 * `feed` and `refresh` are injected by tests. `refresh: false` deals without touching the
 * pool, which is what the parity and engine fixtures want.
 */
export async function dealPeriod(db, { leagueId, token, expect, feed, refresh }) {
  /** @type {{ok: true, report: object} | {ok: false, why: string} | null} */
  let poolRefresh = null;

  if (refresh !== false) {
    const outcome = await refreshPlayerPool(db, { leagueId, token, expect, feed });
    if (outcome.status === 200) {
      poolRefresh = { ok: true, report: outcome.body.report };
    } else if (outcome.status === 502) {
      // The feed's fault. Note it, deal anyway.
      poolRefresh = { ok: false, why: outcome.body?.error ?? "the stats feed was unreachable" };
    } else {
      return outcome;
    }
  }

  return commissionerLifecycle(
    db, leagueId, token, "dealPeriod", expect,
    applyDeal({ poolRefresh, feed })
  );
}

/**
 * The deal itself, shared by the button and by the clock (issue #52).
 *
 * `by` is the only thing that differs between the two, and it changes one word in the
 * activity log. THAT WORD MATTERS: a roster that appeared overnight with nobody
 * pressing anything must say so, in the one place the league reads its own history.
 * The same promise `poolRefreshNote` makes about a pool that changed by itself.
 *
 * @param {"commissioner"|"the schedule"} by
 */
function applyDeal({ poolRefresh, feed, by = "commissioner", now = null }) {
  return async (ctx) => {
    const v = ctx.view;
    const teamIds =
      v.currentPeriod.type === "playoff" ? v.playoffConfig.activeTeamIds : v.teams.map((t) => t.id);
    if (teamIds.length === 0) return { error: "Add at least one team before dealing rosters." };

    /* THE SCHEDULE IS READ BEFORE THE DEAL, NOT AFTER (OQ-25, 2026-09-08). It used to be
     * read only in `afterPersist` below, which was fine when nothing about the deal
     * depended on it - the times were for the lineup lock, and the lock does not start
     * mattering until Thursday. Now a player whose NFL team has no game is not dealt, and a
     * week's own kickoffs are the only thing that knows who those players are. Left where
     * it was, the rule would have read LAST week's schedule and quietly never fired on the
     * first deal of a new week, which is every deal.
     *
     * BEST EFFORT, EXACTLY AS BEFORE. A schedule that is slow, unpublished or unreadable
     * leaves `_meta.kickoffs` as it was and the deal goes ahead dealing everybody, which is
     * the behaviour that shipped before this rule. A deal that refused forty players
     * because a CSV timed out would be far worse than the problem it solves - see the
     * "two ways to know nothing" note in src/engine/availability.js. */
    const schedule = await fetchKickoffsFor(ctx.period, ctx.rows.seasons[0]?.year, feed);
    const dealView = schedule.ok
      ? { ...v, _meta: { ...(v._meta || {}), kickoffs: schedule.kickoffs } }
      : v;

    // Minted HERE, server-side, and stored on the period: the deal can be replayed and
    // audited, and a client cannot re-roll one it did not like (P5).
    const seed = newSeed();
    const result = dealRosters(dealView, teamIds, seededRng(seedFromString(seed)));
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
        "Rosters dealt" + (by === "commissioner" ? "" : " automatically") + " for " + label +
        " (" + teamIds.length + " team" + (teamIds.length === 1 ? "" : "s") + ")." +
        poolRefreshNote(poolRefresh),
    });

    return {
      blob,
      afterPersist: async (client) => {
        await client
          .from("periods")
          /* `dealt_at` IS READ BACK AS A DEADLINE, not just recorded: every "has this
           * week's deadline passed" question in server/autoCycle.js compares against
           * it. So when the clock deals, it stamps its OWN now rather than the wall
           * clock - the same reason `rng` is injected into the engine. In production
           * the two are the same instant; in a test with a frozen clock they are not,
           * and a week dealt "now" must not immediately look overdue. */
          .update({ deal_seed: seed, dealt_at: new Date(now ?? Date.now()).toISOString() })
          .eq("id", ctx.period.id);
        /* Store the week's kickoff times, because dealing is when the week starts and the
         * lock needs a clock from that moment on. These are the SAME times the deal just
         * dealt against, kept from the fetch above rather than fetched a second time - so
         * the schedule a roster was built from and the schedule its lock fires on cannot
         * be two different readings of a flexed game. Best effort by design: a file that
         * was slow or not yet published leaves the period's existing times alone, and the
         * league locks nothing until the commissioner refreshes them. */
        if (schedule.ok) {
          await client
            .from("periods")
            .update({ kickoffs: schedule.kickoffs, kickoffs_read_at: new Date().toISOString() })
            .eq("id", ctx.period.id);
        }
      },
    };
  };
}

export async function processSchemes(db, { leagueId, token, expect }) {
  return commissionerLifecycle(db, leagueId, token, "processSchemes", expect, applyProcessSchemes());
}

/**
 * Scheme resolution, shared by the button and by the clock (issue #52).
 *
 * Note what this does beyond resolving schemes: it sets `rosterLocked = true`, matching
 * the artifact (legacy line 2305). So automating the Thursday step also OPENS THE STATS
 * WINDOW in the ordinary case, and a league with `auto_pull_stats` on becomes eligible
 * for its scheduled pull without anyone pressing Lock Rosters. That is most of what
 * OQ-12 was asking about, arriving from a different direction; OQ-12 itself - whether
 * the LINEUP lock alone should be enough - stays open and unbuilt.
 *
 * A team with no scheme on file is skipped by the engine rather than erroring, which is
 * the whole reason 3am Thursday becomes a real deadline. See the header of
 * server/autoCycle.js.
 */
function applyProcessSchemes({ by = "commissioner" } = {}) {
  return async (ctx) => {
    const seed = newSeed();
    const blob = engineProcessSchemes(ctx.view, seededRng(seedFromString(seed)));
    blob.currentPeriod.phase = "schemes-processed";
    blob.rosterLocked = true;
    if (by !== "commissioner") {
      const label =
        (blob.currentPeriod.type === "playoff" ? "Playoff Round " : "Week ") + blob.currentPeriod.number;
      blob.activityLog.push({
        id: "act_autoschemes_" + blob.currentPeriod.type + blob.currentPeriod.number,
        period: { ...blob.currentPeriod },
        periodLabel: label,
        ts: new Date().toISOString(),
        type: "auto",
        text:
          "Schemes for " + label + " were processed automatically at the " +
          deadlineWords(DEADLINES.schemes) + " deadline. Rosters are now locked.",
      });
    }
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
  };
}

export async function finalizePeriod(db, { leagueId, token, expect, feed }) {
  return commissionerLifecycle(db, leagueId, token, "finalizePeriod", expect, applyFinalize({ feed }));
}

/**
 * Finalize, shared by the button and by the clock (issue #52).
 *
 * THE ONE STEP WITH NO UNDO. It writes `cumulative` - "standings are updated" - and it
 * is legal from `schemes-processed` as well as from `stats`, which means it will score
 * a week of blank stat boxes as a week of zeros for everybody without complaining. The
 * guard against an unattended one doing that is entirely in `advanceEligibility`
 * (server/autoCycle.js), which refuses until every game of the mapped NFL week is
 * final. Nothing here is allowed to assume the caller checked.
 */
function applyFinalize({ feed, by = "commissioner" } = {}) {
  return async (ctx) => {
    const result = finalizeCurrentPeriod(ctx.view);
    if (result.error) return { error: result.error };
    if (by !== "commissioner") {
      const done = ctx.view.currentPeriod;
      const label = (done.type === "playoff" ? "Playoff Round " : "Week ") + done.number;
      result.state.activityLog.push({
        id: "act_autofinal_" + done.type + done.number,
        period: { ...done },
        periodLabel: label,
        ts: new Date().toISOString(),
        type: "auto",
        text: label + " was finalized automatically - every game of NFL week " +
          ctx.period.nfl_week + " was final.",
      });
    }
    return {
      blob: result.state,
      afterPersist: async (client) => {
        await client
          .from("periods")
          .update({ phase: "finalized", finalized_at: new Date().toISOString() })
          .eq("id", ctx.period.id);
        // Finalize advances to the next week, so a brand new period row now exists.
        await mapNewPeriod(client, ctx.rows.seasons[0].id, result.state.currentPeriod, {
          season: ctx.rows.seasons[0].year,
          feed,
        });
      },
    };
  };
}

/* startPlayoffs was here until 2026-09-07 (OQ-16).
 *
 * It was the route behind the Start Playoffs button, and both are gone. A league now
 * nominates the NFL week its playoffs begin, and `finalizePeriod` seeds the bracket when
 * that week arrives - which is what makes the automatic weekly cycle safe. Leaving the
 * route in place would have left a way to start a bracket out of band, in a season whose
 * rosters the clock is already dealing.
 *
 * The bracket is still seeded by exactly the same engine code; `finalizeCurrentPeriod`
 * calls `seedPlayoffBracket` directly, and `mapNewPeriod` below still maps playoff round
 * 1 onto an NFL week the same way it always did - see the note in `finalizePeriod`.
 *
 * The settings themselves are written as an ordinary league blob update, like the scoring
 * config: they are a rule the commissioner sets, not a lifecycle step. */

/**
 * Correct which NFL week this period plays.
 *
 * The default is right for a league that opened on opening weekend and a guess for
 * every other one, so the commissioner gets the last word. Because the default counts
 * forward from the furthest-along mapping (server/schedule.js), correcting one week
 * carries through every week created after it - he sets it once, not every Sunday.
 *
 * Deliberately not phase-gated: the mapping only decides which week a stats pull asks
 * the feed for, so there is no point in the weekly flow where correcting it is unsafe.
 * Passing null unmaps the period, which makes a pull refuse rather than fetch a week
 * nobody vouched for.
 */
export async function setNflWeek(db, { leagueId, token, nflWeek, expect, feed }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const bad = guard(ctx, "setNflWeek", expect, [vkey.period()]);
  if (bad) return bad;
  if (!ctx.period) return fail(404, "This league has no current week.");

  const week = nflWeek === null || nflWeek === "" || nflWeek === undefined ? null : Number(nflWeek);
  if (week !== null && !isValidNflWeek(week)) {
    return fail(400, "An NFL week is a whole number from 1 to 23.");
  }

  const { error } = await db.from("periods").update({ nfl_week: week }).eq("id", ctx.period.id);
  if (error) return fail(500, error.message);

  /* The mapping is what says which week's kickoffs this period locks on, so a
   * correction has to bring the times with it - otherwise the league would keep
   * locking on last week's Thursday. Unmapping clears them for the same reason: no
   * week, no clock, and a stale set of times would be worse than none. */
  if (week === null) {
    await db.from("periods").update({ kickoffs: null, kickoffs_read_at: null }).eq("id", ctx.period.id);
  } else {
    await readKickoffs(db, { ...ctx.period, nfl_week: week }, ctx.rows.seasons[0]?.year, feed);
  }
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

/**
 * Choose when this league's lineups stop being changeable.
 *
 * The whole option, in one column. `gametime` is what every league has always played -
 * each player locked when his own game kicked off, which until now the commissioner
 * enforced by pressing Lock on each of them. `weekly` locks every lineup at the first
 * kickoff of the week, so what a manager has on Thursday evening is what plays.
 *
 * NOT PHASE-GATED, and deliberately so: this is a league rule rather than a move in the
 * week, and there is no phase in which a commissioner should be unable to say what his
 * league plays. It takes effect immediately, which mid-week means it can lock lineups
 * that were open a second ago (switching to `weekly` after Thursday night) or reopen
 * ones that had locked (switching back to `gametime` on Sunday morning, where only the
 * teams already playing stay locked). It never touches a manual lock either way.
 */
export async function setLineupLock(db, { leagueId, token, mode, expect }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const bad = guard(ctx, "setLineupLock", expect, [vkey.season()]);
  if (bad) return bad;

  if (!LINEUP_LOCK_MODES.includes(mode)) {
    return fail(400, "A lineup lock is either '" + LINEUP_LOCK_MODES.join("' or '") + "'.");
  }
  const season = ctx.rows.seasons[0];
  if (!season) return fail(404, "This league has no season.");

  const { error } = await db
    .from("seasons")
    .update({ lineup_lock: mode, version: (season.version ?? 1) + 1 })
    .eq("id", season.id);
  if (error) return fail(500, error.message);
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

/**
 * Re-read this week's kickoff times.
 *
 * Needed because the schedule moves: flex scheduling can turn a Sunday night game into
 * a one o'clock kickoff up to twelve days out, and a league locking on the old time
 * would let a manager move a player whose game has already started. Reading them again
 * is cheap and the commissioner is the one who knows a game moved.
 *
 * Unlike the read that happens at deal time, this one REPORTS what it found - it was
 * pressed on purpose, so "the schedule has no times for that week yet" is the answer,
 * not a silence.
 */
export async function refreshKickoffs(db, { leagueId, token, expect, feed }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const bad = guard(ctx, "refreshKickoffs", expect, [vkey.period()]);
  if (bad) return bad;
  if (!ctx.period) return fail(404, "This league has no current week.");

  const outcome = await readKickoffs(db, ctx.period, ctx.rows.seasons[0]?.year, feed);
  if (!outcome.ok) {
    return fail(409, "Could not read the kickoff times - " + outcome.error + ". This week's are unchanged.", {
      reason: "kickoffs",
      view: ctx.view,
    });
  }
  return good({
    view: hydrate(await fetchLeagueRows(db, leagueId)),
    report: { teams: outcome.count, nflWeek: ctx.period.nfl_week, at: new Date().toISOString() },
  });
}

/* --------------------------- league administration ----------------------- */

/** Commissioner-only, low-frequency, genuinely league-wide (teams, pool, scoring). */
/**
 * Rebuild the player pool from each NFL team's current starters.
 *
 * The designer's answer to OQ-4b: the hand-typed pool was typed out of necessity, so the
 * pool becomes 1 QB, 2 RB, 2 WR and 1 TE per team - 192 rows - and tracks depth-chart
 * moves and injuries instead of going stale.
 *
 * HEAD COACHES ARE NOT IN THAT NUMBER. Scott looked at what the free coach data actually
 * said on 2026-09-04, did not recognise half of it, and made coaches his (OQ-4d). The
 * league still holds 224 rows; the refresh is responsible for 192 of them.
 *
 * Commissioner-pressed, pre-deal only, never automatic and never mid-week. It writes
 * over its own work and never over a person's: see server/pool.js for that rule, which
 * is where it is tested.
 *
 * Retiring means status OUT, not deletion - a deleted player would break the rosters,
 * stat lines and results that already reference him.
 */
export async function refreshPlayerPool(db, { leagueId, token, expect, feed }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const bad = guard(ctx, "refreshPlayerPool", expect, []);
  if (bad) return bad;

  const outcome = await runPoolRefresh(db, { leagueId, rows: ctx.rows, feed });
  if (outcome.error) {
    return fail(outcome.error.status, outcome.error.message, {
      reason: outcome.error.reason,
      view: ctx.view,
    });
  }
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)), report: outcome.report });
}

/**
 * The refresh itself, with no opinion about who asked for it.
 *
 * Split out for the same reason `runStatsPull` was: the SCHEDULED deal (issue #52)
 * refreshes the pool first exactly as the commissioner's "Refresh Pool & Deal Rosters"
 * button does, and a second implementation of "what the depth charts say now" is the
 * last thing this project wants - it would be a very quiet way to deal from a different
 * pool on a Tuesday morning than on a Tuesday afternoon.
 *
 * AUTHORIZATION AND PHASE GUARDS STAY WITH THE CALLERS. What must not differ is what
 * gets written, which is everything below.
 *
 * @returns {{ report: object }|{ error: { status: number, message: string, reason: string } }}
 */
async function runPoolRefresh(db, { leagueId, rows, feed }) {
  const season = rows.seasons[0]?.year ?? new Date().getUTCFullYear();

  let snapshot;
  let injuries = { ok: false, reason: "not read" };
  try {
    /* `feed` is injected by tests. Otherwise the environment chooses, and it can only
     * ever choose the recorded fixture against a local database - see server/feed/index.js. */
    const source = feed || (await selectFeed());

    /* TWO FILES, ONE OF THEM OPTIONAL. The depth chart is the pool and a failure there
     * is fatal to the refresh. The roster file only adds injury status, is fifteen times
     * the size, and cannot be read a piece at a time (see ROSTER_URL) - so it is allowed
     * to fail on its own. Losing it costs a day or two of lag on a player ESPN has not
     * demoted yet; treating it as fatal would cost the refresh entirely.
     *
     * A source that cannot report roster status at all - the recorded fixture - simply
     * returns none, and every depth-chart player is treated as healthy. */
    const [chart, rosterStatus] = await Promise.all([
      source.fetchDepthChart({ season }),
      source.fetchRosterStatus
        ? source.fetchRosterStatus({ season }).then(
            (r) => {
              injuries = { ok: true, week: r.week };
              return r;
            },
            (err) => {
              injuries = { ok: false, reason: err.message };
              return null;
            }
          )
        : Promise.resolve(null),
    ]);
    snapshot = {
      at: chart.snapshotAt,
      ...source.buildPool({ depthPlayers: chart.players, rosterStatus }),
    };
  } catch (err) {
    /* A feed that is down, late, or has changed shape must not take the league with it.
     * The pool is left exactly as it was and the commissioner deals from what he has. */
    return {
      error: {
        status: 502,
        message: "Could not reach the stats feed - the pool is unchanged. " + err.message,
        reason: "feed",
      },
    };
  }

  if (!snapshot.players.length) {
    return {
      error: {
        status: 502,
        message: "The stats feed returned no players - the pool is unchanged.",
        reason: "feed-empty",
      },
    };
  }

  const leaguePlayers = rows.players.filter((p) => p.league_id === leagueId);
  const plan = planPoolRefresh({
    existing: leaguePlayers,
    wanted: snapshot.players,
    at: snapshot.at,
  });

  if (plan.inserts.length) {
    const inserts = plan.inserts.map((r, i) => ({
      ...r,
      league_id: leagueId,
      // legacy_id keeps the artifact-shaped view working; hydrate maps players by it.
      legacy_id: "pf" + Date.now().toString(36) + "_" + i,
      active: true,
      version: 1,
    }));
    const { error } = await db.from("players").insert(inserts);
    if (error) return { error: { status: 500, message: "Adding new players failed: " + error.message, reason: "write" } };
  }

  /* Batched deliberately: one request per changed player is a few hundred sequential
   * round trips from a Netlify function, and the first live refresh is the worst case
   * because every matched row gains its provider ids. See poolWriteRows. */
  for (const chunk of poolWriteRows({
    patches: plan.updates.concat(plan.retires),
    existing: leaguePlayers,
  })) {
    const { error } = await db.from("players").upsert(chunk, { onConflict: "id" });
    if (error) return { error: { status: 500, message: "Updating the pool failed: " + error.message, reason: "write" } };
  }

  return {
    report: {
      ...plan.report,
      gaps: snapshot.gaps,
      sidelined: snapshot.sidelined ?? [],
      injuries,
      season,
    },
  };
}

/**
 * Fill this week's stat lines in from the feed.
 *
 * The Sunday-night payoff of Phase 4, and the promise it has to keep is the one the
 * pool refresh already keeps: it writes its own work and never a person's. What the
 * commissioner typed stays exactly as he typed it and the feed's opinion is recorded
 * beside it. server/stats.js holds that rule and is where it is tested.
 *
 * Commissioner-pressed. Nothing here finalizes anything - the week still ends when he
 * says it does, which is the whole point of section 6 of the plan.
 *
 * THREE REFUSALS, all of which leave the week exactly as it was:
 *   - an unmapped period, because a pull needs a week of football to ask for and
 *     guessing one would write another week's numbers into this one;
 *   - unlocked rosters, for the same reason `setStatLine` refuses (OQ-E): stats are
 *     keyed by slot, so a lineup change after a pull would move these numbers to a
 *     different player with nothing on screen to say so;
 *   - a feed that is down, late, or 404 - which before the season's first game is the
 *     ordinary state of affairs rather than a fault.
 */
export async function pullStats(db, { leagueId, token, expect, feed }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const bad = guard(ctx, "pullStats", expect, []);
  if (bad) return bad;
  if (!ctx.period) return fail(404, "This league has no current week.");

  const nflWeek = ctx.period.nfl_week;
  if (!isValidNflWeek(nflWeek)) {
    return fail(409, "This week is not mapped to an NFL week yet - set that first and the pull will know which week to ask for.", {
      reason: "unmapped",
      view: ctx.view,
    });
  }
  if (!ctx.period.roster_locked) {
    return fail(409, "Lock the rosters before pulling stats - otherwise a lineup change would move these numbers to a different player.", {
      reason: "unlocked",
      view: ctx.view,
    });
  }

  const outcome = await runStatsPull(db, {
    leagueId,
    rows: ctx.rows,
    period: ctx.period,
    feed,
  });
  if (outcome.error) {
    return fail(outcome.error.status, outcome.error.message, {
      reason: outcome.error.reason,
      view: ctx.view,
    });
  }

  return good({
    view: hydrate(await fetchLeagueRows(db, leagueId)),
    report: outcome.report,
  });
}

/**
 * The pull itself, with no opinion about who asked for it.
 *
 * Split out of `pullStats` so the scheduled job (stage 7) runs the SAME code rather
 * than a second implementation of it - the thing this project has consistently refused
 * to have, for the same reason `src/engine/` is shared with the server. A second pull
 * that drifted from the first would be a very quiet way to write different numbers on
 * a Sunday night than on a Monday morning.
 *
 * The AUTHORIZATION and the PHASE GUARDS stay with the callers, because they genuinely
 * differ: the button answers to a commissioner's session and returns 409s he reads on
 * screen, while the scheduler answers to a cron and treats the same conditions as
 * reasons to skip a league silently (server/autoPull.js). What must NOT differ is what
 * gets written, which is everything below.
 *
 * @returns {{ report: object }|{ error: { status: number, message: string, reason: string } }}
 */
async function runStatsPull(db, { leagueId, rows, period, feed }) {
  const nflWeek = period.nfl_week;
  const season = rows.seasons[0]?.year ?? new Date().getUTCFullYear();

  let feedLines;
  let results;
  let stoppedEarly;
  try {
    /* `feed` is injected by tests. Otherwise the environment chooses, and it can only
     * ever choose the recorded fixture against a local database - see feed/index.js. */
    const source = feed || (await selectFeed());
    const [stats, games] = await Promise.all([
      source.fetchWeeklyStats({ season, week: nflWeek }),
      source.fetchGameResults({ season, week: nflWeek }),
    ]);
    feedLines = stats.lines;
    stoppedEarly = stats.stoppedEarly;
    results = games.results;
  } catch (err) {
    return {
      error: {
        status: 502,
        reason: "feed",
        message: "Could not reach the stats feed - this week is unchanged. " + err.message,
      },
    };
  }

  if (!feedLines.length && results.size === 0) {
    /* Not an error: before Sunday's games finish this is simply the truth, and saying
     * so is more use than an empty success. */
    return {
      error: {
        status: 409,
        reason: "feed-empty",
        message: "The feed has nothing for NFL week " + nflWeek + " yet - this week is unchanged.",
      },
    };
  }

  const starters = rows.roster_slots.filter(
    (r) => r.period_id === period.id && r.area === "starter"
  );
  const { writes, report } = planStatsPull({
    starters,
    players: rows.players.filter((p) => p.league_id === leagueId),
    teams: rows.teams,
    statLines: rows.stat_lines.filter((s) => s.period_id === period.id),
    feedLines,
    results,
    at: new Date().toISOString(),
    periodId: period.id,
  });

  for (const chunk of statWriteRows({ writes })) {
    const { error } = await db
      .from("stat_lines")
      .upsert(chunk, { onConflict: "period_id,team_id,slot" });
    if (error) {
      return {
        error: { status: 500, reason: "write", message: "Writing the stat lines failed: " + error.message },
      };
    }
  }

  return { report: { ...report, season, nflWeek, stoppedEarly } };
}

/**
 * Turn automatic stats pulls on or off for this league.
 *
 * Commissioner only, and NOT phase-gated: whether a robot may press his button is a
 * standing decision about his league, not a move inside a week, and there is no phase
 * in which he should be unable to change his mind about it. Turning it off takes
 * effect on the next run of the job - there is nothing to cancel, because a pull is a
 * single request rather than a thing that stays running.
 *
 * It grants no new power. Everything the scheduler does, the button already does, on
 * the same guards, and a manual line is never overwritten either way.
 */
export async function setAutoPullStats(db, { leagueId, token, enabled }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  if (typeof enabled !== "boolean") return fail(400, "enabled must be true or false.");

  const { error } = await db
    .from("leagues")
    .update({ auto_pull_stats: enabled })
    .eq("id", leagueId);
  if (error) return fail(500, error.message);

  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

/**
 * Stage 7: pull every opted-in league's stats, on a schedule instead of a button.
 *
 * WHAT MAKES THIS SAFE IS THAT IT IS NOT NEW. It runs `runStatsPull` - the same code
 * the commissioner's button runs - behind the same guards, and inherits every promise
 * server/stats.js makes: a manual line is never overwritten, a player the feed has
 * nothing for is left blank rather than zeroed, and a coach whose game has not finished
 * is not given a result. Repeated runs are the point rather than a hazard: a `feed`
 * line may be corrected by a later pull, so Thursday's numbers are simply improved on
 * Sunday and again on Tuesday.
 *
 * NO NEW CREDENTIAL. This is called from a scheduled Netlify function that already
 * holds the secret key - it is a peer of netlify/functions/api.mjs, not a client of
 * it - so there is no scheduler token to mint, store, rotate or leak, and no new way
 * into the API. `verifySession` is untouched and there is still exactly one credential
 * in this system: an account.
 *
 * EVERY REFUSAL IS A SKIP. See server/autoPull.js for why each guard means "not yet"
 * rather than "something is wrong", and why the guards run before the feed is fetched.
 *
 * @param {object}  db     a secret-key client
 * @param {object}  feed   injected by tests; otherwise feed/index.js chooses
 * @returns {{ status, body }} an ops-shaped result whose body carries the run summary
 */
export async function scheduledStatsPull(db, { feed } = {}) {
  const { data: leagues, error } = await db
    .from("leagues")
    .select("id, name, auto_pull_stats")
    .eq("auto_pull_stats", true);
  if (error) return fail(500, "Could not list leagues: " + error.message);

  const outcomes = [];
  for (const league of leagues ?? []) {
    const where = { leagueId: league.id, league: league.name };
    let rows;
    try {
      rows = await fetchLeagueRows(db, league.id);
    } catch (err) {
      outcomes.push({ ...where, status: "failed", why: "could not read the league: " + err.message });
      continue;
    }
    if (!rows) {
      outcomes.push({ ...where, status: "skipped", why: "no such league" });
      continue;
    }

    /* The same "current period" the button would act on, found the same way. */
    const view = hydrate(rows);
    const period = rows.periods.find((p) => p.id === view?._meta?.periodId) ?? null;

    const { eligible, why } = pullEligibility(league, period);
    if (!eligible) {
      outcomes.push({ ...where, status: "skipped", why });
      continue;
    }

    const outcome = await runStatsPull(db, { leagueId: league.id, rows, period, feed });
    if (outcome.error) {
      /* A feed that has nothing for this week yet is the ordinary state of a Thursday
       * afternoon, not a fault - the button says so on screen and the job says so in
       * its log. Anything else is worth surfacing as a failure. */
      const soft = outcome.error.reason === "feed-empty";
      outcomes.push({
        ...where,
        status: soft ? "skipped" : "failed",
        why: outcome.error.message,
      });
      continue;
    }

    const { filled, kept, missing } = outcome.report;
    outcomes.push({
      ...where,
      status: "pulled",
      why: why,
      filled: filled.length,
      kept: kept.length,
      missing: missing.length,
    });
  }

  return good(summarize(outcomes));
}

/**
 * Turn the weekly cycle's clock on or off, and say which clock it is.
 *
 * THE SAME SHAPE AS `setAutoPullStats`, and for the same reasons: commissioner-only,
 * per league, default off, written by direct update rather than through the blob so an
 * ordinary save cannot flip it. What is different is what it grants, and that is worth
 * being plain about - unlike the stats pull, this one CHANGES HOW THE LEAGUE IS PLAYED:
 *
 *   - `processSchemes` on a clock makes 3am Thursday a real deadline. A manager who
 *     forgets loses his scheme for the week, where today the commissioner waits.
 *   - `advanceWeek` finalizes without a person looking at the numbers first. It refuses
 *     until every game of the mapped NFL week is final (server/autoCycle.js), but a
 *     finalize is still the one step in this app with no undo.
 *
 * Both are off until he says otherwise, and every button he has today still works and
 * still wins - the clock presses the same buttons, it does not replace them.
 *
 * Each field is optional: sending only `tz` changes only the timezone.
 */
export async function setAutoCycle(db, { leagueId, token, processSchemes, advanceWeek, tz }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }

  const patch = {};
  for (const [key, value] of [
    ["auto_process_schemes", processSchemes],
    ["auto_advance_week", advanceWeek],
  ]) {
    if (value === undefined) continue;
    if (typeof value !== "boolean") return fail(400, "Each switch must be true or false.");
    patch[key] = value;
  }
  if (tz !== undefined) {
    /* Refused at the door rather than three hours later inside a cron, where the only
     * symptom would be a league that quietly stopped advancing. */
    if (!isValidTimeZone(tz)) return fail(400, "That is not a timezone this app knows.");
    patch.tz = tz;
  }
  if (!Object.keys(patch).length) return fail(400, "Nothing to change.");

  const { error } = await db.from("leagues").update(patch).eq("id", leagueId);
  if (error) return fail(500, error.message);

  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

/**
 * Issue #52: run the weekly cycle on a clock, for the leagues that asked for it.
 *
 * Scott's request in his own words, recorded as OQ-14: rosters dealt automatically on
 * Tuesday morning, schemes processed at 3am Thursday, standings updated when the
 * numbers are in.
 *
 * WHAT MAKES THIS SAFE IS THAT IT IS NOT NEW. Every step runs the SAME `apply` the
 * commissioner's button runs - `applyProcessSchemes`, `applyFinalize`, `applyDeal` -
 * through the same `runLifecycle` and the same `persistBlob`. There is no second
 * implementation of dealing a week or resolving a scheme, and there never will be.
 *
 * NO NEW CREDENTIAL. Called from a scheduled Netlify function that already holds the
 * secret key - a peer of netlify/functions/api.mjs, not a client of it - so there is no
 * scheduler token to mint, store, rotate or leak, no new route into the API, and
 * `verifySession` is untouched. Exactly the shape stage 7's stats pull took.
 *
 * EVERY REFUSAL IS A SKIP, and the guards run in cost order: the free ones first, the
 * feed only for a league that could actually act on it. Most hours of most weeks every
 * league fails an early guard and the job makes no outbound request at all.
 *
 * ORDER WITHIN A LEAGUE IS ADVANCE, THEN SCHEMES, and it is deliberate. On a Tuesday
 * the advance finalizes and deals, leaving the new week in `dealt` with `dealt_at` set
 * to now - which is AFTER the most recent Thursday deadline, so the scheme step
 * correctly skips it rather than processing an hours-old week's schemes on the spot.
 *
 * @param {object} db    a secret-key client
 * @param {number} now   epoch ms, injected so tests can freeze the clock
 * @param {object} feed  injected by tests; otherwise feed/index.js chooses
 */
export async function scheduledWeeklyCycle(db, { now = Date.now(), feed } = {}) {
  const { data: leagues, error } = await db
    .from("leagues")
    .select("id, name, tz, auto_process_schemes, auto_advance_week, auto_pull_stats")
    .or("auto_process_schemes.eq.true,auto_advance_week.eq.true");
  if (error) return fail(500, "Could not list leagues: " + error.message);

  const outcomes = [];
  for (const league of leagues ?? []) {
    const where = { leagueId: league.id, league: league.name, tz: zoneOf(league) };
    const steps = [];
    let failure = null;

    try {
      const advanced = await advanceOneLeague(db, { league, now, feed });
      steps.push(...advanced.steps);
      if (advanced.failure) failure = advanced.failure;

      if (!failure) {
        const processed = await processOneLeague(db, { league, now });
        steps.push(...processed.steps);
        if (processed.failure) failure = processed.failure;
      }
    } catch (err) {
      failure = "unexpected: " + (err?.message ?? String(err));
    }

    if (failure) {
      outcomes.push({ ...where, status: "failed", why: failure, steps });
    } else {
      const acted = steps.filter((st) => st.did);
      outcomes.push({
        ...where,
        status: acted.length ? "acted" : "skipped",
        why: acted.length ? acted.map((st) => st.step).join(" + ") : steps.map((st) => st.why).join("; "),
        steps,
      });
    }
  }

  return good(summarizeCycle(outcomes));
}

/**
 * Tuesday morning: finalize the week just played, and deal the next one.
 *
 * TWO STEPS, NOT ONE, and either can happen without the other. The commissioner very
 * often finalizes himself on Monday night, which leaves the week in `pre-deal` with
 * nothing to finalize - a job that could only "finalize and then deal" would skip that
 * league forever. So the finalize is attempted, and then the deal is attempted
 * regardless of whether it ran. See `dealEligibility` in server/autoCycle.js.
 */
async function advanceOneLeague(db, { league, now, feed }) {
  const steps = [];
  const ctx = await systemContext(db, league.id);
  if (ctx.error) return { steps: [{ step: "advance", did: false, why: "no such league" }] };

  const finalize = await finalizeIfReady(db, { league, ctx, now, feed });
  steps.push(...finalize.steps);
  if (finalize.failure) return { steps, failure: finalize.failure };

  /* Re-read ONLY if the finalize actually moved something. On an ordinary hour - which
   * is almost every hour - nothing did, so the league we just read is still current and
   * the deal step is one more pure comparison rather than a second full read of every
   * table. That matters at 24 runs a day, per league, for a job that acts twice a week. */
  const acted = finalize.steps.some((st) => st.did);
  const deal = await dealIfDue(db, { league, now, feed, ctx: acted ? null : ctx });
  steps.push(...deal.steps);
  if (deal.failure) return { steps, failure: deal.failure };

  return { steps };
}

/** Score the week just played - but only once its football is genuinely over. */
async function finalizeIfReady(db, { league, ctx, now, feed }) {
  const teamCount = periodTeamCount(ctx.view);

  /* The cheap guards first, and only then the feed - the same cost discipline
   * server/autoPull.js keeps. `needsResults` is the cue that everything else passed. */
  let verdict = advanceEligibility({ league, period: ctx.period, teamCount, now });
  if (!verdict.eligible && !verdict.needsResults) {
    return { steps: [{ step: "finalize", did: false, why: verdict.why }] };
  }

  let results;
  try {
    const source = feed || (await selectFeed());
    ({ results } = await source.fetchGameResults({
      season: ctx.rows.seasons[0]?.year,
      week: ctx.period.nfl_week,
    }));
  } catch (err) {
    /* A feed that is down on a Tuesday morning is a reason to try again in an hour, not
     * a reason to page anyone - and emphatically not a reason to finalize anyway. */
    return { steps: [{ step: "finalize", did: false, why: "could not read the results: " + err.message }] };
  }

  verdict = advanceEligibility({ league, period: ctx.period, teamCount, results, now });
  if (!verdict.eligible) return { steps: [{ step: "finalize", did: false, why: verdict.why }] };

  const steps = [];

  /* ONE LAST PULL BEFORE THE NUMBERS ARE COMMITTED, for a league that already asked for
   * automatic pulls. The three-hourly job may have last run some hours ago, and this is
   * the final chance for a corrected line to land before it becomes a standings point.
   * Best effort: it never overwrites a line the commissioner typed, and a failure here
   * is not a reason to hold the week up. */
  if (league.auto_pull_stats && ctx.period.roster_locked) {
    const pulled = await runStatsPull(db, {
      leagueId: league.id, rows: ctx.rows, period: ctx.period, feed,
    });
    steps.push({
      step: "final pull",
      did: !pulled.error,
      why: pulled.error ? pulled.error.message : pulled.report.filled.length + " line(s) filled",
    });
  }

  /* Re-read: the pull just wrote stat lines, and finalizing off a stale view would
   * score the week without them. */
  const fresh = await systemContext(db, league.id);
  if (fresh.error) return { steps, failure: "the league vanished mid-run" };

  const finalized = await runLifecycle(db, league.id, fresh, applyFinalize({ feed, by: "the schedule" }));
  if (finalized.status !== 200) {
    return { steps, failure: "finalize failed: " + (finalized.body?.error ?? finalized.status) };
  }
  steps.push({ step: "finalize", did: true, why: verdict.why });
  return { steps };
}

/** Deal the week in front of the league, if this is the morning to do it. */
async function dealIfDue(db, { league, now, feed, ctx: known = null }) {
  const ctx = known ?? (await systemContext(db, league.id));
  if (ctx.error) return { steps: [{ step: "deal", did: false, why: "no such league" }] };

  const verdict = dealEligibility({
    league,
    next: ctx.period,
    teamCount: periodTeamCount(ctx.view),
    playoffsComplete: ctx.view?.playoffConfig?.completed === true,
    previousFinalizedAt: lastFinalizedAt(ctx.rows),
    now,
  });
  if (!verdict.eligible) {
    if (verdict.endOfSeason) await noteEndOfSeason(db, ctx, league.id);
    return { steps: [{ step: "deal", did: false, why: verdict.why }] };
  }

  /* Refresh the pool first, exactly as "Refresh Pool & Deal Rosters" does - Scott's
   * 2026-09-06 answer was that a deal should be off live rosters every time, and an
   * automatic deal is no less a deal. A feed failure notes itself and deals anyway. */
  const refreshed = await runPoolRefresh(db, { leagueId: league.id, rows: ctx.rows, feed });
  const poolRefresh = refreshed.error
    ? { ok: false, why: refreshed.error.message }
    : { ok: true, report: refreshed.report };

  /* Re-read, because the refresh just rewrote the players the deal is about to read. */
  const beforeDeal = await systemContext(db, league.id);
  if (beforeDeal.error) return { steps: [], failure: "the league vanished mid-run" };

  const dealt = await runLifecycle(
    db, league.id, beforeDeal,
    applyDeal({ poolRefresh, feed, by: "the schedule", now })
  );
  if (dealt.status !== 200) {
    return { steps: [], failure: "deal failed: " + (dealt.body?.error ?? dealt.status) };
  }
  return { steps: [{ step: "deal", did: true, why: verdict.why }] };
}

/** When the season's most recently finished week ended, or null if none has. */
function lastFinalizedAt(rows) {
  const stamps = (rows.periods ?? [])
    .map((p) => p.finalized_at)
    .filter(Boolean)
    .sort();
  return stamps.length ? stamps[stamps.length - 1] : null;
}

/** Thursday 3am: resolve every block, steal and redraw, and close the week's schemes. */
async function processOneLeague(db, { league, now }) {
  const ctx = await systemContext(db, league.id);
  if (ctx.error) return { steps: [{ step: "schemes", did: false, why: "no such league" }] };

  const verdict = schemesEligibility({
    league, period: ctx.period, teamCount: periodTeamCount(ctx.view), now,
  });
  if (!verdict.eligible) return { steps: [{ step: "schemes", did: false, why: verdict.why }] };

  const out = await runLifecycle(db, league.id, ctx, applyProcessSchemes({ by: "the schedule" }));
  if (out.status !== 200) {
    return { steps: [], failure: "process schemes failed: " + (out.body?.error ?? out.status) };
  }
  return { steps: [{ step: "schemes", did: true, why: verdict.why }] };
}

/** Teams eligible for the period in front of us - all of them, or the survivors. */
function periodTeamCount(view) {
  if (!view) return 0;
  return view.currentPeriod?.type === "playoff"
    ? (view.playoffConfig?.activeTeamIds ?? []).length
    : (view.teams ?? []).length;
}

/**
 * Say in the app - not just in a log nobody reads - that the clock has run out of
 * regular season and it is the commissioner's move.
 *
 * Written once. The activity log's ids are deterministic elsewhere for the same reason:
 * an hourly job that appended this every hour would bury the week it belongs to.
 */
async function noteEndOfSeason(db, ctx, leagueId) {
  const id = "act_seasonend_" + (ctx.view?.currentPeriod?.number ?? 0);
  if ((ctx.view?.activityLog ?? []).some((e) => e.id === id)) return;
  const blob = JSON.parse(JSON.stringify(ctx.view));
  blob.activityLog.push({
    id,
    period: { ...blob.currentPeriod },
    periodLabel: (blob.currentPeriod.type === "playoff" ? "Playoff Round " : "Week ") + blob.currentPeriod.number,
    ts: new Date().toISOString(),
    type: "auto",
    text:
      "That was the last week of the regular season, so nothing more will be dealt " +
      "automatically. Starting the playoffs is yours - Commissioner -> Playoffs.",
  });
  await runLifecycle(db, leagueId, ctx, async () => ({ blob }));
}

export async function replaceLeague(db, { leagueId, token, blob }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  await persistBlob(db, ctx.rows, blob, {
    leagueKey: ctx.rows.leagues[0].name === "Pigskin Poker (Demo League)" ? "demo" : leagueId,
    year: ctx.rows.seasons[0].year,
    /* A player appearing through this path was added by the commissioner on his own
     * screen, so the pool refresh must never touch him. See server/pool.js. */
    newPlayerSource: "manual",
  });
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}

/* ======================================================================== */
/*  SITE ADMIN - the head-coach list                                        */
/* ======================================================================== */
/*
 * The only operations in this file that are not scoped to one league, and the only ones
 * authorized by anything other than a `league_members` row. They exist because
 * `player_pool` is shared by every league and its 32 Coach rows are one fact about the
 * NFL rather than 32 decisions each league gets to make - issue #40, and the reasoning
 * is written out at the top of server/coaches.js.
 *
 * Every one of them takes an ACCOUNT token, like createLeague and myLeagues, because
 * there is no league to resolve a role against.
 */

/** Everything the coaches screen needs to read the whole picture. */
async function coachTables(db) {
  const [template, leagues, coaches] = await Promise.all([
    db.from("player_pool").select("legacy_id, name, nfl_team").eq("position", "Coach"),
    db.from("leagues").select("id, name"),
    db.from("players").select("id, league_id, name, nfl_team, retired").eq("position", "Coach").eq("active", true),
  ]);
  for (const r of [template, leagues, coaches]) {
    if (r.error) throw new Error(r.error.message);
  }
  return {
    templateRows: template.data ?? [],
    leagueRows: coaches.data ?? [],
    leagueNames: new Map((leagues.data ?? []).map((l) => [l.id, l.name])),
  };
}

/**
 * Am I a site admin?
 *
 * Answers for the CALLER ALONE and never lists anybody. That is what lets `site_admins`
 * be unreadable from the browser: the client needs one boolean to decide whether to
 * draw the Admin pill, not the table.
 *
 * Not folded into `whoami`, which resolves a role inside one league and would then need
 * a league it does not have.
 */
export async function adminWhoami(db, { accountToken }) {
  const user = await verifyAccount(db, accountToken);
  if (!user) return fail(401, AUTH_ERRORS.noSession.error);
  const admin = await verifySiteAdmin(db, accountToken);
  return good({ admin: !!admin, email: user.email ?? null });
}

/** The 32 teams, the master name for each, and wherever a league disagrees. */
export async function listCoaches(db, { accountToken }) {
  const admin = await verifySiteAdmin(db, accountToken);
  if (!admin) return fail(AUTH_ERRORS.notSiteAdmin.status, AUTH_ERRORS.notSiteAdmin.error);
  const tables = await coachTables(db);
  return good(summarizeCoaches(tables));
}

/**
 * Set one team's head coach, everywhere.
 *
 * The template so new leagues are born right, and every existing league's live Coach row
 * so the season being played right now is right too. Reaching into another league's
 * `players` rows is a boundary this app otherwise never crosses; server/coaches.js
 * carries the argument for why a coach NAME is the one thing on the far side of it, and
 * the short version is that nothing scores off it.
 *
 * ONE CAVEAT WORTH KNOWING, because it will look like a bug. A commissioner with the
 * league already open on his screen holds a whole copy of the pool, and his next save
 * writes it back - old coach name included. He sees the new name as soon as he reloads,
 * and pressing it again fixes it. That is the same last-writer-wins the pool has always
 * had for a name (see replaceLeague); it is not worth a version column for a field that
 * cannot affect a point.
 */
export async function setCoach(db, { accountToken, team, name }) {
  const admin = await verifySiteAdmin(db, accountToken);
  if (!admin) return fail(AUTH_ERRORS.notSiteAdmin.status, AUTH_ERRORS.notSiteAdmin.error);

  const tables = await coachTables(db);
  const plan = planCoachUpdate({ team, name, ...tables });
  if (plan.error) return fail(400, plan.error);

  if (plan.template) {
    const { error } = await db
      .from("player_pool").update({ name: plan.report.name })
      .eq("legacy_id", plan.template.legacy_id);
    if (error) return fail(500, "Updating the shared pool failed: " + error.message);
  }

  if (plan.updates.length) {
    /* One statement for every league at once. The rows differ only in the column being
     * set, so there is nothing to upsert row by row - and an update by id list cannot
     * touch anything the plan did not choose. */
    const { error } = await db
      .from("players").update({ name: plan.report.name })
      .in("id", plan.updates.map((u) => u.id));
    if (error) return fail(500, "Updating the leagues failed: " + error.message);
  }

  const after = await coachTables(db);
  return good({ report: plan.report, ...summarizeCoaches(after) });
}

/**
 * Push the whole master list into every league.
 *
 * The one-press fix for a league that was born wrong - it is 32 setCoach calls with the
 * names already in the template, so it changes nothing that already agrees and reports
 * every league it could not touch. Nothing here reads a feed: the list is the admin's.
 */
export async function syncCoaches(db, { accountToken }) {
  const admin = await verifySiteAdmin(db, accountToken);
  if (!admin) return fail(AUTH_ERRORS.notSiteAdmin.status, AUTH_ERRORS.notSiteAdmin.error);

  const tables = await coachTables(db);
  const ids = [];
  const byName = new Map();
  const skipped = [];
  const teamsChanged = [];

  for (const team of NFL_TEAM_NAMES) {
    const tpl = tables.templateRows.find((r) => r.nfl_team === team);
    if (!tpl) {
      skipped.push({ team, reason: "the shared pool has no coach for this team" });
      continue;
    }
    const plan = planCoachUpdate({ team, name: tpl.name, ...tables });
    if (plan.error) {
      skipped.push({ team, reason: plan.error });
      continue;
    }
    for (const u of plan.updates) {
      ids.push(u.id);
      byName.set(u.id, tpl.name);
    }
    if (plan.updates.length) teamsChanged.push({ team, name: tpl.name, count: plan.updates.length });
    for (const s of plan.report.skipped) skipped.push({ team, ...s });
  }

  /* Grouped by the name being written, so this is at most 32 statements rather than one
   * per row - and usually far fewer, because most teams already agree everywhere. */
  const groups = new Map();
  for (const id of ids) {
    const n = byName.get(id);
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(id);
  }
  for (const [n, list] of groups) {
    const { error } = await db.from("players").update({ name: n }).in("id", list);
    if (error) return fail(500, "Updating the leagues failed: " + error.message);
  }

  const after = await coachTables(db);
  return good({
    report: { rowsUpdated: ids.length, teamsChanged, skipped },
    ...summarizeCoaches(after),
  });
}
