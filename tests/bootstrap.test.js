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
 * one, cascading away league_secrets and sessions. In practice: adding the first team
 * to a real league permanently locked the commissioner out of it.
 *
 * It never showed up against the demo league because "demo" was hardcoded on both
 * sides, which is exactly why a green test suite missed it. Identity is now resolved by
 * NATURAL KEY from the existing rows, with derivation only as a fallback for new rows.
 *
 * Skips itself when the local stack isn't running:  npx supabase start
 */

import { describe, it, expect, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createDefaultState } from "../src/engine/index.js";
import { decomposeLeague } from "../src/storage/decompose.js";
import { hashCode } from "../server/auth.js";
import { fetchLeagueRows, hydrate, persistBlob } from "../server/league.js";
import * as ops from "../server/operations.js";

let db, available = false, skipReason = "";

function localEnv() {
  try {
    const out = execSync("npx supabase status -o env", {
      stdio: ["ignore", "pipe", "ignore"], timeout: 120000,
    }).toString();
    const get = (k) => (out.match(new RegExp("^" + k + '="?([^"\n]+)"?$', "m")) || [])[1];
    return { url: get("API_URL"), secret: get("SECRET_KEY") };
  } catch (e) {
    skipReason = "supabase status failed: " + e.message;
    return null;
  }
}

const env = localEnv();
if (env?.url && env.secret) {
  db = createClient(env.url, env.secret, { auth: { persistSession: false } });
  available = true;
} else {
  console.warn("\n[bootstrap.test.js] SKIPPED: " + (skipReason || "no local stack") + "\n");
}
const gate = () => (available ? describe : describe.skip);

const LEAGUE_NAME = "Bootstrap Test League";
const COMMISH = "bootstrap-test-code";

/** Exactly what scripts/bootstrap-league.mjs does. */
async function bootstrapBlank(leagueKey = "bootstrap-test:2026") {
  await db.from("leagues").delete().eq("name", LEAGUE_NAME);
  const blank = createDefaultState();
  blank.leagueName = LEAGUE_NAME;
  const rows = decomposeLeague(blank, { leagueKey, year: 2026, hashCode });
  for (const t of ["leagues", "seasons", "players", "periods"]) {
    if (rows[t]?.length) {
      const { error } = await db.from(t).insert(rows[t]);
      if (error) throw new Error(t + ": " + error.message);
    }
  }
  const leagueId = rows.leagues[0].id;
  await db.from("league_secrets").insert({
    league_id: leagueId, commissioner_code_hash: hashCode(COMMISH),
  });
  await db.from("leagues").update({ has_commissioner_code: true }).eq("id", leagueId);
  return leagueId;
}

gate()("a blank league", () => {
  let leagueId;
  beforeEach(async () => {
    leagueId = await bootstrapBlank();
  });

  it("has a player pool and no teams", async () => {
    const view = hydrate(await fetchLeagueRows(db, leagueId));
    expect(view.teams).toHaveLength(0);
    expect(view.playerPool).toHaveLength(223); // you cannot deal without players
    expect(view.currentPeriod).toEqual({ type: "week", number: 1, phase: "pre-deal" });
  });

  it("reports that a commissioner code is set, without exposing it", async () => {
    const view = hydrate(await fetchLeagueRows(db, leagueId));
    expect(view.commissionerCodeSet).toBe(true);
    // The login screen must offer "log in", not "create the commissioner login".
    expect(JSON.stringify(view)).not.toMatch(new RegExp(COMMISH, "i"));
  });

  it("accepts the commissioner code set at bootstrap", async () => {
    const r = await ops.loginCommissioner(db, { leagueId, code: COMMISH });
    expect(r.status).toBe(200);
  });

  it("refuses to deal with no teams", async () => {
    const { body: { token } } = await ops.loginCommissioner(db, { leagueId, code: COMMISH });
    const r = await ops.dealPeriod(db, { leagueId, token });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/at least one team/i);
  });
});

gate()("REGRESSION: a state write must never re-create the league", () => {
  let leagueId;
  beforeEach(async () => {
    // Bootstrapped with one leagueKey...
    leagueId = await bootstrapBlank("some-original-key:2026");
  });

  it("preserves the league id, its secrets and live sessions when a team is added", async () => {
    const { body: { token } } = await ops.loginCommissioner(db, { leagueId, code: COMMISH });
    expect(token).toBeTruthy();

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

    const leagues = await db.from("leagues").select("id, has_commissioner_code").eq("id", leagueId);
    expect(leagues.data).toHaveLength(1);              // same league, not a second one
    expect(leagues.data[0].has_commissioner_code).toBe(true); // flag not clobbered

    const secrets = await db.from("league_secrets").select("league_id").eq("league_id", leagueId);
    expect(secrets.data).toHaveLength(1);              // commissioner not locked out

    const sessions = await db.from("sessions").select("id").eq("league_id", leagueId);
    expect(sessions.data.length).toBeGreaterThan(0);   // still signed in

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
