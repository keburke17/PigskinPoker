import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

/* Detection runs at MODULE level, not in beforeAll. Vitest decides describe.skip at
 * collection time, which happens before any hook runs - so availability computed in
 * beforeAll would always read as false and silently skip the entire file. */

let anon, secret, available = false, ids = {};
let skipReason = "";

function localEnv() {
  try {
    const out = execSync("npx supabase status -o env", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 120000,
    }).toString();
    const get = (k) => (out.match(new RegExp("^" + k + '="?([^"\n]+)"?$', "m")) || [])[1];
    return { url: get("API_URL"), publishable: get("PUBLISHABLE_KEY"), secret: get("SECRET_KEY") };
  } catch (e) {
    skipReason = "could not read `supabase status`: " + e.message;
    return null;
  }
}

let urlForTests = null, publishableForTests = null;

async function setup() {
  const env = localEnv();
  if (!env?.url || !env.publishable || !env.secret) {
    skipReason = skipReason || "local Supabase env incomplete";
    return;
  }
  urlForTests = env.url;
  publishableForTests = env.publishable;
  anon = createClient(env.url, env.publishable, { auth: { persistSession: false } });
  secret = createClient(env.url, env.secret, { auth: { persistSession: false } });

  // Seed with the SECRET key (which bypasses RLS) so the read assertions below have
  // something to find and cannot pass vacuously.
  const { data: league, error } = await secret
    .from("leagues").insert({ name: "RLS Test League" }).select().single();
  if (error) {
    skipReason = "secret-key seed insert failed: " + error.code + " " + error.message;
    return;
  }
  ids.league = league.id;

  const { data: season } = await secret.from("seasons")
    .insert({ league_id: league.id, year: 2000 + Math.floor(Math.random() * 900) })
    .select().single();
  const { data: team } = await secret.from("teams")
    .insert({ league_id: league.id, name: "RLS Test Team" }).select().single();
  const { data: period } = await secret.from("periods")
    .insert({ season_id: season.id, type: "week", number: 1 }).select().single();
  const { data: period2 } = await secret.from("periods")
    .insert({ season_id: season.id, type: "week", number: 2 }).select().single();
  Object.assign(ids, {
    season: season.id, team: team.id, period: period.id, period2: period2.id,
  });

  await secret.from("league_secrets")
    .insert({ league_id: league.id, commissioner_code_hash: "hash-must-never-leak" });
  await secret.from("team_secrets")
    .insert({ team_id: team.id, join_code_hash: "join-hash-must-never-leak" });
  await secret.from("sessions").insert({
    token_hash: "session-token-must-never-leak-" + league.id, league_id: league.id,
    role: "commissioner", expires_at: new Date(Date.now() + 3.6e6).toISOString(),
  });
  // One unresolved scheme and one resolved, to exercise the resolved_at gate.
  await secret.from("schemes")
    .insert({ period_id: period.id, team_id: team.id, type: "noaction" });
  await secret.from("schemes").insert({
    period_id: period2.id, team_id: team.id, type: "noaction",
    resolved_at: new Date().toISOString(), outcome: "applied",
  });

  available = true;
}

await setup();

if (!available) {
  console.warn(
    "\n[rls.test.js] SKIPPED: " + skipReason +
    "\n              These are the security assertions. Run them with: npx supabase start\n"
  );
}

/* Clean up after ourselves. Leaving a stray league behind makes the demo seed's
 * "refuse to run where real data exists" guard fire in other suites - which is the
 * guard working correctly, and our mess to avoid. */
afterAll(async () => {
  if (available && ids.league) await secret.from("leagues").delete().eq("id", ids.league);
});

const gate = () => (available ? describe : describe.skip);

gate()("RLS: what a browser holding the publishable key can READ", () => {
  const readable = [
    "leagues", "seasons", "teams", "team_totals", "players",
    "periods", "roster_slots", "stat_lines", "period_results", "events",
  ];
  for (const table of readable) {
    it("can select from " + table, async () => {
      const { error } = await anon.from(table).select("*").limit(1);
      expect(error).toBeNull();
    });
  }

  it("actually sees the seeded league (policies are not vacuously passing)", async () => {
    const { data, error } = await anon.from("leagues").select("*").eq("id", ids.league);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("RLS Test League");
  });
});

gate()("RLS: what it can NOT read", () => {
  for (const table of ["league_secrets", "team_secrets", "sessions", "auth_throttle"]) {
    it("cannot read " + table + " - no policy exists, and none ever should", async () => {
      const { data, error } = await anon.from(table).select("*");
      // RLS with no policy returns zero rows rather than an error. Either way, the
      // secret must not come back.
      expect(error ? true : data.length === 0).toBe(true);
      expect(JSON.stringify(data ?? [])).not.toMatch(/must-never-leak/);
    });
  }

  const SCHEME_COLS = "id,period_id,team_id,type,position,player_id,resolved_at,outcome";

  it("CAN read a RESOLVED scheme, selecting the granted columns (OQ-9)", async () => {
    const { data, error } = await anon
      .from("schemes").select(SCHEME_COLS).eq("period_id", ids.period2);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].outcome).toBe("applied");
  });

  it("rejects select('*') on schemes - callers MUST name the granted columns", async () => {
    // A consequence of the column-level grant, and a real trap for whoever writes the
    // adapter: `*` expands to every column including submitted_at, which anon cannot
    // read, so the whole query fails with 42501 rather than silently omitting it.
    const { error } = await anon.from("schemes").select("*").limit(1);
    expect(error).not.toBeNull();
    expect(error.code).toBe("42501");
  });

  it("still hides an UNRESOLVED scheme even with the granted columns", async () => {
    const { data, error } = await anon
      .from("schemes").select(SCHEME_COLS).eq("period_id", ids.period);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("cannot read schemes.submitted_at - the one genuinely new disclosure", async () => {
    const { error } = await anon.from("schemes").select("submitted_at").limit(1);
    expect(error).not.toBeNull(); // column-level grant withholds it
  });
});

gate()("RLS: what it can NOT write - the whole write-security model", () => {
  const cases = [
    ["leagues", { name: "hacked" }],
    ["seasons", () => ({ league_id: ids.league, year: 2099 })],
    ["teams", () => ({ league_id: ids.league, name: "hacked team" })],
    ["players", () => ({ league_id: ids.league, name: "Ghost", position: "QB", nfl_team: "X" })],
    ["periods", () => ({ season_id: ids.season, type: "week", number: 99 })],
    ["roster_slots", () => ({ period_id: ids.period, team_id: ids.team, area: "starter", slot: "QB" })],
    ["stat_lines", () => ({ period_id: ids.period, team_id: ids.team, slot: "QB", yards: 9999 })],
    ["schemes", () => ({ period_id: ids.period, team_id: ids.team, type: "noaction" })],
    ["period_results", () => ({ period_id: ids.period, team_id: ids.team, rank: 1, raw_score: 999, standings_points: 99 })],
    ["events", () => ({ season_id: ids.season, type: "hack", text: "hacked" })],
    ["team_totals", () => ({ season_id: ids.season, team_id: ids.team, scope: "regular" })],
    ["league_secrets", () => ({ league_id: ids.league, commissioner_code_hash: "x" })],
    ["team_secrets", () => ({ team_id: ids.team, join_code_hash: "x" })],
    ["sessions", () => ({ token_hash: "x", league_id: ids.league, role: "commissioner", expires_at: new Date().toISOString() })],
    /* auth_throttle joins the unreachable set in Phase 3a. Writable from a browser it
     * would be worse than useless: an attacker could clear his own lockout, or set one
     * on someone else and lock the commissioner out of his league. */
    ["auth_throttle", () => ({ bucket_key: "ip:hacked", attempts: 0 })],
  ];

  for (const [table, row] of cases) {
    it("cannot INSERT into " + table, async () => {
      const payload = typeof row === "function" ? row() : row;
      const { error } = await anon.from(table).insert(payload);
      expect(error).not.toBeNull();
    });
  }

  it("cannot UPDATE a team it can read", async () => {
    const { error } = await anon.from("teams").update({ name: "hacked" }).eq("id", ids.team);
    // No update policy -> zero rows match, so this must not actually change anything.
    const { data } = await secret.from("teams").select("name").eq("id", ids.team).single();
    expect(data.name).toBe("RLS Test Team");
    expect(error === null || error !== null).toBe(true); // either shape is fine
  });

  it("cannot DELETE a league", async () => {
    await anon.from("leagues").delete().eq("id", ids.league);
    const { data } = await secret.from("leagues").select("id").eq("id", ids.league);
    expect(data).toHaveLength(1); // still there
  });

  it("cannot escalate by updating a stat line", async () => {
    await secret.from("stat_lines")
      .insert({ period_id: ids.period, team_id: ids.team, slot: "QB", yards: 10, tds: 0 });
    await anon.from("stat_lines").update({ yards: 99999 }).eq("period_id", ids.period);
    const { data } = await secret.from("stat_lines")
      .select("yards").eq("period_id", ids.period).eq("slot", "QB").single();
    expect(data.yards).toBe(10);
  });
});

/* ============================================================================
 *  PHASE 3b - profiles and league_members.
 *
 *  These are the first tables in the schema that are about PEOPLE rather than
 *  about the game, so "who can read this" stops being a formality. A signed-in
 *  person may see who they are and what they belong to. Nothing else, and a
 *  signed-out visitor sees none of it.
 * ==========================================================================*/

gate()("RLS: profiles and league_members", () => {
  let userA = null, userB = null, clientA = null;

  const makeUser = async (email) => {
    const { data } = await secret.auth.admin.createUser({
      email, password: "rls-test-password-123", email_confirm: true,
    });
    return data.user;
  };

  beforeAll(async () => {
    if (!available) return;
    userA = await makeUser("rls-a-" + ids.league + "@example.test");
    userB = await makeUser("rls-b-" + ids.league + "@example.test");

    await secret.from("profiles").insert([
      { user_id: userA.id, display_name: "Reader A" },
      { user_id: userB.id, display_name: "Someone Else B" },
    ]);
    await secret.from("league_members").insert([
      { league_id: ids.league, user_id: userA.id, role: "commissioner" },
      { league_id: ids.league, user_id: userB.id, role: "manager", team_id: ids.team },
    ]);

    clientA = createClient(urlForTests, publishableForTests, { auth: { persistSession: false } });
    await clientA.auth.signInWithPassword({
      email: "rls-a-" + ids.league + "@example.test", password: "rls-test-password-123",
    });
  });

  afterAll(async () => {
    if (!available) return;
    for (const u of [userA, userB]) if (u) await secret.auth.admin.deleteUser(u.id);
  });

  it("a SIGNED-OUT visitor cannot read profiles or memberships at all", async () => {
    // These tables get no grant to anon whatsoever - being about people, not the game.
    for (const table of ["profiles", "league_members"]) {
      const { data, error } = await anon.from(table).select("*");
      expect(error ? true : data.length === 0).toBe(true);
      expect(JSON.stringify(data ?? [])).not.toMatch(/Someone Else B/);
    }
  });

  it("a signed-in person reads their OWN profile and nobody else's", async () => {
    const { data, error } = await clientA.from("profiles").select("user_id, display_name");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].display_name).toBe("Reader A");
  });

  it("a signed-in person reads their OWN membership and nobody else's", async () => {
    /* Deliberately narrow. A policy asking "is the reader a member of this league?"
     * would query league_members from inside league_members' own policy and recurse;
     * scoping to auth.uid() sidesteps that, and the app reads teams rather than
     * memberships so nothing is lost. */
    const { data, error } = await clientA.from("league_members").select("user_id, role");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].user_id).toBe(userA.id);
    expect(data[0].role).toBe("commissioner");
  });

  it("a signed-in person cannot INSERT a membership for themselves", async () => {
    // Self-promotion is the obvious attack: every write goes through the function.
    const { error } = await clientA.from("league_members").insert({
      league_id: ids.league, user_id: userA.id, role: "commissioner",
    });
    expect(error).not.toBeNull();
  });

  it("a signed-in person cannot UPGRADE their own role", async () => {
    await clientA.from("league_members").update({ role: "commissioner" }).eq("user_id", userB.id);
    const { data } = await secret
      .from("league_members").select("role").eq("user_id", userB.id).single();
    expect(data.role).toBe("manager"); // unchanged
  });
});
