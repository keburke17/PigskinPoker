/**
 * The privileged server layer, against the real local Postgres.
 *
 * This is where P2 is proven fixed. In the artifact, the commissioner code and every
 * team's join code lived inside the league blob, were downloaded by every visitor, and
 * were compared in the browser - `isCommissioner` only decided what UI rendered.
 * Nothing stopped a client writing whatever it liked.
 *
 * These tests assert the enforcement is now real: a session is required, roles are
 * checked server-side, a manager cannot touch another team, and the codes themselves
 * never leave the server.
 *
 * Skips itself when the local stack isn't running:  npx supabase start
 */

import { describe, it, expect, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import * as ops from "../server/operations.js";
import { hashCode, verifyCode } from "../server/auth.js";

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
function resetDemo() {
  if (!dbContainer) {
    dbContainer = execSync("docker ps --filter name=supabase_db_ --format '{{.Names}}'")
      .toString().trim().split("\n")[0];
  }
  execSync("docker exec -i " + dbContainer + " psql -U postgres -d postgres -q -v ON_ERROR_STOP=1", {
    input: readFileSync(SEED_PATH),
    stdio: ["pipe", "ignore", "pipe"],
  });
}

/** Fresh commissioner session. */
const asCommissioner = async () => {
  const r = await ops.loginCommissioner(db, { leagueId, code: "DEMO-COMMISH" });
  return r.body.token;
};
const asManager = async (teamId, code) => {
  const r = await ops.loginManager(db, { leagueId, teamLegacyId: teamId, code });
  return r.body.token;
};

gate()("code hashing", () => {
  it("round-trips and rejects wrong codes", () => {
    const h = hashCode("DEMO-TEAM-1");
    expect(verifyCode("DEMO-TEAM-1", h)).toBe(true);
    expect(verifyCode("demo-team-1  ", h)).toBe(true); // typed on a phone
    expect(verifyCode("DEMO-TEAM-2", h)).toBe(false);
  });

  it("produces a different hash every time (salted)", () => {
    expect(hashCode("X")).not.toBe(hashCode("X"));
  });
});

gate()("login", () => {
  it("accepts the seeded commissioner code and returns a session", async () => {
    const r = await ops.loginCommissioner(db, { leagueId, code: "DEMO-COMMISH" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.role).toBe("commissioner");
    expect(typeof r.body.token).toBe("string");
    expect(r.body.token.length).toBeGreaterThan(32);
  });

  it("rejects a wrong commissioner code", async () => {
    const r = await ops.loginCommissioner(db, { leagueId, code: "NOPE" });
    expect(r.status).toBe(401);
    expect(r.body.ok).toBe(false);
  });

  it("accepts a team join code and binds the session to that team", async () => {
    const r = await ops.loginManager(db, { leagueId, teamLegacyId: T1, code: "DEMO-TEAM-1" });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe("manager");
    expect(r.body.teamId).toBe(T1);
  });

  it("rejects another team's join code", async () => {
    const r = await ops.loginManager(db, { leagueId, teamLegacyId: T1, code: "DEMO-TEAM-2" });
    expect(r.status).toBe(401);
  });

  it("never returns the code or its hash", async () => {
    const r = await ops.loginCommissioner(db, { leagueId, code: "DEMO-COMMISH" });
    const body = JSON.stringify(r.body);
    expect(body).not.toMatch(/DEMO-COMMISH/);
    expect(body).not.toMatch(/scrypt/);
  });
});

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
    const token = await asManager(T1, "DEMO-TEAM-1");
    const r = await ops.setStatLine(db, {
      leagueId, token, teamId: T1, slot: "QB", line: { yards: "999", tds: "9" },
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/commissioner/i);
  });

  it("refuses a manager finalizing the week", async () => {
    const token = await asManager(T1, "DEMO-TEAM-1");
    const r = await ops.finalizePeriod(db, { leagueId, token });
    expect(r.status).toBe(403);
  });

  it("refuses a manager editing ANOTHER team's lineup", async () => {
    const token = await asManager(T1, "DEMO-TEAM-1");
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
    const mgr = await asManager(T1, "DEMO-TEAM-1");
    const qb = dealt.body.view.teams.find((t) => t.id === T1).roster.starters.QB;
    const sub = await ops.submitScheme(db, {
      leagueId, token: mgr, teamId: T1, scheme: { type: "block", position: "QB", playerId: qb },
    });
    expect(sub.status).toBe(200);

    const proc = await ops.processSchemes(db, { leagueId, token });
    expect(proc.status).toBe(200);
    expect(proc.body.view.currentPeriod.phase).toBe("schemes-processed");

    const { data: p2 } = await db
      .from("periods").select("scheme_seed").eq("number", 3).maybeSingle();
    expect(p2.scheme_seed).toBeTruthy();
  });

  it("OQ-B: refuses a Block on a player who is not your own starter", async () => {
    const mgr = await asManager(T1, "DEMO-TEAM-1");
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

/* ============================================================================
 *  PHASE 3a - the gaps Phase 2c knowingly left behind.
 *
 *  Every one of these is listed in docs/AUTH.md under "what is deliberately still
 *  weak", and each is now closed. They all need the local stack, which is exactly
 *  the point: these are the tests that skip silently without it.
 * ==========================================================================*/

/* Buckets are keyed on the league and on hashed IPs, and nothing in seed.sql knows
 * about auth_throttle - so without this a lockout earned by one test leaks into the
 * next, and the failure looks like flakiness rather than a missing reset. */
const clearThrottle = () => db.from("auth_throttle").delete().neq("bucket_key", "");

const { POLICY: THROTTLE_POLICY, ipBucket } = await import("../server/throttle.js");

gate()("login rate limiting", () => {
  beforeEach(clearThrottle);

  const wrongTimes = async (n, ip) => {
    const results = [];
    for (let i = 0; i < n; i += 1) {
      results.push(await ops.loginCommissioner(db, { leagueId, code: "WRONG-CODE-" + i, ip }));
    }
    return results;
  };

  it("allows the free attempts, then locks the IP out with a Retry-After", async () => {
    const ip = "203.0.113.10";
    const early = await wrongTimes(10, ip);
    // The allowance is for people who mistype, so all ten must be ordinary refusals.
    expect(early.every((r) => r.status === 401)).toBe(true);

    const eleventh = await ops.loginCommissioner(db, { leagueId, code: "STILL-WRONG", ip });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.retryAfter).toBeGreaterThan(0);
  });

  it("locks out the CORRECT code too, once the IP is locked", async () => {
    // The whole point: a lockout that the right code walks straight through would let
    // an attacker confirm a guess the moment he found it.
    const ip = "203.0.113.11";
    await wrongTimes(11, ip);
    const r = await ops.loginCommissioner(db, { leagueId, code: "DEMO-COMMISH", ip });
    expect(r.status).toBe(429);
  });

  it("a successful login clears the buckets", async () => {
    const ip = "203.0.113.12";
    await wrongTimes(4, ip);
    const ok = await ops.loginCommissioner(db, { leagueId, code: "DEMO-COMMISH", ip });
    expect(ok.status).toBe(200);
    // Four mistypes then a correct code must not leave a strike behind: the next four
    // mistakes have to be free again.
    const after = await wrongTimes(4, ip);
    expect(after.every((r) => r.status === 401)).toBe(true);
  });

  it("punishes the attacker's address far harder than any bystander", async () => {
    /* THE ASYMMETRY, asserted directly, because it is the design.
     *
     * A bystander is not immune during an attack - the league's own bucket imposes its
     * few-second slowdown on everyone, and pretending otherwise would be a nicer test
     * of a system nobody built. What must hold is the RATIO: the attacker is measured
     * in minutes and climbing, the bystander in seconds and flat. */
    await wrongTimes(12, "203.0.113.13");

    const attacker = await ops.loginCommissioner(db, { leagueId, code: "DEMO-COMMISH", ip: "203.0.113.13" });
    expect(attacker.status).toBe(429);
    expect(attacker.body.retryAfter).toBeGreaterThan(30);

    const bystander = await ops.loginCommissioner(db, { leagueId, code: "DEMO-COMMISH", ip: "203.0.113.99" });
    if (bystander.status === 429) {
      // Seconds, and only for as long as the attack is actually in flight.
      expect(bystander.body.retryAfter).toBeLessThanOrEqual(10);
    } else {
      expect(bystander.status).toBe(200);
    }
  });

  it("the per-TARGET bucket slows down but never locks out", async () => {
    /* This is the deliberate asymmetry. Hammering one league from many addresses must
     * not lock the real commissioner out of his own league on game day - that is a
     * denial of service an attacker would choose on purpose, and it is worse than a
     * slow brute force. The target bucket's delay is fixed and short. */
    for (let i = 0; i < 30; i += 1) {
      await ops.loginCommissioner(db, { leagueId, code: "WRONG", ip: "198.51.100." + i });
    }
    const { data } = await db
      .from("auth_throttle").select("locked_until").eq("bucket_key", "league:" + leagueId).maybeSingle();
    expect(data).toBeTruthy();
    const heldForMs = new Date(data.locked_until).getTime() - Date.now();
    expect(heldForMs).toBeLessThanOrEqual(10 * 1000); // seconds, not an hour
  });

  it("throttles manager login per team, and a bad team id costs nothing", async () => {
    const ip = "203.0.113.20";
    for (let i = 0; i < 11; i += 1) {
      await ops.loginManager(db, { leagueId, teamLegacyId: T1, code: "WRONG" + i, ip });
    }
    const locked = await ops.loginManager(db, { leagueId, teamLegacyId: T1, code: "DEMO-TEAM-1", ip });
    expect(locked.status).toBe(429);

    await clearThrottle();
    // A typo'd team id is a 404 about the request's shape, not a guess at a credential.
    // Counting it would let a stale link burn someone's whole allowance.
    for (let i = 0; i < 12; i += 1) {
      const r = await ops.loginManager(db, { leagueId, teamLegacyId: "no_such_team", code: "X", ip: "203.0.113.21" });
      expect(r.status).toBe(404);
    }
    const fine = await ops.loginManager(db, { leagueId, teamLegacyId: T1, code: "DEMO-TEAM-1", ip: "203.0.113.21" });
    expect(fine.status).toBe(200);
  });

  it("holds a long lockout for its full duration, not just the counting window", async () => {
    /* REGRESSION. checkThrottle once required the counting window to still be open
     * before it would honour a lock, which capped every lockout at the 15-minute
     * window: an IP that had earned an hour was back in after fifteen minutes and the
     * entire exponential backoff above that was decorative.
     *
     * Set up directly rather than by climbing the backoff. Escalation only advances one
     * step per lock actually served - you cannot dig deeper while locked out - so
     * earning an hour honestly would take an hour. The state below is the state that
     * matters: a long lock still in force, over a counting window that has long since
     * elapsed. */
    const ip = "203.0.113.40";
    const key = ipBucket(ip);
    await db.from("auth_throttle").upsert({
      bucket_key: key,
      attempts: 16,
      window_start: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // long gone
      locked_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),     // still an hour to serve
    });

    const r = await ops.loginCommissioner(db, { leagueId, code: "DEMO-COMMISH", ip });
    expect(r.status).toBe(429);
    // And for very nearly the whole hour, not the fifteen minutes of the window.
    expect(r.body.retryAfter).toBeGreaterThan(THROTTLE_POLICY.windowMs / 1000);
  });

  it("sitting out a lockout does not clear the count", async () => {
    // Otherwise the backoff never escalates: wait out the minute, get ten free guesses,
    // repeat forever. Serving a sentence must not also erase the record of it.
    const ip = "203.0.113.41";
    const key = ipBucket(ip);
    await db.from("auth_throttle").upsert({
      bucket_key: key,
      attempts: 11,
      window_start: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // window elapsed
      locked_until: new Date(Date.now() - 1000).toISOString(),           // sentence served
    });

    const next = await ops.loginCommissioner(db, { leagueId, code: "WRONG-AGAIN", ip });
    expect(next.status).toBe(401); // the attempt itself is allowed through again

    const { data: row } = await db
      .from("auth_throttle").select("attempts, locked_until").eq("bucket_key", key).single();
    expect(row.attempts).toBe(12); // continued, not restarted at 1
    expect(new Date(row.locked_until).getTime()).toBeGreaterThan(Date.now()); // and re-locked, harder
  });

  it("never stores the raw IP address", async () => {
    // The table is a rate-limit counter, not a visitor log.
    const ip = "203.0.113.77";
    await ops.loginCommissioner(db, { leagueId, code: "WRONG", ip });
    const { data } = await db.from("auth_throttle").select("bucket_key");
    expect(JSON.stringify(data)).not.toMatch(/203\.0\.113\.77/);
    expect(data.some((r) => r.bucket_key.startsWith("ip:"))).toBe(true);
  });

  it("logs in normally when the platform gives us no IP at all", async () => {
    // netlify dev, and the unit tests themselves. A missing address must degrade to
    // "count the target bucket only", never to a refusal.
    const r = await ops.loginCommissioner(db, { leagueId, code: "DEMO-COMMISH" });
    expect(r.status).toBe(200);
  });
});

gate()("join code policy", () => {
  beforeEach(clearThrottle);

  it("refuses a code that is too short to be a credential", async () => {
    const token = await asCommissioner();
    const r = await ops.setTeamJoinCode(db, { leagueId, token, teamId: T1, code: "ab" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/at least 8/);
  });

  it("refuses characters nobody can type back", async () => {
    const token = await asCommissioner();
    // A smart quote or an accent fails at login looking exactly like a wrong code.
    const r = await ops.setTeamJoinCode(db, {
      leagueId, token, teamId: T1, code: "CAF" + String.fromCodePoint(0xe9) + "CODE1",
    });
    expect(r.status).toBe(400);
  });

  it("counts the code as it will be STORED, not as it was typed", async () => {
    // normalize() trims before hashing, so "  ab  " is a two-character code wearing
    // eight characters of whitespace.
    const token = await asCommissioner();
    const r = await ops.setTeamJoinCode(db, { leagueId, token, teamId: T1, code: "  ab    " });
    expect(r.status).toBe(400);
  });

  it("accepts a decent code and it works for logging in", async () => {
    const token = await asCommissioner();
    const set = await ops.setTeamJoinCode(db, { leagueId, token, teamId: T2, code: "GOOD-CODE-2026" });
    expect(set.status).toBe(200);
    const login = await ops.loginManager(db, { leagueId, teamLegacyId: T2, code: "good-code-2026" });
    expect(login.status).toBe(200);
    expect(login.body.role).toBe("manager");
  });

  it("is NOT enforced on verify, so codes set before the policy still work", async () => {
    /* The distinction the whole design rests on. Hashes are one way, so there is no
     * query that finds which existing codes are short - enforcing this at login would
     * sign those people out mid-season with no way to find or warn them first. */
    const { hashCode: hash } = await import("../server/auth.js");
    const { data: team } = await db
      .from("teams").select("id").eq("legacy_id", T1).eq("league_id", leagueId).single();
    await db.from("team_secrets").upsert({ team_id: team.id, join_code_hash: hash("ab") });

    const r = await ops.loginManager(db, { leagueId, teamLegacyId: T1, code: "ab" });
    expect(r.status).toBe(200);
    resetDemo();
  });
});

gate()("rotating a join code signs that team out", () => {
  beforeEach(() => { resetDemo(); return clearThrottle(); });

  it("invalidates existing sessions for that team", async () => {
    const mgr = await asManager(T1, "DEMO-TEAM-1");
    // Prove the session works before the rotation, or the test proves nothing.
    const before = await ops.swapLineupSlot(db, { leagueId, token: mgr, teamId: T1, slot: "QB", benchIndex: 0 });
    expect(before.status).not.toBe(401);

    const token = await asCommissioner();
    const set = await ops.setTeamJoinCode(db, { leagueId, token, teamId: T1, code: "ROTATED-CODE-1" });
    expect(set.status).toBe(200);
    expect(set.body.signedOut).toBeGreaterThan(0);

    // A 30-day token surviving the rotation is what made rotating cosmetic.
    const after = await ops.swapLineupSlot(db, { leagueId, token: mgr, teamId: T1, slot: "QB", benchIndex: 1 });
    expect(after.status).toBe(401);
  });

  it("does not sign out OTHER teams", async () => {
    const other = await asManager(T2, "DEMO-TEAM-2");
    const token = await asCommissioner();
    await ops.setTeamJoinCode(db, { leagueId, token, teamId: T1, code: "ROTATED-CODE-2" });
    const still = await ops.swapLineupSlot(db, { leagueId, token: other, teamId: T2, slot: "QB", benchIndex: 0 });
    expect(still.status).not.toBe(401);
  });

  it("does not sign out the commissioner who did it", async () => {
    const token = await asCommissioner();
    await ops.setTeamJoinCode(db, { leagueId, token, teamId: T1, code: "ROTATED-CODE-3" });
    const r = await ops.toggleRosterLock(db, { leagueId, token });
    expect(r.status).not.toBe(401);
  });
});

gate()("signOutTeam", () => {
  beforeEach(() => { resetDemo(); return clearThrottle(); });

  it("signs a team's devices out while leaving the join code working", async () => {
    const mgr = await asManager(T1, "DEMO-TEAM-1");
    const token = await asCommissioner();

    const r = await ops.signOutTeam(db, { leagueId, token, teamId: T1 });
    expect(r.status).toBe(200);
    expect(r.body.signedOut).toBeGreaterThan(0);

    const dead = await ops.swapLineupSlot(db, { leagueId, token: mgr, teamId: T1, slot: "QB", benchIndex: 0 });
    expect(dead.status).toBe(401);

    // The difference from rotating: the team is not left needing a new code.
    const back = await ops.loginManager(db, { leagueId, teamLegacyId: T1, code: "DEMO-TEAM-1" });
    expect(back.status).toBe(200);
  });

  it("is commissioner-only - a manager cannot sign out their own team, let alone another", async () => {
    const mgr = await asManager(T1, "DEMO-TEAM-1");
    const r = await ops.signOutTeam(db, { leagueId, token: mgr, teamId: T2 });
    expect(r.status).toBe(403);
  });
});

gate()("session lifecycle", () => {
  beforeEach(() => { resetDemo(); return clearThrottle(); });

  const sessionRow = async (teamLegacy) => {
    const { data: team } = await db
      .from("teams").select("id").eq("legacy_id", teamLegacy).eq("league_id", leagueId).single();
    const { data } = await db
      .from("sessions").select("id, token_hash, last_used_at, expires_at")
      .eq("team_id", team.id).order("created_at", { ascending: false }).limit(1);
    return data[0];
  };

  it("stamps last_used_at when the session is created", async () => {
    await asManager(T1, "DEMO-TEAM-1");
    const row = await sessionRow(T1);
    expect(row.last_used_at).toBeTruthy();
  });

  it("rejects a session idle beyond the idle window, and deletes the dead row", async () => {
    const mgr = await asManager(T1, "DEMO-TEAM-1");
    const row = await sessionRow(T1);

    /* Backdated rather than waited for. The absolute 30-day expiry is left untouched
     * so this proves IDLE expiry specifically, not the cap that already existed. */
    const idle = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    await db.from("sessions").update({ last_used_at: idle }).eq("id", row.id);

    const r = await ops.swapLineupSlot(db, { leagueId, token: mgr, teamId: T1, slot: "QB", benchIndex: 0 });
    expect(r.status).toBe(401);

    // It can never become valid again, so it is removed rather than left to accumulate.
    const { data } = await db.from("sessions").select("id").eq("id", row.id);
    expect(data).toHaveLength(0);
  });

  it("keeps a session alive that is used inside the window - an active manager is never signed out", async () => {
    const mgr = await asManager(T1, "DEMO-TEAM-1");
    const row = await sessionRow(T1);

    // 13 days idle, one day inside the 14-day window: still good, and USING it must
    // push the window forward rather than counting down from first login.
    const nearly = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString();
    await db.from("sessions").update({ last_used_at: nearly }).eq("id", row.id);

    const r = await ops.swapLineupSlot(db, { leagueId, token: mgr, teamId: T1, slot: "QB", benchIndex: 0 });
    expect(r.status).not.toBe(401);

    const refreshed = await sessionRow(T1);
    const movedForwardMs = new Date(refreshed.last_used_at).getTime() - new Date(nearly).getTime();
    expect(movedForwardMs).toBeGreaterThan(0);
  });

  it("still honours the absolute 30-day cap regardless of activity", async () => {
    const mgr = await asManager(T1, "DEMO-TEAM-1");
    const row = await sessionRow(T1);
    await db.from("sessions")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", row.id);
    const r = await ops.swapLineupSlot(db, { leagueId, token: mgr, teamId: T1, slot: "QB", benchIndex: 0 });
    expect(r.status).toBe(401);
  });
});

gate()("OQ-E: stats cannot be entered while the roster is unlocked", () => {
  beforeEach(() => { resetDemo(); return clearThrottle(); });

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

/** Create a confirmed account and return a usable access token for it. */
async function makeAccount(email) {
  // admin.createUser with email_confirm skips the mail round trip; the magic-link
  // flow itself is exercised in the browser, not here.
  await db.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  const anonClient = createClient(dbUrl, dbPublishable, { auth: { persistSession: false } });
  const { data, error } = await anonClient.auth.signInWithPassword({
    email, password: "test-password-123",
  });
  if (error) throw new Error("could not sign in test account: " + error.message);
  return { token: data.session.access_token, userId: data.user.id };
}

const wipeAccounts = async () => {
  const { data } = await db.auth.admin.listUsers();
  for (const u of data?.users ?? []) await db.auth.admin.deleteUser(u.id);
};

gate()("accounts: linking one to an existing membership", () => {
  beforeEach(async () => { resetDemo(); await clearThrottle(); await wipeAccounts(); });

  it("mints a league_members row from the join-code session the caller already holds", async () => {
    const mgr = await asManager(T1, "DEMO-TEAM-1");
    const { token: jwt, userId } = await makeAccount("manager1@example.test");

    const r = await ops.linkAccount(db, { leagueId, token: mgr, accountToken: jwt });
    expect(r.status).toBe(200);
    expect(r.body.linked).toBe(true);
    expect(r.body.alreadyMember).toBe(false);

    const { data: member } = await db
      .from("league_members").select("role, team_id").eq("user_id", userId).single();
    expect(member.role).toBe("manager");

    // The role and team come from the SESSION, never from the request body.
    const { data: team } = await db
      .from("teams").select("id").eq("legacy_id", T1).eq("league_id", leagueId).single();
    expect(member.team_id).toBe(team.id);
  });

  it("is idempotent - linking twice does not make a second membership", async () => {
    const mgr = await asManager(T1, "DEMO-TEAM-1");
    const { token: jwt, userId } = await makeAccount("manager2@example.test");

    await ops.linkAccount(db, { leagueId, token: mgr, accountToken: jwt });
    const second = await ops.linkAccount(db, { leagueId, token: mgr, accountToken: jwt });
    expect(second.status).toBe(200);
    expect(second.body.alreadyMember).toBe(true);

    const { data } = await db.from("league_members").select("id").eq("user_id", userId);
    expect(data).toHaveLength(1);
  });

  it("refuses to link without a join-code session - an account cannot grant itself a role", async () => {
    const { token: jwt } = await makeAccount("nobody@example.test");
    // Passing the JWT as both credentials is the circular case: the thing being granted
    // a role would be authorizing the grant.
    const r = await ops.linkAccount(db, { leagueId, token: jwt, accountToken: jwt });
    expect(r.status).toBe(401);

    const { data } = await db.from("league_members").select("id");
    expect(data).toHaveLength(0);
  });

  it("does not demote a commissioner who happens to hold a manager code", async () => {
    // Changing someone's role is an administrative act, not a side effect of logging in.
    const comm = await asCommissioner();
    const { token: jwt, userId } = await makeAccount("boss@example.test");
    await ops.linkAccount(db, { leagueId, token: comm, accountToken: jwt });

    const mgr = await asManager(T1, "DEMO-TEAM-1");
    const again = await ops.linkAccount(db, { leagueId, token: mgr, accountToken: jwt });
    expect(again.body.role).toBe("commissioner");

    const { data } = await db
      .from("league_members").select("role").eq("user_id", userId).single();
    expect(data.role).toBe("commissioner");
  });
});

gate()("accounts: signing in with one, afterwards", () => {
  beforeEach(async () => { resetDemo(); await clearThrottle(); await wipeAccounts(); });

  it("a linked account authorizes exactly what the join code did", async () => {
    const mgr = await asManager(T1, "DEMO-TEAM-1");
    const { token: jwt } = await makeAccount("manager3@example.test");
    await ops.linkAccount(db, { leagueId, token: mgr, accountToken: jwt });

    // Same operation, same permissions, different credential entirely.
    const r = await ops.swapLineupSlot(db, { leagueId, token: jwt, teamId: T1, slot: "QB", benchIndex: 0 });
    expect(r.status).not.toBe(401);
    expect(r.status).not.toBe(403);
  });

  it("and is still confined to its own team", async () => {
    const mgr = await asManager(T1, "DEMO-TEAM-1");
    const { token: jwt } = await makeAccount("manager4@example.test");
    await ops.linkAccount(db, { leagueId, token: mgr, accountToken: jwt });

    const r = await ops.swapLineupSlot(db, { leagueId, token: jwt, teamId: T2, slot: "QB", benchIndex: 0 });
    expect(r.status).toBe(403);
  });

  it("a valid account with no membership in this league is nobody here", async () => {
    /* Supabase says who you are; league_members says what you may do. A real,
     * signed-in, perfectly valid account that nobody invited must get nothing - this is
     * the separation that makes multi-league possible without leaking across leagues. */
    const { token: jwt } = await makeAccount("stranger@example.test");
    const r = await ops.swapLineupSlot(db, { leagueId, token: jwt, teamId: T1, slot: "QB", benchIndex: 0 });
    expect(r.status).toBe(401);
  });

  it("a forged or expired JWT gets nothing", async () => {
    const junk = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJoYWNrZXIifQ.not-a-real-signature";
    const r = await ops.swapLineupSlot(db, { leagueId, token: junk, teamId: T1, slot: "QB", benchIndex: 0 });
    expect(r.status).toBe(401);
  });

  it("THE JOIN CODE STILL WORKS after the account exists", async () => {
    /* The whole migration rests on this. If linking an account quietly retired the
     * code, this would be a forced cutover wearing an invitation's clothes. */
    const mgr = await asManager(T1, "DEMO-TEAM-1");
    const { token: jwt } = await makeAccount("manager5@example.test");
    await ops.linkAccount(db, { leagueId, token: mgr, accountToken: jwt });

    const fresh = await ops.loginManager(db, { leagueId, teamLegacyId: T1, code: "DEMO-TEAM-1" });
    expect(fresh.status).toBe(200);
    const r = await ops.swapLineupSlot(db, {
      leagueId, token: fresh.body.token, teamId: T1, slot: "QB", benchIndex: 0,
    });
    expect(r.status).not.toBe(401);
  });
});
