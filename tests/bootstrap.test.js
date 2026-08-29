/**
 * BLANK LEAGUE -> POPULATED, and the identity bug that nearly destroyed it.
 *
 * `supabase db push` creates the schema but runs no seed, so a freshly deployed
 * database has zero leagues. Without a bootstrap the app sits on "Loading..." forever.
 * These tests cover that path, and pin the far worse bug it uncovered.
 *
 * THE BUG (regression-guarded below)
 * decomposeLeague() derived every row id from `leagueKey`. Two callers passing
 * different leagueKeys for the SAME league therefore produced different ids for every
 * row - so persisting an ordinary edit INSERTED a whole new league and DELETED the old
 * one, cascading away everything hanging off it. In practice: adding the first team
 * to a real league permanently locked the commissioner out of it.
 *
 * It never showed up against the demo league because "demo" was hardcoded on both
 * sides, which is exactly why a green test suite missed it. Identity is now resolved by
 * NATURAL KEY from the existing rows, with derivation only as a fallback for new rows.
 *
 * Skips itself when the local stack isn't running:  npx supabase start
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createDefaultState } from "../src/engine/index.js";
import { decomposeLeague } from "../src/storage/decompose.js";
import { fetchLeagueRows, hydrate, persistBlob } from "../server/league.js";
import * as ops from "../server/operations.js";

let db, available = false, skipReason = "";
/* Accounts sign in with the PUBLISHABLE key, exactly as a browser would. */
let dbUrl = null, dbPublishable = null;

function localEnv() {
  try {
    const out = execSync("npx supabase status -o env", {
      stdio: ["ignore", "pipe", "ignore"], timeout: 120000,
    }).toString();
    const get = (k) => (out.match(new RegExp("^" + k + '="?([^"\n]+)"?$', "m")) || [])[1];
    return { url: get("API_URL"), secret: get("SECRET_KEY"), publishable: get("PUBLISHABLE_KEY") || get("ANON_KEY") };
  } catch (e) {
    skipReason = "supabase status failed: " + e.message;
    return null;
  }
}

const env = localEnv();
if (env?.url && env.secret) {
  db = createClient(env.url, env.secret, { auth: { persistSession: false } });
  dbUrl = env.url;
  dbPublishable = env.publishable;
  available = true;
} else {
  console.warn("\n[bootstrap.test.js] SKIPPED: " + (skipReason || "no local stack") + "\n");
}
/* Clean up after ourselves. A leftover league pollutes the dev database that
 * `npm run dev` reads, and once there are two leagues the app cannot tell which one it
 * is meant to load without VITE_LEAGUE_NAME set. Same discipline as rls.test.js. */
afterAll(async () => {
  if (!available) return;
  await db.from("leagues").delete().eq("name", LEAGUE_NAME);
  // Delete only the users this file made - the other suites are creating their own.
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    await db.auth.admin.deleteUser(id).catch(() => {});
  }
});

const gate = () => (available ? describe : describe.skip);

const LEAGUE_NAME = "Bootstrap Test League";

/* Accounts this file makes, so cleanup is exact - rls.test.js and server.test.js create
 * their own, and deleting everything would delete theirs. */
const createdUserIds = [];

async function makeAccount(email) {
  const { data: created } = await db.auth.admin.createUser({
    email, password: "test-password-123", email_confirm: true,
  });
  if (created?.user?.id) createdUserIds.push(created.user.id);
  const anon = createClient(dbUrl, dbPublishable, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password: "test-password-123" });
  if (error) throw new Error("could not sign in test account: " + error.message);
  return { token: data.session.access_token, userId: data.user.id };
}

/* A blank league: one season, week 1 pre-deal, the full 223-player pool, and NO teams.
 *
 * 223, not the template's 224: this builds from `createDefaultState()`, which expands
 * src/data/teamRows.js. `createLeague` is the path that copies `player_pool` - see
 * tests/server.test.js. The two pools are different sizes on purpose since the template
 * was rebuilt from the depth charts (20260829000000).
 *
 * `scripts/bootstrap-league.mjs` used to do this, setting a commissioner code so nobody
 * could claim the league by typing one first. Both the script and the code are gone -
 * `createLeague` makes the creator the commissioner, so there is no window to close -
 * but the SHAPE it produced is still what a brand new league looks like, and the
 * regression below depends on starting from one. */
async function bootstrapBlank(leagueKey = "bootstrap-test:2026") {
  await db.from("leagues").delete().eq("name", LEAGUE_NAME);
  const blank = createDefaultState();
  blank.leagueName = LEAGUE_NAME;
  const rows = decomposeLeague(blank, { leagueKey, year: 2026 });
  for (const t of ["leagues", "seasons", "players", "periods"]) {
    if (rows[t]?.length) {
      const { error } = await db.from(t).insert(rows[t]);
      if (error) throw new Error(t + ": " + error.message);
    }
  }
  const leagueId = rows.leagues[0].id;
  const acct = await makeAccount("bootstrap-commish-" + Date.now() + "@example.test");
  const { error } = await db.from("league_members").insert({
    league_id: leagueId, user_id: acct.userId, role: "commissioner", team_id: null,
  });
  if (error) throw new Error("league_members: " + error.message);
  return { leagueId, token: acct.token, userId: acct.userId };
}

gate()("a blank league", () => {
  let leagueId, token;
  beforeEach(async () => {
    ({ leagueId, token } = await bootstrapBlank());
  });

  it("has a player pool and no teams", async () => {
    const view = hydrate(await fetchLeagueRows(db, leagueId));
    expect(view.teams).toHaveLength(0);
    expect(view.playerPool).toHaveLength(223); // you cannot deal without players
    expect(view.currentPeriod).toEqual({ type: "week", number: 1, phase: "pre-deal" });
  });

  it("carries no credential of its own - the membership is the whole of it", async () => {
    /* There is nothing secret in a league row any more. This used to assert the
       opposite side of the same coin: that `commissionerCodeSet` was true and the code
       itself never appeared in the view. */
    const view = hydrate(await fetchLeagueRows(db, leagueId));
    expect(view.commissionerCodeSet).toBeUndefined();

    const { data: members } = await db
      .from("league_members").select("role").eq("league_id", leagueId);
    expect(members.map((m) => m.role)).toEqual(["commissioner"]);
  });

  it("authorizes its commissioner", async () => {
    const r = await ops.whoami(db, { leagueId, token });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe("commissioner");
  });

  it("refuses to deal with no teams", async () => {
    const r = await ops.dealPeriod(db, { leagueId, token });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/at least one team/i);
  });
});

gate()("REGRESSION: a state write must never re-create the league", () => {
  let leagueId, userId;
  beforeEach(async () => {
    // Bootstrapped with one leagueKey...
    ({ leagueId, userId } = await bootstrapBlank("some-original-key:2026"));
  });

  it("preserves the league id and its memberships when a team is added", async () => {
    const before = await fetchLeagueRows(db, leagueId);
    const blob = hydrate(before);
    delete blob._meta;
    blob.teams.push({
      id: "team_regression", name: "Regression FC", roster: null,
      cumulative: { standingsPoints: 0, weekWins: 0, coachWins: 0, totalTDs: 0, totalYards: 0, bestPlayer: null },
      playoffCumulative: { standingsPoints: 0, weekWins: 0, coachWins: 0, totalTDs: 0, totalYards: 0, bestPlayer: null },
    });

    // ...and persisted with a DIFFERENT leagueKey, which is what used to be fatal.
    await persistBlob(db, before, blob, { leagueKey: leagueId, year: 2026 });

    const leagues = await db.from("leagues").select("id").eq("id", leagueId);
    expect(leagues.data).toHaveLength(1);              // same league, not a second one

    /* THE POINT OF THE WHOLE TEST. A re-created league cascades its memberships away,
       and the commissioner is then locked out of a league nobody can repair. It used to
       be league_secrets and sessions that vanished; the row that matters is different
       now, the failure it guards against is identical. */
    const members = await db
      .from("league_members").select("user_id, role").eq("league_id", leagueId);
    expect(members.data).toHaveLength(1);
    expect(members.data[0].user_id).toBe(userId);
    expect(members.data[0].role).toBe("commissioner");

    const players = await db.from("players").select("id").eq("league_id", leagueId);
    expect(players.data).toHaveLength(223);            // pool intact

    const after = hydrate(await fetchLeagueRows(db, leagueId));
    expect(after.teams.map((t) => t.name)).toContain("Regression FC");
  });

  it("keeps ids stable across repeated writes", async () => {
    const first = await fetchLeagueRows(db, leagueId);
    const blob = hydrate(first);
    delete blob._meta;

    await persistBlob(db, first, blob, { leagueKey: "yet-another-key", year: 2026 });
    const second = await fetchLeagueRows(db, leagueId);

    expect(second.leagues[0].id).toBe(first.leagues[0].id);
    expect(second.seasons[0].id).toBe(first.seasons[0].id);
    expect(second.periods.map((p) => p.id).sort()).toEqual(first.periods.map((p) => p.id).sort());
    expect(second.players.length).toBe(first.players.length);
  });
});
