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
  AUTH_ERRORS,
  canActForTeam,
  createSession,
  destroySession,
  isCommissioner,
  verifyCode,
  verifySession,
} from "./auth.js";

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
  const session = await verifySession(db, token);
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

export async function loginCommissioner(db, { leagueId, code }) {
  const { data } = await db
    .from("league_secrets")
    .select("commissioner_code_hash")
    .eq("league_id", leagueId)
    .maybeSingle();
  if (!data || !verifyCode(code, data.commissioner_code_hash)) {
    return fail(AUTH_ERRORS.badCode.status, AUTH_ERRORS.badCode.error);
  }
  const { token, expiresAt } = await createSession(db, { leagueId, role: "commissioner" });
  return good({ token, expiresAt, role: "commissioner", teamId: null });
}

export async function loginManager(db, { leagueId, teamLegacyId, code }) {
  const rows = await fetchLeagueRows(db, leagueId);
  if (!rows) return fail(404, "League not found.");
  const team = teamRow(rows, teamLegacyId);
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
    return fail(AUTH_ERRORS.badCode.status, AUTH_ERRORS.badCode.error);
  }
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

/* -------------------- fine-grained writes: the hot path ------------------- */

export async function setStatLine(db, { leagueId, token, teamId, slot, line, expect }) {
  const ctx = await context(db, leagueId, token);
  if (ctx.error) return ctx.error;
  if (!isCommissioner(ctx.session)) {
    return fail(AUTH_ERRORS.notCommissioner.status, AUTH_ERRORS.notCommissioner.error);
  }
  const bad = guard(ctx, "setStatLine", expect, [vkey.statLine(teamId, slot)]);
  if (bad) return bad;

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
  const { hashCode } = await import("./auth.js");
  const { error } = await db
    .from("team_secrets")
    .upsert({ team_id: team.id, join_code_hash: hashCode(code), updated_at: new Date().toISOString() });
  if (error) return fail(500, error.message);
  // Keep the public flag in step with the hash it describes, or the team picker will
  // lie about whether the team is joinable.
  await db.from("teams").update({ has_join_code: true }).eq("id", team.id);
  return good({ view: hydrate(await fetchLeagueRows(db, leagueId)) });
}
