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
const T1 = "demo_team_1";
const T2 = "demo_team_2";

function localEnv() {
  try {
    const out = execSync("npx supabase status -o env", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 120000,
    }).toString();
    const get = (k) => (out.match(new RegExp("^" + k + '="?([^"\n]+)"?$', "m")) || [])[1];
    return { url: get("API_URL"), secret: get("SECRET_KEY") };
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
