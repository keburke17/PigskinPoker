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
  /* EXPLICITLY public, since Phase 3d. New leagues now default to 'members' - private
   * to their members - so the read assertions below would otherwise pass vacuously by
   * finding nothing, which is the failure mode this whole suite exists to avoid. The
   * private case gets its own block at the bottom of this file. */
  const { data: league, error } = await secret
    .from("leagues").insert({ name: "RLS Test League", visibility: "public" }).select().single();
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

  /* The secret-bearing fixture is an INVITE now. league_secrets, team_secrets, sessions
   * and auth_throttle were dropped with join codes - see
   * supabase/migrations/20260820000000_retire_join_codes.sql. */
  const inviteFixture = await secret.from("invites").insert({
    league_id: league.id, team_id: team.id, role: "manager",
    code_ref: "RLSREF", code_hash: "invite-hash-must-never-leak",
  });
  /* THROW rather than ignore. "anon cannot read invites" passes just as happily when
   * there is no invite to read, so a fixture that silently failed to insert - a renamed
   * column, say - would turn a security assertion into a vacuous one. */
  if (inviteFixture.error) throw new Error("invite fixture failed: " + inviteFixture.error.message);
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
    // Not league-scoped and deliberately public: it is NFL names, and every league
    // already exposes the same ones through `players`.
    "player_pool",
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
  for (const table of ["invites"]) {
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
    /* Writable from a browser, an invite would let anyone mint themselves a membership
     * in any league - which is the whole authorization model in one row. */
    ["invites", () => ({ league_id: ids.league, role: "manager", code_ref: "HACKED", code_hash: "x" })],
    /* The pool is public to READ - it is NFL names, and every league already exposes
     * them - but writing it would poison every league created afterwards. */
    ["player_pool", () => ({ legacy_id: "hacked", name: "Hacker", position: "QB", nfl_team: "Nowhere" })],
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

/* ============================================================================
 *  PHASE 3d - league-scoped reads.
 *
 *  Every read policy in this schema used to be `using (true)`: correct for one
 *  public league, and wrong the moment there are two. THIS is the block that
 *  proves the second league's data is not readable by the first league's browser,
 *  and it is the single most important thing in this file - a mistake here does
 *  not throw, it silently shows one league another league's rosters.
 * ==========================================================================*/

gate()("RLS: a PRIVATE league is invisible from outside", () => {
  const priv = {};
  let outsider = null, member = null, memberUser = null, outsiderUser = null;

  beforeAll(async () => {
    if (!available) return;

    // A whole second league, defaulting to 'members' - i.e. created the way every
    // league from now on is created.
    const { data: league } = await secret
      .from("leagues").insert({ name: "Private Test League" }).select().single();
    priv.league = league.id;
    const { data: season } = await secret.from("seasons")
      .insert({ league_id: league.id, year: 2091 }).select().single();
    const { data: team } = await secret.from("teams")
      .insert({ league_id: league.id, name: "Secret Team" }).select().single();
    const { data: period } = await secret.from("periods")
      .insert({ season_id: season.id, type: "week", number: 1 }).select().single();
    Object.assign(priv, { season: season.id, team: team.id, period: period.id });

    await secret.from("players").insert({
      league_id: league.id, name: "Confidential Player", position: "QB", nfl_team: "XX",
    });
    await secret.from("roster_slots")
      .insert({ period_id: period.id, team_id: team.id, area: "starter", slot: "QB" });
    await secret.from("stat_lines")
      .insert({ period_id: period.id, team_id: team.id, slot: "QB", yards: 4242 });
    await secret.from("period_results").insert({
      period_id: period.id, team_id: team.id, rank: 1, raw_score: 999, standings_points: 9,
    });
    await secret.from("team_totals")
      .insert({ season_id: season.id, team_id: team.id, scope: "regular" });
    await secret.from("events")
      .insert({ season_id: season.id, type: "note", text: "confidential event" });
    await secret.from("schemes").insert({
      period_id: period.id, team_id: team.id, type: "noaction",
      resolved_at: new Date().toISOString(), outcome: "applied",
    });

    const mk = async (email) => {
      const { data } = await secret.auth.admin.createUser({
        email, password: "rls-test-password-123", email_confirm: true,
      });
      return data.user;
    };
    memberUser = await mk("priv-member-" + priv.league + "@example.test");
    outsiderUser = await mk("priv-outsider-" + priv.league + "@example.test");
    await secret.from("league_members").insert({
      league_id: priv.league, user_id: memberUser.id, role: "manager", team_id: priv.team,
    });

    const signIn = async (email) => {
      const c = createClient(urlForTests, publishableForTests, { auth: { persistSession: false } });
      await c.auth.signInWithPassword({ email, password: "rls-test-password-123" });
      return c;
    };
    member = await signIn("priv-member-" + priv.league + "@example.test");
    outsider = await signIn("priv-outsider-" + priv.league + "@example.test");
  });

  afterAll(async () => {
    if (!available) return;
    for (const u of [memberUser, outsiderUser]) if (u) await secret.auth.admin.deleteUser(u.id);
    if (priv.league) await secret.from("leagues").delete().eq("id", priv.league);
  });

  it("defaults to 'members' - a new league is private without anyone choosing", async () => {
    // The default is the whole safety property: forgetting to set visibility must fail
    // CLOSED. Every league created from here on is private until someone says otherwise.
    const { data } = await secret.from("leagues").select("visibility").eq("id", priv.league).single();
    expect(data.visibility).toBe("members");
  });

  it("a SIGNED-OUT visitor sees nothing of it", async () => {
    const { data } = await anon.from("leagues").select("*").eq("id", priv.league);
    expect(data ?? []).toHaveLength(0);
  });

  it("a signed-in OUTSIDER sees nothing of it either", async () => {
    // Having an account is not membership. This is the case a `using (true)` policy
    // would wave straight through.
    const { data } = await outsider.from("leagues").select("*").eq("id", priv.league);
    expect(data ?? []).toHaveLength(0);
  });

  /* Table by table, because a policy is per-table and one missed table is a leak.
   * `leagues` is covered above; these are the ones that reach a league INDIRECTLY,
   * through seasons or periods, which is where a join is easy to get wrong. */
  const hidden = [
    ["seasons", () => ({ col: "league_id", val: priv.league })],
    ["teams", () => ({ col: "league_id", val: priv.league })],
    ["players", () => ({ col: "league_id", val: priv.league })],
    ["team_totals", () => ({ col: "season_id", val: priv.season })],
    ["events", () => ({ col: "season_id", val: priv.season })],
    ["periods", () => ({ col: "season_id", val: priv.season })],
    ["roster_slots", () => ({ col: "period_id", val: priv.period })],
    ["stat_lines", () => ({ col: "period_id", val: priv.period })],
    ["period_results", () => ({ col: "period_id", val: priv.period })],
  ];

  for (const [table, where] of hidden) {
    it("hides " + table + " from a signed-out visitor", async () => {
      const { col, val } = where();
      const { data } = await anon.from(table).select("*").eq(col, val);
      expect(data ?? []).toHaveLength(0);
    });

    it("hides " + table + " from a signed-in outsider", async () => {
      const { col, val } = where();
      const { data } = await outsider.from(table).select("*").eq(col, val);
      expect(data ?? []).toHaveLength(0);
    });
  }

  it("hides even a RESOLVED scheme, which the public league would show", async () => {
    // Two gates stacked: resolved_at (OQ-9) AND league scope. Passing the first must
    // not be enough.
    const cols = "id,period_id,team_id,type,position,player_id,resolved_at,outcome";
    const { data } = await anon.from("schemes").select(cols).eq("period_id", priv.period);
    expect(data ?? []).toHaveLength(0);
  });

  it("but a MEMBER reads all of it", async () => {
    /* The other half, and the reason this cannot just be "deny everything". If the
     * scoping were too tight the league would be locked out of its own data, and that
     * would show up as an empty app rather than an error. */
    const { data: leagues } = await member.from("leagues").select("*").eq("id", priv.league);
    expect(leagues).toHaveLength(1);
    expect(leagues[0].name).toBe("Private Test League");

    const { data: players } = await member.from("players").select("name").eq("league_id", priv.league);
    expect(players.map((p) => p.name)).toContain("Confidential Player");

    const { data: stats } = await member.from("stat_lines").select("yards").eq("period_id", priv.period);
    expect(stats[0].yards).toBe(4242);
  });

  it("and the PUBLIC league is still readable by everyone, unchanged", async () => {
    // Nothing may change for the league that is actually being played.
    const { data } = await anon.from("leagues").select("name").eq("id", ids.league);
    expect(data).toHaveLength(1);
  });

  it("a member of ONE league still cannot read another private one", async () => {
    /* The multi-league case stated directly: membership is per league, not a global
     * "is signed in and belongs to something" flag. */
    const { data: other } = await secret
      .from("leagues").insert({ name: "Third League" }).select().single();
    const { data } = await member.from("leagues").select("*").eq("id", other.id);
    expect(data ?? []).toHaveLength(0);
    await secret.from("leagues").delete().eq("id", other.id);
  });

  it("invites are unreachable from a browser, member or not", async () => {
    await secret.from("invites").insert({
      league_id: priv.league, role: "manager", team_id: priv.team,
      code_ref: "TESTRF", code_hash: "invite-hash-must-never-leak",
    });
    for (const client of [anon, outsider, member]) {
      const { data, error } = await client.from("invites").select("*");
      expect(error ? true : (data ?? []).length === 0).toBe(true);
      expect(JSON.stringify(data ?? [])).not.toMatch(/must-never-leak/);
    }
  });
});
