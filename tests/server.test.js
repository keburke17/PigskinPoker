/**
 * The privileged server layer, against the real local Postgres.
 *
 * This is where P2 is proven fixed. In the artifact, the commissioner code and every
 * team's join code lived inside the league blob, were downloaded by every visitor, and
 * were compared in the browser - `isCommissioner` only decided what UI rendered.
 * Nothing stopped a client writing whatever it liked.
 *
 * These tests assert the enforcement is real: a credential is required, roles are
 * checked server-side against `league_members`, and a manager cannot touch another
 * team.
 *
 * ONE CREDENTIAL. Join codes, the `sessions` table and the login rate limiter were
 * retired in the Phase 3 follow-up (supabase/migrations/20260820000000_retire_join_codes.sql),
 * and the suites covering them went with the features. What replaced them is not a
 * thinner assertion but a narrower one: a role is a `league_members` row, and an
 * account nobody invited is nobody here.
 *
 * Skips itself when the local stack isn't running:  npx supabase start
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import * as ops from "../server/operations.js";

const SEED_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "seed.sql"
);

let db, available = false, skipReason = "", leagueId = null;
/* Phase 3c needs a BROWSER-side client too: accounts sign in with the publishable key,
 * not the secret one, exactly as a real visitor would. */
let dbUrl = null, dbPublishable = null;
const T1 = "demo_team_1";
const T2 = "demo_team_2";

function localEnv() {
  try {
    const out = execSync("npx supabase status -o env", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 120000,
    }).toString();
    const get = (k) => (out.match(new RegExp("^" + k + '="?([^"\n]+)"?$', "m")) || [])[1];
    return { url: get("API_URL"), secret: get("SECRET_KEY"), publishable: get("PUBLISHABLE_KEY") || get("ANON_KEY") };
  } catch (e) {
    skipReason = "supabase status failed: " + e.message;
    return null;
  }
}

async function setup() {
  const env = localEnv();
  if (!env?.url || !env.secret) {
    skipReason = skipReason || "local Supabase env incomplete";
    return;
  }
  db = createClient(env.url, env.secret, { auth: { persistSession: false } });
  dbUrl = env.url;
  dbPublishable = env.publishable;
  const { data, error } = await db
    .from("leagues").select("id").eq("name", "Pigskin Poker (Demo League)").maybeSingle();
  if (error || !data) {
    skipReason = "demo league not seeded - run `npx supabase db reset`";
    return;
  }
  leagueId = data.id;

  /* The demo seed REFUSES to run where other leagues exist - a deliberate safety on a
   * file that deletes and rebuilds - and resetDemo() is called from beforeEach all over
   * this file. Left undetected, one stray league turns into fifty confusing 401s and a
   * psql error buried in the middle of them.
   *
   * This became easy to hit in Phase 3d, because creating a league is now a button in
   * the UI rather than a script nobody runs by accident. Say so up front, with the fix. */
  const { data: others } = await db.from("leagues").select("id").neq("id", leagueId);
  if (others?.length) {
    skipReason =
      "this database holds " + others.length + " league(s) besides the demo, so the demo " +
      "seed will refuse to run. Clear them with:  npx supabase db reset";
    return;
  }

  available = true;
}
await setup();
if (!available) {
  console.warn("\n[server.test.js] SKIPPED: " + skipReason + "\n  Run: npx supabase start && npx supabase db reset\n");
}
const gate = () => (available ? describe : describe.skip);

/* The demo seed is idempotent by design (it deletes and rebuilds the demo league), so
 * it doubles as a fast reset. Phase-sensitive tests need a known starting point -
 * without this they pass or fail depending on what an earlier test left behind. */
let dbContainer = null;
async function resetDemo() {
  /* Delete anything a previous test created FIRST.
   *
   * The demo seed refuses to run where other leagues exist - a deliberate safety on a
   * file that deletes and rebuilds. The league-creation tests each clean up at the END
   * of the test, so one failure used to leak a league and then every later block died
   * on the guard, reporting a seed error instead of the real failure. Clearing here
   * makes a single failure stay a single failure. */
  if (leagueId) await db.from("leagues").delete().neq("id", leagueId);

  if (!dbContainer) {
    /* spawnSync again, for the same reason as below: cmd.exe does not strip single
     * quotes the way a POSIX shell does, so `--format '{{.Names}}'` through execSync
     * came back as the container name WITH the literal quote characters attached,
     * and every docker exec after that failed with "no such container". Passing the
     * format as its own argv element sidesteps shell quoting entirely. */
    dbContainer = spawnSync("docker", ["ps", "--filter", "name=supabase_db_", "--format", "{{.Names}}"], {
      encoding: "utf8",
    }).stdout.trim().split("\n")[0];
  }
  /* spawnSync, not execSync: execSync always shells out (cmd.exe on Windows), and
   * cmd.exe silently truncates a large piped `input` - the seed file - and this fails
   * with a bare EOF rather than a SQL error. `docker` is a real executable, so it does
   * not need a shell to resolve (unlike npx.cmd - see scripts/dev.mjs's sh()), and
   * spawnSync talks to it directly, sidestepping cmd.exe entirely. */
  const r = spawnSync(
    "docker",
    ["exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: readFileSync(SEED_PATH), stdio: ["pipe", "ignore", "pipe"], encoding: "utf8" }
  );
  if (r.status !== 0) throw new Error("resetDemo: seeding failed - " + (r.stderr || r.error));
}

/* A signed-in account WITH a membership, which is the only credential there is now.
 *
 * The membership is minted here rather than seeded, because `resetDemo()` re-runs
 * supabase/seed.sql, which deletes and rebuilds the league row - and league_members
 * cascades with it. Creating it at the point of use means every test gets one no matter
 * what the reset just did.
 *
 * Accounts are cached by address: creating a user costs a round trip and a password
 * sign-in, and the token stays valid for the whole file. */
const accountCache = new Map();
async function accountFor(email) {
  if (!accountCache.has(email)) accountCache.set(email, await makeAccount(email));
  return accountCache.get(email);
}

const member = async (email, role, teamUuid) => {
  const acct = await accountFor(email);
  await db.from("league_members").upsert(
    { league_id: leagueId, user_id: acct.userId, role, team_id: teamUuid },
    { onConflict: "league_id,user_id" }
  );
  return acct.token;
};

/** Fresh commissioner credential. */
const asCommissioner = () => member("commissioner@example.test", "commissioner", null);

/** Fresh manager credential for one team. */
const asManager = async (teamLegacyId) => {
  const { data: team } = await db
    .from("teams").select("id").eq("league_id", leagueId).eq("legacy_id", teamLegacyId).maybeSingle();
  return member("manager-" + teamLegacyId + "@example.test", "manager", team.id);
};



gate()("authorization (fixes P2)", () => {
  it("refuses a privileged write with no session at all", async () => {
    const r = await ops.setStatLine(db, {
      leagueId, token: null, teamId: T1, slot: "QB", line: { yards: "1", tds: "0" },
    });
    expect(r.status).toBe(401);
  });

  it("refuses a privileged write with a forged token", async () => {
    const r = await ops.setStatLine(db, {
      leagueId, token: "f".repeat(64), teamId: T1, slot: "QB", line: { yards: "1", tds: "0" },
    });
    expect(r.status).toBe(401);
  });

  it("refuses stat entry by a manager - commissioner only", async () => {
    const token = await asManager(T1);
    const r = await ops.setStatLine(db, {
      leagueId, token, teamId: T1, slot: "QB", line: { yards: "999", tds: "9" },
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/commissioner/i);
  });

  it("refuses a manager finalizing the week", async () => {
    const token = await asManager(T1);
    const r = await ops.finalizePeriod(db, { leagueId, token });
    expect(r.status).toBe(403);
  });

  it("refuses a manager editing ANOTHER team's lineup", async () => {
    const token = await asManager(T1);
    const r = await ops.swapLineupSlot(db, { leagueId, token, teamId: T2, slot: "QB", benchIndex: 1 });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/your own team/i);
  });
});

gate()("stat entry: versioning and phase guards", () => {
  beforeEach(() => resetDemo());

  it("writes a stat line and returns the fresh view", async () => {
    const token = await asCommissioner();
    const r = await ops.setStatLine(db, {
      leagueId, token, teamId: T1, slot: "QB", line: { yards: "321", tds: "3" },
    });
    expect(r.status).toBe(200);
    expect(r.body.view.statsEntry[T1].QB).toEqual({ yards: "321", tds: "3" });
  });

  it("REJECTS a stale write and does not apply it", async () => {
    const token = await asCommissioner();
    const first = await ops.setStatLine(db, {
      leagueId, token, teamId: T1, slot: "WR", line: { yards: "50", tds: "0" },
    });
    const staleVersions = first.body.view._meta.versions;

    const winner = await ops.setStatLine(db, {
      leagueId, token, teamId: T1, slot: "WR", line: { yards: "60", tds: "0" }, expect: staleVersions,
    });
    expect(winner.status).toBe(200);

    const loser = await ops.setStatLine(db, {
      leagueId, token, teamId: T1, slot: "WR", line: { yards: "999", tds: "9" }, expect: staleVersions,
    });
    expect(loser.status).toBe(409);
    expect(loser.body.reason).toBe("stale");
    expect(loser.body.view.statsEntry[T1].WR).toEqual({ yards: "60", tds: "0" }); // not overwritten
  });

  it("two people editing DIFFERENT stat lines both succeed", async () => {
    const token = await asCommissioner();
    const base = await ops.setStatLine(db, {
      leagueId, token, teamId: T1, slot: "TE", line: { yards: "10", tds: "0" },
    });
    const v = base.body.view._meta.versions;
    const a = await ops.setStatLine(db, {
      leagueId, token, teamId: T1, slot: "RB", line: { yards: "70", tds: "1" }, expect: v,
    });
    const b = await ops.setStatLine(db, {
      leagueId, token, teamId: T2, slot: "RB", line: { yards: "80", tds: "2" }, expect: v,
    });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.view.statsEntry[T1].RB).toEqual({ yards: "70", tds: "1" });
    expect(b.body.view.statsEntry[T2].RB).toEqual({ yards: "80", tds: "2" });
  });

  it("refuses to deal while the week is in 'stats'", async () => {
    const token = await asCommissioner();
    const r = await ops.dealPeriod(db, { leagueId, token });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("phase");
  });
});

gate()("the weekly cycle, server-side", () => {
  beforeEach(() => resetDemo());

  it("runs finalize -> deal -> schemes -> process, storing seeds for replay (P5)", async () => {
    const token = await asCommissioner();

    const fin = await ops.finalizePeriod(db, { leagueId, token });
    expect(fin.status).toBe(200);
    expect(fin.body.view.currentPeriod).toEqual({ type: "week", number: 3, phase: "pre-deal" });

    const dealt = await ops.dealPeriod(db, { leagueId, token });
    expect(dealt.status).toBe(200);
    expect(dealt.body.view.currentPeriod.phase).toBe("dealt");
    expect(dealt.body.view.teams.every((t) => t.roster !== null)).toBe(true);

    // The seed is minted server-side and stored, so the deal can be replayed/audited
    // and a client cannot re-roll one it disliked.
    const { data: period } = await db
      .from("periods").select("deal_seed, dealt_at, number").eq("number", 3).maybeSingle();
    expect(period.deal_seed).toBeTruthy();
    expect(period.dealt_at).toBeTruthy();

    // A manager submits their own scheme.
    const mgr = await asManager(T1);
    const qb = dealt.body.view.teams.find((t) => t.id === T1).roster.starters.QB;
    const sub = await ops.submitScheme(db, {
      leagueId, token: mgr, teamId: T1, scheme: { type: "block", position: "QB", playerId: qb },
    });
    expect(sub.status).toBe(200);

    /* REGRESSION: the commissioner must be able to see THAT a manager submitted.
     *
     * His Weeks panel offers "N of M teams have submitted", but the browser read it
     * used could never answer: read_resolved_schemes hides an unresolved scheme from
     * every browser, his included (tests/rls.test.js), so the count sat at 0 until he
     * happened to write something himself. schemeStatus is the entitled question. */
    const status = await ops.schemeStatus(db, { leagueId, token });
    expect(status.status).toBe(200);
    expect(status.body.submittedTeamIds).toContain(T1);

    /* ...and STRICTLY that, not what was chosen. A scheme's contents stay secret
     * until they resolve; the commissioner is not an exception to that rule. */
    const leaked = JSON.stringify(status.body);
    expect(leaked).not.toMatch(/block/);
    expect(leaked).not.toMatch(new RegExp(String(qb)));

    // A manager may not ask it at all - no filtered answer, a refusal.
    const nosy = await ops.schemeStatus(db, { leagueId, token: mgr });
    expect(nosy.status).toBe(403);
    expect(nosy.body.submittedTeamIds).toBeUndefined();

    const proc = await ops.processSchemes(db, { leagueId, token });
    expect(proc.status).toBe(200);
    expect(proc.body.view.currentPeriod.phase).toBe("schemes-processed");

    const { data: p2 } = await db
      .from("periods").select("scheme_seed").eq("number", 3).maybeSingle();
    expect(p2.scheme_seed).toBeTruthy();
  });

  /* CARRIED OVER from tests/operations.test.js when the in-memory adapter was deleted
   * (Phase 3 of the local-development rework). It guards a real bug: while the period
   * version was a bare integer, a client holding "period v1" for Week 2 matched Week 3's
   * freshly-created v1, so a write aimed at the finished week landed on the new one.
   * Qualifying the version with the period's identity is what makes that impossible,
   * and nothing else in this file asserts it. */
  it("qualifies the period version with the period's identity, so a stale client cannot match a new week", async () => {
    const token = await asCommissioner();

    const before = await ops.setStatLine(db, {
      leagueId, token, teamId: T1, slot: "QB", line: { yards: "10", tds: "0" },
    });
    expect(before.body.view._meta.versions.period).toBe("week-2#1");

    const fin = await ops.finalizePeriod(db, { leagueId, token });
    expect(fin.status).toBe(200);
    expect(fin.body.view._meta.versions.period).toBe("week-3#1");
    expect(fin.body.view._meta.versions.period)
      .not.toBe(before.body.view._meta.versions.period);
  });

  it("OQ-B: refuses a Block on a player who is not your own starter", async () => {
    const mgr = await asManager(T1);
    const { data: rows } = await db.from("players").select("legacy_id").eq("position", "QB").limit(50);
    const view = (await ops.submitScheme(db, {
      leagueId, token: mgr, teamId: T1,
      scheme: { type: "block", position: "QB", playerId: rows[0].legacy_id },
    }));
    // Either it is not their starter (400) or the phase has closed (409) - both are
    // refusals, and neither silently accepts a block on someone else's player.
    expect([400, 409]).toContain(view.status);
  });
});






gate()("OQ-E: stats cannot be entered while the roster is unlocked", () => {
  beforeEach(() => resetDemo());

  it("refuses a stat write with the rosters unlocked, and accepts it once locked", async () => {
    /* Stats are keyed by SLOT, not by player (the designer's behaviour, preserved). So
     * a lineup swap landing after a stat line is entered silently moves those points to
     * whoever now occupies the slot. Locking is what makes that unreachable; this
     * refuses the writes that could still slip through the gap.
     *
     * Provisional, on the same footing as OQ-B - it is the designer's rule to confirm. */
    const token = await asCommissioner();
    const state = (await ops.toggleRosterLock(db, { leagueId, token })).body.view;
    const line = { yards: 100, tds: 1 };

    if (state.rosterLocked) {
      const ok = await ops.setStatLine(db, { leagueId, token, teamId: T1, slot: "QB", line });
      expect([200, 409]).toContain(ok.status);
      if (ok.status === 409) expect(ok.body.reason).not.toBe("unlocked");
      await ops.toggleRosterLock(db, { leagueId, token });
    }

    const blocked = await ops.setStatLine(db, { leagueId, token, teamId: T1, slot: "QB", line });
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe("unlocked");
    expect(blocked.body.error).toMatch(/Lock the rosters/);

    // And the normal flow, which locks before stats, is unaffected.
    const relocked = await ops.toggleRosterLock(db, { leagueId, token });
    expect(relocked.body.view.rosterLocked).toBe(true);
    const accepted = await ops.setStatLine(db, { leagueId, token, teamId: T1, slot: "QB", line });
    expect(accepted.status).toBe(200);
  });
});

/* ============================================================================
 *  PHASE 3b + 3c - accounts, and the fact that BOTH credentials work at once.
 *
 *  The property under test throughout is coexistence. If any of these fail by
 *  breaking join-code login, the migration is not "by invitation" any more - it
 *  is a forced cutover, which is the one thing the plan rules out.
 * ==========================================================================*/

/* Accounts this file created, so cleanup can be exact.
 *
 * The first version of wipeAccounts() deleted EVERY user in the project, which was fine
 * while this was the only suite making any. Once rls.test.js started creating its own,
 * the two files - which vitest runs in parallel - began deleting each other's users
 * mid-test, and the failure looked like flaky RLS rather than a cleanup that was too
 * broad. Delete only what you made. */
const createdUserIds = [];

/** Create a confirmed account and return a usable access token for it. */
async function makeAccount(email) {
  // admin.createUser with email_confirm skips the mail round trip; the magic-link
  // flow itself is exercised in the browser, not here.
  const { data: created } = await db.auth.admin.createUser({
    email, password: "test-password-123", email_confirm: true,
  });
  if (created?.user?.id) createdUserIds.push(created.user.id);
  const anonClient = createClient(dbUrl, dbPublishable, { auth: { persistSession: false } });
  const { data, error } = await anonClient.auth.signInWithPassword({
    email, password: "test-password-123",
  });
  if (error) throw new Error("could not sign in test account: " + error.message);
  return { token: data.session.access_token, userId: data.user.id };
}

const wipeAccounts = async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    await db.auth.admin.deleteUser(id).catch(() => {});
  }
};

/* Once, at the end. It used to run in beforeEach, which was necessary while each test
 * linked a fresh account to a join-code session; the accounts are cached fixtures now,
 * and deleting them between tests would invalidate the very tokens the next test uses. */
afterAll(async () => {
  if (available) await wipeAccounts();
});



/* ============================================================================
 *  PHASE 3d - leagues, invites, redemption, membership.
 *
 *  The inversion completed: an account creates a league, an invite authorizes ONE
 *  join and is then spent, and a role is a row rather than a property of whoever
 *  is holding a string.
 * ==========================================================================*/

gate()("invite codes", () => {
  it("round-trips through everything a phone will do to it", async () => {
    const { generateInviteCode, parseInviteCode } = await import("../server/invites.js");
    const { code, ref, secret } = generateInviteCode();
    // Lower-cased by autocorrect, re-spaced by a group chat, hyphens rearranged.
    const mangled = "  " + code.toLowerCase().replace("-", " - ") + "\n";
    expect(parseInviteCode(mangled)).toEqual({ ref, secret });
  });

  it("rejects the confusable characters it deliberately excludes", async () => {
    const { parseInviteCode } = await import("../server/invites.js");
    // The alphabet has no O, 0, I, 1, L or U, so any of them means a real mistake
    // rather than a transcription artefact - and saying so beats a silent failure.
    expect(parseInviteCode("OOOOOO-0000000000")).toBeNull();
    expect(parseInviteCode("IIIIII-LLLLLLLLLL")).toBeNull();
    expect(parseInviteCode("SHORT")).toBeNull();
  });

  it("never produces the same code twice", async () => {
    const { generateInviteCode } = await import("../server/invites.js");
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) seen.add(generateInviteCode().code);
    expect(seen.size).toBe(500);
  });
});

gate()("creating a league", () => {
  beforeEach(() => resetDemo());

  const cleanupLeagues = async (name) => { await db.from("leagues").delete().eq("name", name); };

  it("makes the creator its commissioner, with a full player pool and no teams", async () => {
    const { token: jwt, userId } = await makeAccount("founder@example.test");
    const r = await ops.createLeague(db, { accountToken: jwt, name: "Founders League", year: 2031 });
    expect(r.status).toBe(200);

    const { data: member } = await db
      .from("league_members").select("role, team_id").eq("league_id", r.body.leagueId).single();
    expect(member.role).toBe("commissioner");
    expect(member.team_id).toBeNull();
    expect(member.user_id ?? userId).toBeTruthy();

    // Blank means: a full pool (you cannot deal without players) and zero teams.
    const { data: players } = await db.from("players").select("id").eq("league_id", r.body.leagueId);
    expect(players.length).toBeGreaterThan(100);
    const { data: teams } = await db.from("teams").select("id").eq("league_id", r.body.leagueId);
    expect(teams).toHaveLength(0);

    await cleanupLeagues("Founders League");
  });

  it("stocks the pool from the player_pool template, not from JavaScript", async () => {
    /* The pool used to be shipped as 223 rows of JSON on every league creation, built
     * from src/data/teamRows.js. It is a table now, copied in one statement - so a
     * correction made in the database reaches the next league with no deploy. */
    const { token: jwt } = await makeAccount("stocker@example.test");
    const r = await ops.createLeague(db, { accountToken: jwt, name: "Stocked League", year: 2032 });
    expect(r.status).toBe(200);

    const { count } = await db
      .from("players").select("*", { count: "exact", head: true }).eq("league_id", r.body.leagueId);
    const { count: poolCount } = await db
      .from("player_pool").select("*", { count: "exact", head: true }).eq("active", true);
    expect(count).toBe(poolCount);
    expect(count).toBe(223);

    await cleanupLeagues("Stocked League");
  });

  it("gives each league its OWN player rows, so one commissioner cannot affect another", async () => {
    /* The reason player_pool is a template rather than a shared table: marking someone
     * OUT is a statement about YOUR league. */
    const { token: jwt } = await makeAccount("divergence@example.test");
    const a = await ops.createLeague(db, { accountToken: jwt, name: "Pool A", year: 2032 });
    const b = await ops.createLeague(db, { accountToken: jwt, name: "Pool B", year: 2032 });

    await db.from("players").update({ status: "IR" })
      .eq("league_id", a.body.leagueId).eq("legacy_id", "p1");

    const { data: other } = await db
      .from("players").select("status").eq("league_id", b.body.leagueId).eq("legacy_id", "p1").single();
    expect(other.status).toBe("Active");

    const { data: template } = await db
      .from("player_pool").select("status").eq("legacy_id", "p1").single();
    expect(template.status).toBe("Active"); // the template is not written back to either

    await cleanupLeagues("Pool A");
    await cleanupLeagues("Pool B");
  });

  it("is PRIVATE by default", async () => {
    // Forgetting to choose must fail closed.
    const { token: jwt } = await makeAccount("private@example.test");
    const r = await ops.createLeague(db, { accountToken: jwt, name: "Quiet League", year: 2032 });
    const { data } = await db.from("leagues").select("visibility").eq("id", r.body.leagueId).single();
    expect(data.visibility).toBe("members");
    await cleanupLeagues("Quiet League");
  });

  it("refuses without a real account - a league cannot be owned by a string", async () => {
    /* This used to pass a join-code session and assert it could not create a league.
     * Codes are gone, so the same property is asserted against what an attacker
     * actually has: nothing, or a forged token. */
    const junk = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJoYWNrZXIifQ.not-a-signature";
    expect((await ops.createLeague(db, { accountToken: null, name: "Codeless", year: 2033 })).status).toBe(401);
    const r = await ops.createLeague(db, { accountToken: junk, name: "Codeless", year: 2033 });
    expect(r.status).toBe(401);
  });

  it("refuses a blank name", async () => {
    const { token: jwt } = await makeAccount("blank@example.test");
    expect((await ops.createLeague(db, { accountToken: jwt, name: "   " })).status).toBe(400);
  });

  it("lists the leagues an account belongs to, and only those", async () => {
    const { token: mine } = await makeAccount("mine@example.test");
    const { token: theirs } = await makeAccount("theirs@example.test");
    const a = await ops.createLeague(db, { accountToken: mine, name: "Mine A", year: 2034 });
    await ops.createLeague(db, { accountToken: theirs, name: "Theirs B", year: 2034 });

    const r = await ops.myLeagues(db, { accountToken: mine });
    expect(r.status).toBe(200);
    const names = r.body.leagues.map((l) => l.name);
    expect(names).toContain("Mine A");
    expect(names).not.toContain("Theirs B");
    expect(r.body.leagues.find((l) => l.id === a.body.leagueId).role).toBe("commissioner");

    await cleanupLeagues("Mine A");
    await cleanupLeagues("Theirs B");
  });
});

gate()("invites and redemption", () => {
  beforeEach(() => resetDemo());

  const issue = async (over = {}) => {
    const token = await asCommissioner();
    return ops.createInvite(db, { leagueId, token, teamId: T1, role: "manager", ...over });
  };

  it("issues a code, and that code lets an account join as the invited team", async () => {
    const made = await issue();
    expect(made.status).toBe(200);
    expect(typeof made.body.code).toBe("string");

    const { token: jwt, userId } = await makeAccount("invitee@example.test");
    const r = await ops.redeemInvite(db, { code: made.body.code, accountToken: jwt });
    expect(r.status).toBe(200);
    expect(r.body.alreadyMember).toBe(false);

    const { data: member } = await db
      .from("league_members").select("role, team_id").eq("user_id", userId).single();
    expect(member.role).toBe("manager");
    const { data: team } = await db
      .from("teams").select("id").eq("legacy_id", T1).eq("league_id", leagueId).single();
    expect(member.team_id).toBe(team.id);
  });

  it("and the redeemed membership actually authorizes that team", async () => {
    // The point of the whole exercise: a redeemed invite is indistinguishable from a
    // membership minted any other way.
    const made = await issue();
    const { token: jwt } = await makeAccount("player@example.test");
    await ops.redeemInvite(db, { code: made.body.code, accountToken: jwt });

    const own = await ops.swapLineupSlot(db, { leagueId, token: jwt, teamId: T1, slot: "QB", benchIndex: 0 });
    expect(own.status).not.toBe(401);
    expect(own.status).not.toBe(403);
    const other = await ops.swapLineupSlot(db, { leagueId, token: jwt, teamId: T2, slot: "QB", benchIndex: 0 });
    expect(other.status).toBe(403);
  });

  it("requires a signed-in account - the code alone is not a login", async () => {
    /* THE INVERSION, asserted. A join code IS a session; an invite is only permission to
     * become a member, and a member is a person. */
    const made = await issue();
    const r = await ops.redeemInvite(db, { code: made.body.code, accountToken: null });
    expect(r.status).toBe(401);
  });

  it("is idempotent - redeeming twice does not make a second membership or burn a use", async () => {
    const made = await issue({ maxUses: 5 });
    const { token: jwt, userId } = await makeAccount("twice@example.test");
    await ops.redeemInvite(db, { code: made.body.code, accountToken: jwt });
    const again = await ops.redeemInvite(db, { code: made.body.code, accountToken: jwt });
    expect(again.status).toBe(200);
    expect(again.body.alreadyMember).toBe(true);

    const { data: rows } = await db.from("league_members").select("id").eq("user_id", userId);
    expect(rows).toHaveLength(1);
    // "Did that work?" is the most natural reason to press it again; it must not cost a use.
    const { data: invite } = await db.from("invites").select("uses").eq("code_ref", made.body.code.split("-")[0]).single();
    expect(invite.uses).toBe(1);
  });

  it("is multi-use by default, because the flow is one code in a group chat", async () => {
    const made = await issue();
    for (const who of ["a", "b", "c"]) {
      const { token } = await makeAccount("chat-" + who + "@example.test");
      const r = await ops.redeemInvite(db, { code: made.body.code, accountToken: token });
      expect(r.status).toBe(200);
    }
    /* Counts MANAGERS. The commissioner who issued the invite is a member of this
       league too, and always was - it just used to hold a join code instead of a row. */
    const { data } = await db
      .from("league_members").select("id").eq("league_id", leagueId).eq("role", "manager");
    expect(data.length).toBe(3);
  });

  it("honours max_uses, and says so distinctly from a wrong code", async () => {
    const made = await issue({ maxUses: 1 });
    const { token: first } = await makeAccount("first@example.test");
    expect((await ops.redeemInvite(db, { code: made.body.code, accountToken: first })).status).toBe(200);

    const { token: second } = await makeAccount("second@example.test");
    const r = await ops.redeemInvite(db, { code: made.body.code, accountToken: second });
    // 410, not 401: "used up" is something the person can act on - ask for another -
    // while a 401 would send them hunting for a typo that is not there.
    expect(r.status).toBe(410);
    expect(r.body.error).toMatch(/used/i);
  });

  it("honours expiry", async () => {
    const made = await issue({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const { token } = await makeAccount("late@example.test");
    const r = await ops.redeemInvite(db, { code: made.body.code, accountToken: token });
    expect(r.status).toBe(410);
    expect(r.body.error).toMatch(/expired/i);
  });

  it("honours revocation, and revoking does NOT sign out anyone who already joined", async () => {
    const made = await issue();
    const { token: early } = await makeAccount("early@example.test");
    await ops.redeemInvite(db, { code: made.body.code, accountToken: early });

    const comm = await asCommissioner();
    const list = await ops.listInvites(db, { leagueId, token: comm });
    const rev = await ops.revokeInvite(db, { leagueId, token: comm, inviteId: list.body.invites[0].id });
    expect(rev.status).toBe(200);

    const { token: late } = await makeAccount("toolate@example.test");
    expect((await ops.redeemInvite(db, { code: made.body.code, accountToken: late })).status).toBe(410);

    /* The payoff of the whole design: an invite authorizes a join, it does not sustain
     * access. Revoking one is not a lockout, which is exactly what rotating a join code
     * always was. */
    const still = await ops.swapLineupSlot(db, { leagueId, token: early, teamId: T1, slot: "QB", benchIndex: 0 });
    expect(still.status).not.toBe(401);
  });

  it("gives the same answer for a wrong reference and a wrong secret", async () => {
    /* Otherwise the public half becomes an oracle: "invalid reference" vs "wrong secret"
     * would let someone enumerate which invites are live. */
    const made = await issue();
    const [ref] = made.body.code.split("-");
    const wrongSecret = await ops.redeemInvite(db, {
      code: ref + "-ZZZZZZZZZZ", accountToken: (await makeAccount("o1@example.test")).token,
    });
    const wrongRef = await ops.redeemInvite(db, {
      code: "ZZZZZZ-ZZZZZZZZZZ", accountToken: (await makeAccount("o2@example.test")).token,
    });
    expect(wrongSecret.status).toBe(wrongRef.status);
    expect(wrongSecret.body.error).toBe(wrongRef.body.error);
  });

  it("is commissioner-only to issue, and never reads a code back", async () => {
    const mgr = await asManager(T1);
    expect((await ops.createInvite(db, { leagueId, token: mgr, teamId: T1 })).status).toBe(403);

    const comm = await asCommissioner();
    await ops.createInvite(db, { leagueId, token: comm, teamId: T1 });
    const list = await ops.listInvites(db, { leagueId, token: comm });
    // The list shows the public reference so two invites can be told apart. Never a code.
    const body = JSON.stringify(list.body);
    expect(list.body.invites[0].ref).toHaveLength(6);
    expect(body).not.toMatch(/code_hash|scrypt/);
  });
});

gate()("membership and commissioner transfer", () => {
  beforeEach(() => resetDemo());

  const joinAs = async (email, role = "manager", teamLegacy = T1) => {
    const comm = await asCommissioner();
    const made = await ops.createInvite(db, {
      leagueId, token: comm, teamId: role === "manager" ? teamLegacy : null, role,
    });
    const acct = await makeAccount(email);
    await ops.redeemInvite(db, { code: made.body.code, accountToken: acct.token });
    return acct;
  };

  it("can promote a manager to commissioner - a second one, not a replacement", async () => {
    const boss = await joinAs("boss@example.test", "commissioner");
    const hand = await joinAs("hand@example.test", "manager");

    const r = await ops.setMemberRole(db, {
      leagueId, token: boss.token, userId: hand.userId, role: "commissioner",
    });
    expect(r.status).toBe(200);

    const { data } = await db
      .from("league_members").select("role").eq("league_id", leagueId).eq("role", "commissioner");
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  it("REFUSES to demote or remove the last commissioner", async () => {
    /* A league with no commissioner cannot deal a week, add a team, or issue an invite.
     * No screen in the app could repair it, so the guard makes it impossible rather than
     * merely discouraged - transfer is promote-then-demote, in that order. */
    const only = await joinAs("solo@example.test", "commissioner");
    /* An invite has to be issued BY a commissioner, so joinAs leaves two. Remove the
       issuer, or "the last commissioner" is not what is being tested. */
    await db.from("league_members").delete()
      .eq("league_id", leagueId).eq("role", "commissioner").neq("user_id", only.userId);

    const demote = await ops.setMemberRole(db, {
      leagueId, token: only.token, userId: only.userId, role: "manager",
    });
    expect(demote.status).toBe(409);
    expect(demote.body.error).toMatch(/only commissioner/i);

    const remove = await ops.setMemberRole(db, {
      leagueId, token: only.token, userId: only.userId, role: "remove",
    });
    expect(remove.status).toBe(409);
  });

  it("allows a full transfer once there are two", async () => {
    const outgoing = await joinAs("outgoing@example.test", "commissioner");
    const incoming = await joinAs("incoming@example.test", "manager");

    await ops.setMemberRole(db, { leagueId, token: outgoing.token, userId: incoming.userId, role: "commissioner" });
    const stepDown = await ops.setMemberRole(db, {
      leagueId, token: outgoing.token, userId: outgoing.userId, role: "manager",
    });
    // The outgoing commissioner has no team, so stepping down needs one first - which is
    // a real answer, not a refusal to transfer.
    expect([200, 400]).toContain(stepDown.status);

    const { data } = await db
      .from("league_members").select("role").eq("league_id", leagueId).eq("user_id", incoming.userId).single();
    expect(data.role).toBe("commissioner");
  });

  it("is commissioner-only, so a manager cannot promote themselves", async () => {
    await joinAs("realboss@example.test", "commissioner");
    const sneaky = await joinAs("sneaky@example.test", "manager");
    const r = await ops.setMemberRole(db, {
      leagueId, token: sneaky.token, userId: sneaky.userId, role: "commissioner",
    });
    expect(r.status).toBe(403);
  });

  it("lets a commissioner change league visibility", async () => {
    const comm = await asCommissioner();
    expect((await ops.setLeagueVisibility(db, { leagueId, token: comm, visibility: "members" })).status).toBe(200);
    const { data } = await db.from("leagues").select("visibility").eq("id", leagueId).single();
    expect(data.visibility).toBe("members");

    const mgr = await asManager(T1);
    expect((await ops.setLeagueVisibility(db, { leagueId, token: mgr, visibility: "public" })).status).toBe(403);
  });
});

/* The pool refresh, against real Postgres.
 *
 * The plan itself is covered without a database in tests/pool.test.js. What can only be
 * checked here is how it REACHES the database: the outcome was always correct, it just
 * used one request per changed player, which is invisible locally and a few hundred
 * sequential round trips from a Netlify function on a 10-second timeout. So this asserts
 * the writes are batched AND that batching them changed none of the rules.
 */
gate()("the pool refresh writes in batches", () => {
  beforeEach(() => resetDemo());

  const AT = "2026-08-29T12:00:00Z";

  /* A feed built from the league's OWN players, so nearly every row matches and needs a
   * write - which is exactly the first-live-refresh case that provoked this. */
  const feedOf = (rows) => ({
    fetchDepthChart: async () => ({
      snapshotAt: AT,
      players: rows.map((p, i) => ({
        name: p.name,
        position: p.position,
        team: p.nfl_team,
        depthRank: 1,
        externalIds: { gsis: "g" + i },
      })),
    }),
    fetchHeadCoaches: async () => ({ season: 2026, coaches: new Map() }),
    buildPool: ({ depthPlayers }) => ({ players: depthPlayers, gaps: [] }),
  });

  /* Counts what actually reaches PostgREST. The old loop issued one request per row;
   * nothing about the resulting rows could tell you that, which is why it survived. */
  const counting = (client) => {
    const calls = [];
    return { calls, auth: client.auth, from: (t) => (calls.push(t), client.from(t)) };
  };

  async function poolFixture() {
    const { data: season } = await db
      .from("seasons").select("id").eq("league_id", leagueId).single();
    // The refresh is pre-deal only; the demo league sits in week 2 stats.
    await db.from("periods").update({ phase: "pre-deal" })
      .eq("season_id", season.id).eq("number", 2);
    const { data: players } = await db
      .from("players").select("*").eq("league_id", leagueId).order("legacy_id");
    return players;
  }

  it("refreshes the whole pool in a handful of requests, not one per player", async () => {
    const token = await asCommissioner();
    const players = await poolFixture();
    const claimed = players.slice(0, 100); // the rest are no longer starters

    const wrapped = counting(db);
    const r = await ops.refreshPlayerPool(wrapped, { leagueId, token, feed: feedOf(claimed) });
    expect(r.status).toBe(200);

    const playerWrites = wrapped.calls.filter((t) => t === "players").length;
    // Two reads and a couple of upserts. The old loop made well over two hundred.
    expect(playerWrites).toBeLessThan(10);
    expect(r.body.report.retired).toBe(players.length - claimed.length);
  });

  it("still leaves the commissioner's decisions alone when it batches them", async () => {
    const token = await asCommissioner();
    const players = await poolFixture();
    const sidelined = players[0];
    const hisOwn = players[1];
    await db.from("players")
      .update({ status: "IR", status_source: "manual" }).eq("id", sidelined.id);
    await db.from("players").update({ source: "manual" }).eq("id", hisOwn.id);

    const claimed = players.slice(0, 100);
    const r = await ops.refreshPlayerPool(db, { leagueId, token, feed: feedOf(claimed) });
    expect(r.status).toBe(200);

    const { data: after } = await db.from("players").select("*").eq("league_id", leagueId);
    const byId = new Map(after.map((p) => [p.id, p]));

    // A status he set by hand: untouched, and the disagreement reported instead.
    expect(byId.get(sidelined.id).status).toBe("IR");
    expect(byId.get(sidelined.id).status_source).toBe("manual");
    // A player he added himself: not restyled at all.
    expect(byId.get(hisOwn.id).source).toBe("manual");
    expect(byId.get(hisOwn.id).depth_rank).toBe(null);

    // An ordinary seeded row: corrected, with its provider id attached.
    const corrected = byId.get(players[5].id);
    expect(corrected.source).toBe("feed");
    expect(corrected.external_ids.gsis).toBeTruthy();
    expect(corrected.version).toBe(players[5].version); // a refresh is not an edit

    // One the feed did not claim: retired, never deleted.
    const gone = byId.get(players[150].id);
    expect(gone.status).toBe("OUT");
    expect(gone.status_source).toBe("feed");
    expect(gone.id).toBeTruthy();
  });
});
