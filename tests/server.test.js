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
import { fetchLeagueRows, hydrate } from "../server/league.js";

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

/* One finished week, and how much detail is hanging off it. Used by anything asserting
 * that a write did NOT take a past week's rosters or stat lines with it - issue #56 for
 * `replaceLeague`, and the rename above, which must never be able to. Module scope so
 * both blocks can reach them. */
const weekPeriod = async (number) => {
  const { data } = await db
    .from("periods").select("id").eq("type", "week").eq("number", number).maybeSingle();
  return data?.id ?? null;
};
const countIn = async (table, periodId) => {
  const { data } = await db.from(table).select("id").eq("period_id", periodId);
  return (data ?? []).length;
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

/* Naming a team, which is the one write a MANAGER makes that is not about his roster.
 *
 * It had no route of its own until 2026-09-09: both rename buttons went through
 * `replaceLeague`, the commissioner-only whole-blob write, so a manager pressing Rename
 * on My Team was refused every time. He saw nothing - the client dropped a `forbidden`
 * on the floor (src/hooks/opError.js) - and the old name simply came back.
 *
 * What is asserted here is the boundary the new route has to hold: your own team yes,
 * anybody else's no, and the commissioner over all of them.
 */
gate()("renameTeam", () => {
  beforeEach(() => resetDemo());

  it("lets a manager rename his OWN team", async () => {
    const token = await asManager(T1);
    const r = await ops.renameTeam(db, { leagueId, token, teamId: T1, name: "Gridiron Gamblers II" });
    expect(r.status).toBe(200);
    expect(r.body.view.teams.find((t) => t.id === T1).name).toBe("Gridiron Gamblers II");

    const { data: row } = await db
      .from("teams").select("name").eq("league_id", leagueId).eq("legacy_id", T1).maybeSingle();
    expect(row.name).toBe("Gridiron Gamblers II");
  });

  it("refuses a manager renaming SOMEBODY ELSE'S team", async () => {
    const token = await asManager(T1);
    const before = await db
      .from("teams").select("name").eq("league_id", leagueId).eq("legacy_id", T2).maybeSingle();

    const r = await ops.renameTeam(db, { leagueId, token, teamId: T2, name: "Renamed By A Rival" });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/your own team/i);

    const after = await db
      .from("teams").select("name").eq("league_id", leagueId).eq("legacy_id", T2).maybeSingle();
    expect(after.data.name).toBe(before.data.name);
  });

  it("refuses a rename with no session at all", async () => {
    const r = await ops.renameTeam(db, { leagueId, token: null, teamId: T1, name: "Nobody" });
    expect(r.status).toBe(401);
  });

  it("lets the commissioner rename ANY team", async () => {
    const token = await asCommissioner();
    const r = await ops.renameTeam(db, { leagueId, token, teamId: T2, name: "Commissioner's Choice" });
    expect(r.status).toBe(200);
    expect(r.body.view.teams.find((t) => t.id === T2).name).toBe("Commissioner's Choice");
  });

  it("trims the name, and refuses a blank one", async () => {
    const token = await asManager(T1);
    expect((await ops.renameTeam(db, { leagueId, token, teamId: T1, name: "   " })).status).toBe(400);
    expect((await ops.renameTeam(db, { leagueId, token, teamId: T1, name: "  Spaced Out  " })).status).toBe(200);
    const { data: row } = await db
      .from("teams").select("name").eq("league_id", leagueId).eq("legacy_id", T1).maybeSingle();
    expect(row.name).toBe("Spaced Out");
  });

  it("takes nothing with it - a rename is not roster state", async () => {
    /* The whole reason this is not a blob write. `replaceLeague` has to be careful
     * about past weeks and unresolved schemes (see its own test below); one column on
     * one row cannot touch either, and this pins that it does not start to. */
    const token = await asManager(T1);
    const week2 = await weekPeriod(2);
    const statsBefore = await countIn("stat_lines", week2);
    const slotsBefore = await countIn("roster_slots", week2);

    expect((await ops.renameTeam(db, { leagueId, token, teamId: T1, name: "Still Here" })).status).toBe(200);

    expect(await countIn("stat_lines", week2)).toBe(statsBefore);
    expect(await countIn("roster_slots", week2)).toBe(slotsBefore);
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
    const r = await ops.dealPeriod(db, { leagueId, token, refresh: false });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("phase");
  });
});

gate()("the SERVER read is ordered too (issue #60)", () => {
  beforeEach(() => resetDemo());

  /* THE BUG THIS EXISTS FOR, and why the client-side fix passing let it sit for a week.
   *
   * Issue #29 gave the client's read `order("created_at").order("id")`. `server/league.js`
   * never got it - and every write returns a freshly hydrated league that the client adopts
   * wholesale (`handle` in src/hooks/useLeague.js), so the ordered list was replaced by
   * Postgres heap order on every save, and put back by the ordered re-read a moment later.
   * On Scott's recording the team cards traded places under a cursor parked on a stat box.
   *
   * The half that outlives the flicker: finalize runs on THESE rows, and
   * rankTeamsWithTiebreak leaves teams it cannot separate in input order - so array order
   * is what slices a dead tie at the playoff cut, and OQ-A says that goes to whichever
   * team joined first.
   *
   * DELIBERATELY NOT WRITTEN AS "save twice and see if it moves". Whether heap order
   * actually shifts on a given write depends on the plan and on how the row happened to be
   * updated; a test that waits for the shuffle passes with the bug present most of the
   * time, which is exactly how this got missed. So the fixture makes created_at order the
   * REVERSE of insertion order - the demo seed inserts all six teams in one statement, so
   * they share a timestamp and nothing distinguishes them - and then asserts the contract
   * directly: hydrate hands back created_at order, not whatever came off the heap. */
  const backdate = async (table, legacyIds) => {
    /* One day apart, newest first, so the correct answer is the reverse of the order the
     * rows were written in and no read can be accidentally right. */
    const base = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < legacyIds.length; i++) {
      const at = new Date(base - i * 86400000).toISOString();
      const { error } = await db
        .from(table).update({ created_at: at })
        .eq("league_id", leagueId).eq("legacy_id", legacyIds[i]);
      if (error) throw new Error(error.message);
    }
    return [...legacyIds].reverse();
  };

  it("hydrates teams in created_at order, not heap order", async () => {
    const expected = await backdate("teams", [
      "demo_team_1", "demo_team_2", "demo_team_3", "demo_team_4", "demo_team_5", "demo_team_6",
    ]);
    const view = hydrate(await fetchLeagueRows(db, leagueId));
    expect(view.teams.map((t) => t.id)).toEqual(expected);
  });

  it("hands the same order back on the view a write returns", async () => {
    const expected = await backdate("teams", [
      "demo_team_1", "demo_team_2", "demo_team_3", "demo_team_4", "demo_team_5", "demo_team_6",
    ]);
    const token = await asCommissioner();
    const r = await ops.setStatLine(db, {
      leagueId, token, teamId: T1, slot: "QB", line: { passYards: "555", passTds: "3" },
    });
    expect(r.status).toBe(200);
    /* The view the client ADOPTS. This is the one that moved the cards. */
    expect(r.body.view.teams.map((t) => t.id)).toEqual(expected);
  });

  it("orders the player pool too, so the deal replays from a stable list", async () => {
    const expected = await backdate("players", ["p1", "p2", "p3", "p4", "p5"]);
    const view = hydrate(await fetchLeagueRows(db, leagueId));
    expect(view.playerPool.slice(0, 5).map((p) => p.id)).toEqual(expected);
  });

  it("matches the order the client's own read asks for", async () => {
    await backdate("teams", [
      "demo_team_1", "demo_team_2", "demo_team_3", "demo_team_4", "demo_team_5", "demo_team_6",
    ]);
    /* Literally the client's query (src/storage/supabase.js). Both sides hydrate the same
     * league, so they have to agree - a write's view lands in the same state as a read's. */
    const { data } = await db
      .from("teams").select("legacy_id").eq("league_id", leagueId).order("created_at").order("id");
    const view = hydrate(await fetchLeagueRows(db, leagueId));
    expect(view.teams.map((t) => t.id)).toEqual(data.map((r) => r.legacy_id));
  });
});

gate()("a decimal score survives the round trip (OQ-15 regression)", () => {
  beforeEach(() => resetDemo());

  /* THE BUG THIS EXISTS FOR. OQ-15 gave scoring one decimal place on 2026-09-07, and
   * `period_results.raw_score` was left as an integer. Every engine test passed - they
   * never touch a database - and the server suite finalized weeks quite happily, because
   * its stat lines happened to land on whole numbers. Scott found it within a day by
   * playing test weeks locally:
   *
   *   upsert period_results: invalid input syntax for type integer: "26.2"
   *
   * Worse than an error message: `persistBlob` writes table by table with no transaction,
   * so `periods` had already committed when `period_results` threw. The week advanced
   * with no results behind it, and the scoreboard showed nothing for three weeks.
   *
   * So this test does the one thing the others did not: it forces a score that CANNOT be
   * a whole number, finalizes, and reads it back out of the database. */
  it("finalizes a week whose scores are not whole numbers", async () => {
    const token = await asCommissioner();

    /* 5 rushing at 1pt/10 is 0.5, and 6 receiving is 0.6 - Scott's own example, and a
     * total of 1.1 that no integer column will take. */
    const line = await ops.setStatLine(db, {
      leagueId, token, teamId: T1, slot: "RB", line: { rushYards: "5", recYards: "6" },
    });
    expect(line.status).toBe(200);

    const fin = await ops.finalizePeriod(db, { leagueId, token });
    expect(fin.status).toBe(200);

    const row = fin.body.view.weeklyResults.find((r) => r.teamId === T1 && r.period.number === 2);
    /* The exact total depends on the demo seed, which is not the point - what matters is
     * that it is NOT a whole number, so an integer column could not have held it. */
    expect(Number(row.rawScore) % 1).not.toBe(0);

    /* Read it back from the table rather than trusting the response the write built:
     * the whole failure was that the response looked right and the row never landed. */
    /* Matched on the VALUE, not on the team: the view speaks the engine`s legacy team
     * ids and the table stores uuids, and translating them here would test the mapping
     * rather than the column. */
    const { data: results } = await db
      .from("period_results").select("raw_score, team_id, period_id");
    expect(results.length).toBeGreaterThan(0);
    const stored = results.map((r) => Number(r.raw_score));
    expect(stored).toContain(Number(row.rawScore));
    expect(stored.some((v) => v % 1 !== 0)).toBe(true);
  });

  /* The partial-write symptom, asserted directly. A week that finalized must have a
   * result row for every team that played it - "the period advanced" and "the results
   * exist" are two different facts, and for three weeks of Scott's testing they
   * disagreed. */
  it("leaves no finalized week without its results", async () => {
    const token = await asCommissioner();
    await ops.setStatLine(db, {
      leagueId, token, teamId: T1, slot: "RB", line: { rushYards: "27", recYards: "13" },
    });
    await ops.setStatLine(db, {
      leagueId, token, teamId: T2, slot: "RB", line: { rushYards: "44", recYards: "8" },
    });
    const fin = await ops.finalizePeriod(db, { leagueId, token });
    expect(fin.status).toBe(200);

    const { data: periods } = await db.from("periods").select("id, number, phase");
    const finalized = periods.filter((p) => p.phase === "finalized");
    expect(finalized.length).toBeGreaterThan(0);

    const { data: results } = await db.from("period_results").select("period_id, raw_score");
    for (const p of finalized) {
      const forPeriod = results.filter((r) => r.period_id === p.id);
      expect(forPeriod.length).toBeGreaterThan(0);
    }
    /* And at least one of them is genuinely fractional, so the assertion above is not
     * passing on whole numbers again. */
    expect(results.some((r) => Number(r.raw_score) % 1 !== 0)).toBe(true);
  });
});

gate()("the weekly cycle, server-side", () => {
  beforeEach(() => resetDemo());

  it("runs finalize -> deal -> schemes -> process, storing seeds for replay (P5)", async () => {
    const token = await asCommissioner();

    const fin = await ops.finalizePeriod(db, { leagueId, token });
    expect(fin.status).toBe(200);
    expect(fin.body.view.currentPeriod).toEqual({ type: "week", number: 3, phase: "pre-deal" });

    const dealt = await ops.dealPeriod(db, { leagueId, token, refresh: false });
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

gate()("issue #56: a blob write only deletes what the blob can speak for", () => {
  beforeEach(() => resetDemo());

  /* THE BUG THESE EXIST FOR.
   *
   * `persistBlob` deleted every row of a writable table that was absent from the
   * decomposed blob, and `decomposeLeague` can only ever describe the CURRENT period -
   * the app-state shape the engine hands back has nowhere to put a finished week's
   * per-slot detail. So finalizing a week took it from eighteen stat lines to none,
   * keeping only the aggregates in period_results: nothing left to check a wrong number
   * against, on the ordinary path, every week, in every league. Schemes went the same
   * way despite OQ-9 deliberately retaining them.
   *
   * It was found on 2026-09-07 while working out what the clock in OQ-14 would be
   * committing unattended, and written up as issue #56. `replaceLeague` had no test at
   * all, which is why the admin-tool half of it went unnoticed for so long; there is one
   * below now. */

  it("keeps a finished week's stat lines and rosters through an ordinary finalize", async () => {
    const token = await asCommissioner();
    const week2 = await weekPeriod(2);

    const statsBefore = await countIn("stat_lines", week2);
    const slotsBefore = await countIn("roster_slots", week2);
    expect(statsBefore).toBeGreaterThan(0);
    expect(slotsBefore).toBeGreaterThan(0);

    const fin = await ops.finalizePeriod(db, { leagueId, token });
    expect(fin.status).toBe(200);

    // The week really did finish - otherwise the assertions below prove nothing.
    const { data: p } = await db.from("periods").select("phase").eq("id", week2).maybeSingle();
    expect(p.phase).toBe("finalized");
    expect(await countIn("period_results", week2)).toBeGreaterThan(0);

    // ...and the detail behind those aggregates is still there. Was 0 and 0.
    expect(await countIn("stat_lines", week2)).toBe(statsBefore);
    expect(await countIn("roster_slots", week2)).toBe(slotsBefore);
  });

  it("keeps a resolved scheme through the finalize that follows it (OQ-9)", async () => {
    const token = await asCommissioner();

    await ops.finalizePeriod(db, { leagueId, token });                  // week 2 -> week 3
    const dealt = await ops.dealPeriod(db, { leagueId, token, refresh: false });
    expect(dealt.status).toBe(200);

    const mgr = await asManager(T1);
    const qb = dealt.body.view.teams.find((t) => t.id === T1).roster.starters.QB;
    const sub = await ops.submitScheme(db, {
      leagueId, token: mgr, teamId: T1, scheme: { type: "block", position: "QB", playerId: qb },
    });
    expect(sub.status).toBe(200);

    expect((await ops.processSchemes(db, { leagueId, token })).status).toBe(200);
    const { data: resolved } = await db.from("schemes").select("id, resolved_at, outcome");
    expect(resolved.length).toBe(1);
    expect(resolved[0].resolved_at).toBeTruthy();

    /* The point of OQ-9: the row is retained rather than deleted, so the history is
     * queryable once the gate opens. The very next blob write used to remove it - and
     * finalize is a blob write. */
    expect((await ops.finalizePeriod(db, { leagueId, token })).status).toBe(200);
    const { data: after } = await db.from("schemes").select("id, resolved_at");
    expect(after.length).toBe(1);
    expect(after[0].resolved_at).toBeTruthy();
  });

  /* `replaceLeague` is the whole-blob write behind every ops.mutate() call - renaming a
   * team, adding a player, editing the scoring. It had NO test, and it is the half of
   * this that docs/FOR-THE-DESIGNER.md reports as "commissioner admin tools throw away
   * schemes and past weeks". */
  it("replaceLeague: renaming a team keeps past weeks and pending schemes", async () => {
    const token = await asCommissioner();
    const week2 = await weekPeriod(2);

    const statsBefore = await countIn("stat_lines", week2);
    const slotsBefore = await countIn("roster_slots", week2);

    await ops.finalizePeriod(db, { leagueId, token });                  // week 2 -> week 3
    const dealt = await ops.dealPeriod(db, { leagueId, token, refresh: false });
    const mgr = await asManager(T1);
    const qb = dealt.body.view.teams.find((t) => t.id === T1).roster.starters.QB;
    expect((await ops.submitScheme(db, {
      leagueId, token: mgr, teamId: T1, scheme: { type: "block", position: "QB", playerId: qb },
    })).status).toBe(200);

    const blob = JSON.parse(JSON.stringify(dealt.body.view));
    delete blob._meta;
    /* THE BLINDNESS IS THE POINT, so reproduce it rather than sending the server's
     * fuller picture. A browser cannot read an unresolved scheme - the RLS gate opens
     * only once resolved_at is set (OQ-9, tests/rls.test.js) - so the blob it sends back
     * genuinely carries none, and it never held a past week's rosters at all. */
    blob.schemes = {};
    blob.teams.find((t) => t.id === T1).name = "Renamed Mid-Week";

    const r = await ops.replaceLeague(db, { leagueId, token, blob });
    expect(r.status).toBe(200);

    // The edit landed...
    const { data: team } = await db
      .from("teams").select("name").eq("league_id", leagueId).eq("legacy_id", T1).maybeSingle();
    expect(team.name).toBe("Renamed Mid-Week");

    // ...and took nothing with it. All three were emptied before the fix.
    expect((await db.from("schemes").select("id")).data.length).toBe(1);
    expect(await countIn("stat_lines", week2)).toBe(statsBefore);
    expect(await countIn("roster_slots", week2)).toBe(slotsBefore);
  });

  /* The other side of the same fix: scoping the delete pass must not quietly turn it
   * into a no-op that leaves orphans behind. A player the blob genuinely dropped still
   * goes - `players` is a table the blob really is authoritative for, and the pool is
   * carried whole. */
  it("still deletes a player the blob dropped", async () => {
    const token = await asCommissioner();
    const week2 = await weekPeriod(2);
    const statsBefore = await countIn("stat_lines", week2);

    const blob = hydrate(await fetchLeagueRows(db, leagueId));
    delete blob._meta;
    blob.schemes = {};

    /* A free agent, so the delete cannot be confused with a cascade off a roster slot
     * or a scheme - and so it exercises the unscoped branch of the pass on its own. */
    const rostered = new Set();
    blob.teams.forEach((t) => {
      if (!t.roster) return;
      Object.values(t.roster.starters).forEach((id) => id && rostered.add(id));
      t.roster.bench.forEach((id) => id && rostered.add(id));
    });
    const free = blob.playerPool.find((p) => !rostered.has(p.id));
    expect(free).toBeTruthy();
    blob.playerPool = blob.playerPool.filter((p) => p.id !== free.id);

    const r = await ops.replaceLeague(db, { leagueId, token, blob });
    expect(r.status).toBe(200);

    const { data: still } = await db
      .from("players").select("id").eq("league_id", leagueId).eq("legacy_id", free.id);
    expect(still.length).toBe(0);
    // ...and the week's detail is still not collateral.
    expect(await countIn("stat_lines", week2)).toBe(statsBefore);
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
     * correction made in the database reaches the next league with no deploy.
     *
     * 224 since 20260829000000 rebuilt the template from the live depth charts: each
     * NFL team's 1 QB, 2 RB, 2 WR, 1 TE and head coach. */
    const { token: jwt } = await makeAccount("stocker@example.test");
    const r = await ops.createLeague(db, { accountToken: jwt, name: "Stocked League", year: 2032 });
    expect(r.status).toBe(200);

    const { count } = await db
      .from("players").select("*", { count: "exact", head: true }).eq("league_id", r.body.leagueId);
    const { count: poolCount } = await db
      .from("player_pool").select("*", { count: "exact", head: true }).eq("active", true);
    expect(count).toBe(poolCount);
    expect(count).toBe(224);

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


/* Deleting a league, OQ-18.
 *
 * The property that matters is not that the row goes - it is that NOTHING is left
 * behind. Every league-scoped table cascades from `leagues`, which is a schema promise
 * rather than code, and a table added later without `on delete cascade` would break it
 * silently: the league would vanish from the app while its rows sat in the database
 * forever. So this counts the rows rather than trusting the statement.
 *
 * Each test works on a league of its own. Deleting the DEMO league behaves identically,
 * and would leave every later block in this file pointed at an id that no longer exists.
 */
gate()("deleting a league", () => {
  beforeEach(() => resetDemo());

  /* The creator's ACCOUNT token is also its commissioner session - a role is a
   * league_members row, and createLeague writes one. */
  const aLeague = async (email, name) => {
    const { token } = await accountFor(email);
    const r = await ops.createLeague(db, { accountToken: token, name, year: 2035 });
    expect(r.status).toBe(200);
    return { token, id: r.body.leagueId, name };
  };

  const countIn = async (table, id) => {
    const { count } = await db.from(table).select("*", { count: "exact", head: true }).eq("league_id", id);
    return count;
  };

  it("removes the league and everything that hung off it", async () => {
    const lg = await aLeague("deleter@example.test", "Doomed League");
    /* A commissioner invite - a fresh league has no teams yet, and a manager invite
     * needs one to point at. */
    await ops.createInvite(db, { leagueId: lg.id, token: lg.token, role: "commissioner" });

    expect(await countIn("players", lg.id)).toBeGreaterThan(100);
    expect(await countIn("league_members", lg.id)).toBe(1);
    expect(await countIn("invites", lg.id)).toBe(1);

    const r = await ops.deleteLeague(db, { leagueId: lg.id, token: lg.token, confirmName: "Doomed League" });
    expect(r.status).toBe(200);

    const { data: gone } = await db.from("leagues").select("id").eq("id", lg.id).maybeSingle();
    expect(gone).toBeNull();
    for (const table of ["players", "league_members", "invites", "seasons", "teams"]) {
      expect(await countIn(table, lg.id)).toBe(0);
    }
    // And it is off the creator's own list, not merely unreachable.
    const mine = await ops.myLeagues(db, { accountToken: lg.token });
    expect(mine.body.leagues.map((l) => l.name)).not.toContain("Doomed League");
  });

  /* These two run against the DEMO league rather than a fresh one, and must: a manager
   * membership needs a team to point at (league_members' own check constraint), and a
   * league this test just created has none. They are refusals, so the demo league is
   * still standing at the end - which is itself the assertion. */
  it("refuses a manager - deleting is the commissioner's", async () => {
    const token = await asManager(T1);
    const r = await ops.deleteLeague(db, {
      leagueId, token, confirmName: "Pigskin Poker (Demo League)",
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/commissioner/i);
    const { data } = await db.from("leagues").select("id").eq("id", leagueId).maybeSingle();
    expect(data).toBeTruthy();
  });

  it("refuses a stranger, and anyone with no credential at all", async () => {
    const outsider = await accountFor("outsider@example.test"); // signed in, member of nothing
    const name = "Pigskin Poker (Demo League)";

    expect((await ops.deleteLeague(db, { leagueId, token: null, confirmName: name })).status).toBe(401);
    expect((await ops.deleteLeague(db, { leagueId, token: outsider.token, confirmName: name })).status).toBe(401);
    expect((await ops.deleteLeague(db, { leagueId, token: "f".repeat(64), confirmName: name })).status).toBe(401);

    const { data } = await db.from("leagues").select("id").eq("id", leagueId).maybeSingle();
    expect(data).toBeTruthy();
  });

  it("refuses when the name typed is not this league's, so a wrong id cannot delete a real season", async () => {
    /* The whole point of asking for the name. Every other write here is corrected by
     * writing again; this one is not, so the id is never the only thing aimed at it. */
    const lg = await aLeague("careful@example.test", "The Sunday Boys");

    for (const typed of ["", "   ", "the sunday boy", "Some Other League"]) {
      const r = await ops.deleteLeague(db, { leagueId: lg.id, token: lg.token, confirmName: typed });
      expect(r.status).toBe(400);
    }
    const { data } = await db.from("leagues").select("id").eq("id", lg.id).maybeSingle();
    expect(data).toBeTruthy();

    // Case and stray spaces are transcription, not intent - those are accepted.
    const ok = await ops.deleteLeague(db, { leagueId: lg.id, token: lg.token, confirmName: "  the sunday BOYS " });
    expect(ok.status).toBe(200);
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

    /* Everything the feed did not claim is retired, except the rows the seed plants to
     * be protected: one the commissioner added himself, one whose status he set, one the
     * feed had already retired. See the fixture suite below for what each of them means.
     *
     * HEAD COACHES JOINED THAT LIST on 2026-09-04 (OQ-4d). The refresh does not touch a
     * Coach row whatever its source, so the unclaimed coaches here are not retired
     * either - which is most of the difference this assertion used to count. */
    const protectedRows = players.filter(
      (p) => !claimed.includes(p) &&
        (p.position === "Coach" ||
          p.source === "manual" || p.status_source === "manual" || p.feed_status === "OUT")
    ).length;
    expect(r.body.report.retired).toBe(players.length - claimed.length - protectedRows);
    expect(r.body.report.retired).toBeGreaterThan(100); // it really did do the work
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

/* The refresh against the RECORDED feed - the whole point of the fixture.
 *
 * Every assertion here was previously impossible to make: the live feed retires whoever
 * the depth chart moved this morning, so the numbers changed daily and the interesting
 * rows only existed if somebody had hand-edited them first. The seed now plants three
 * provenance cases against the same recording (scripts/generate-seed.mjs), so this is
 * the same run on every machine.
 */
gate()("the pool refresh, against the recorded fixture", () => {
  beforeEach(() => resetDemo());

  let feed;
  beforeEach(async () => {
    feed = await import("../server/feed/fixture.js");
  });

  const preDeal = async () => {
    const { data: season } = await db
      .from("seasons").select("id").eq("league_id", leagueId).single();
    await db.from("periods").update({ phase: "pre-deal" })
      .eq("season_id", season.id).eq("number", 2);
  };

  const players = async () => {
    const { data } = await db.from("players").select("*").eq("league_id", leagueId);
    return data;
  };

  it("plants the three provenance cases the screens exist to show", async () => {
    const rows = await players();
    expect(rows.filter((p) => p.status_source === "manual")).toHaveLength(1);
    expect(rows.filter((p) => p.source === "manual")).toHaveLength(1);
    expect(rows.filter((p) => p.feed_status === "OUT")).toHaveLength(1);

    // League week is not NFL week, but in the demo league they coincide.
    const { data: periods } = await db.from("periods").select("number, nfl_week, type");
    for (const p of periods.filter((x) => x.type === "week")) expect(p.nfl_week).toBe(p.number);
  });

  it("corrects the pool, and reports the same thing twice running", async () => {
    const token = await asCommissioner();
    await preDeal();

    const first = await ops.refreshPlayerPool(db, { leagueId, token, feed });
    expect(first.status).toBe(200);
    const r1 = first.body.report;
    expect(r1.gaps).toEqual([]);
    expect(r1.added.length).toBeGreaterThan(0);   // starters the 2025 pool never had
    expect(r1.retired).toBeGreaterThan(0);        // and players who are not starters now

    /* Idempotent: everything the feed wanted is now in place, so a second press adds
     * nothing and retires nothing. Against the live feed this could only ever be
     * "probably". */
    const second = await ops.refreshPlayerPool(db, { leagueId, token, feed });
    expect(second.status).toBe(200);
    expect(second.body.report.added).toEqual([]);
    expect(second.body.report.retired).toBe(0);
  });

  it("leaves both of the commissioner's decisions alone, and says why", async () => {
    const before = await players();
    const sidelined = before.find((p) => p.status_source === "manual");
    const hisOwn = before.find((p) => p.source === "manual");
    const token = await asCommissioner();
    await preDeal();

    const r = await ops.refreshPlayerPool(db, { leagueId, token, feed });
    const untouched = r.body.report.untouched.map((u) => u.name);
    expect(untouched).toContain(sidelined.name);
    expect(untouched).toContain(hisOwn.name);

    const after = await players();
    const stillOut = after.find((p) => p.id === sidelined.id);
    expect(stillOut.status).toBe("OUT");
    expect(stillOut.status_source).toBe("manual");
    // The feed's opinion is recorded BESIDE his, which is what the disagreement shows.
    expect(stillOut.feed_status).toBe("Active");

    const untouchedRow = after.find((p) => p.id === hisOwn.id);
    expect(untouchedRow.source).toBe("manual");
    expect(untouchedRow.depth_rank).toBe(null);
  });

  it("does not retire a player the feed already retired", async () => {
    const alreadyOut = (await players()).find((p) => p.feed_status === "OUT");
    const token = await asCommissioner();
    await preDeal();

    const r = await ops.refreshPlayerPool(db, { leagueId, token, feed });
    expect(r.body.report.untouched.map((u) => u.name)).not.toContain(alreadyOut.name);

    const after = (await players()).find((p) => p.id === alreadyOut.id);
    expect(after.status).toBe("OUT");
    expect(after.feed_updated_at).toBe(alreadyOut.feed_updated_at); // not rewritten
  });
});

/* ------------------------------------------------------------------------ *
 * The deal refreshes the pool first.
 *
 * Scott, 2026-09-06: "when a deal is dealt, i want the rosters to be live each time."
 * The refresh runs BEFORE the lifecycle rather than inside it, because persistBlob
 * rewrites the whole players table from a blob built before the refresh - so a refresh
 * inside the callback would be silently reverted. That is what the first test here
 * actually guards: not that the refresh was called, but that the deal DEALT FROM IT.
 * ------------------------------------------------------------------------ */
gate()("the deal refreshes the pool first", () => {
  beforeEach(() => resetDemo());

  const preDeal = async () => {
    const { data: season } = await db
      .from("seasons").select("id").eq("league_id", leagueId).single();
    await db.from("periods").update({ phase: "pre-deal" })
      .eq("season_id", season.id).eq("number", 2);
  };

  const dealLogText = (view) =>
    view.activityLog.filter((a) => a.type === "deal").slice(-1)[0].text;

  it("survives the blob write - a player the feed retired is not dealt", async () => {
    const token = await asCommissioner();
    await preDeal();

    const { data: before } = await db
      .from("players").select("*").eq("league_id", leagueId).order("legacy_id");
    /* A feed that claims everything EXCEPT five ordinary players. Those five are the
     * only ones it retires, so the pool stays deep enough to deal a full 12 to every
     * team - and those five must not appear on any roster. Retiring most of the pool
     * would just make the deal fail for want of players, which proves nothing. */
    const droppable = before.filter(
      (pl) => pl.position !== "Coach" && pl.source !== "manual" && pl.status_source !== "manual"
    );
    const dropped = droppable.slice(-5);
    const droppedIds = new Set(dropped.map((pl) => pl.id));
    const claimed = before.filter((pl) => !droppedIds.has(pl.id));
    expect(dropped).toHaveLength(5);
    const feed = {
      fetchDepthChart: async () => ({
        snapshotAt: "2026-09-06T12:00:00Z",
        players: claimed.map((pl, i) => ({
          name: pl.name, position: pl.position, team: pl.nfl_team,
          depthRank: 1, externalIds: { gsis: "deal" + i },
        })),
      }),
      buildPool: ({ depthPlayers }) => ({ players: depthPlayers, gaps: [] }),
    };

    const r = await ops.dealPeriod(db, { leagueId, token, feed });
    expect(r.status).toBe(200);

    const { data: after } = await db.from("players").select("*").eq("league_id", leagueId);
    const byId = new Map(after.map((pl) => [pl.id, pl]));
    for (const pl of dropped) expect(byId.get(pl.id).status).toBe("OUT");

    /* THE ASSERTION THAT MATTERS. If the refresh ran inside the lifecycle, persistBlob
     * would have put these statuses back to Active from a blob built before the refresh,
     * and they would be dealable again - retired, then silently un-retired. */
    const retiredIds = new Set(dropped.map((pl) => pl.legacy_id));
    const dealtIds = [];
    for (const t of r.body.view.teams) {
      if (!t.roster) continue;
      dealtIds.push(...Object.values(t.roster.starters).filter(Boolean));
      dealtIds.push(...t.roster.bench.filter(Boolean));
    }
    expect(dealtIds.length).toBeGreaterThan(0);
    expect(dealtIds.filter((id) => retiredIds.has(id))).toEqual([]);
  });

  it("says what the refresh did, so the pool never changes invisibly", async () => {
    const token = await asCommissioner();
    await preDeal();
    const feed = await import("../server/feed/fixture.js");

    const r = await ops.dealPeriod(db, { leagueId, token, feed });
    expect(r.status).toBe(200);
    expect(dealLogText(r.body.view)).toMatch(/Pool refreshed first/);
  });

  it("deals anyway when the feed is down, and says so", async () => {
    const token = await asCommissioner();
    await preDeal();
    const feed = {
      fetchDepthChart: async () => { throw new Error("nflverse is having a bad morning"); },
      buildPool: () => ({ players: [], gaps: [] }),
    };

    const r = await ops.dealPeriod(db, { leagueId, token, feed });
    /* The week starts. A feed outage must never be able to stop it - that is the whole
     * reason the refresh is allowed to fail on its own. */
    expect(r.status).toBe(200);
    expect(r.body.view.currentPeriod.phase).toBe("dealt");
    expect(r.body.view.teams.every((t) => t.roster !== null)).toBe(true);
    expect(dealLogText(r.body.view)).toMatch(/Pool NOT refreshed/);
    expect(dealLogText(r.body.view)).toMatch(/bad morning/);
  });

  it("refuses the deal outright if the refresh fails for any other reason", async () => {
    await preDeal();
    /* A manager, not the commissioner. The refresh refuses first and the deal is not
     * attempted - one error rather than two, and no half-refreshed pool dealt from. */
    const token = await asManager(T1);
    const r = await ops.dealPeriod(db, { leagueId, token, feed: await import("../server/feed/fixture.js") });
    expect(r.status).toBe(403);

    const { data: periods } = await db.from("periods").select("phase, number, type");
    expect(periods.find((x) => x.number === 2 && x.type === "week").phase).toBe("pre-deal");
  });

  /* OQ-25, Scott 2026-09-08: nobody whose NFL team has no game is dealt.
   *
   * THIS IS THE TEST FOR THE ORDERING, not for the rule - the rule itself is unit-tested in
   * tests/availability.test.js. The week's kickoffs used to be read in `afterPersist`, AFTER
   * the deal, which was harmless while they were only for the lineup lock. Left there, the
   * deal would have filtered against LAST week's schedule and this rule would silently never
   * have fired on the first deal of a new week - which is every deal. Nothing in the engine
   * could catch that; only this can. */
  it("does not deal a player whose NFL team is on a bye", async () => {
    const token = await asCommissioner();
    await preDeal();
    const feed = await import("../server/feed/fixture.js");

    /* NFL week 11 is the fixture's thinnest: 13 games, so six teams are sitting out. The
     * demo league's own week 2 is a full 16-game week and would prove nothing. */
    const { data: season } = await db
      .from("seasons").select("id, year").eq("league_id", leagueId).single();
    await db.from("periods").update({ nfl_week: 11 })
      .eq("season_id", season.id).eq("number", 2);

    const { kickoffs } = await feed.fetchKickoffs({ season: season.year, week: 11 });
    const playing = new Set(Object.keys(kickoffs));
    expect(playing.size).toBe(26);

    const r = await ops.dealPeriod(db, { leagueId, token, feed });
    expect(r.status).toBe(200);

    const byId = new Map(r.body.view.playerPool.map((p) => [p.id, p]));
    const dealt = [];
    for (const t of r.body.view.teams) {
      if (!t.roster) continue;
      dealt.push(...Object.values(t.roster.starters).filter(Boolean));
      dealt.push(...t.roster.bench.filter(Boolean));
    }
    expect(dealt.length).toBe(r.body.view.teams.length * 12);

    const satOut = dealt.map((id) => byId.get(id)).filter((p) => p && !playing.has(p.team));
    expect(satOut.map((p) => p.name + " (" + p.team + ")")).toEqual([]);

    /* And the times the deal filtered against are the ones it stored - one reading, not two,
     * so a roster and the lock that freezes it cannot disagree about a flexed game. */
    const { data: period } = await db
      .from("periods").select("kickoffs").eq("season_id", season.id).eq("number", 2).single();
    expect(Object.keys(period.kickoffs)).toHaveLength(26);
  });
});

/* ------------------------------------------------------------------------ *
 * Stage 3: which NFL week a league period plays.
 *
 * League week is not NFL week, and until now nothing in the app wrote the mapping -
 * only the demo seed did, which is why a stats pull had no week to ask the feed for.
 * The rule itself is unit-tested in tests/schedule.test.js; what is asserted here is
 * that the column is actually written, and - the part worth having - that the ordinary
 * blob path does not wipe it.
 * ------------------------------------------------------------------------ */
gate()("the NFL week mapping", () => {
  beforeEach(() => resetDemo());

  const periods = async () => {
    const { data } = await db
      .from("periods").select("id, type, number, nfl_week").order("number");
    return data;
  };
  const current = async () => (await periods()).find((p) => p.number === 2 && p.type === "week");

  it("gives a period created by finalize its NFL week", async () => {
    /* Week 3 does not exist until finalize creates it, and decompose does not carry
     * the column on purpose (server/schedule.js). Without the afterPersist hook the row
     * would be born null and stay null forever. */
    const token = await asCommissioner();
    const fin = await ops.finalizePeriod(db, { leagueId, token });
    expect(fin.status).toBe(200);

    const week3 = (await periods()).find((p) => p.number === 3 && p.type === "week");
    expect(week3.nfl_week).toBe(3);
    expect(fin.body.view._meta.nflWeek).toBe(3);
  });

  it("carries a correction forward into every week after it", async () => {
    /* The reason the default counts from the existing mapping rather than from the
     * league's week number: correct it once and the rest of the season follows. */
    const token = await asCommissioner();
    const set = await ops.setNflWeek(db, { leagueId, token, nflWeek: 7 });
    expect(set.status).toBe(200);
    expect(set.body.view._meta.nflWeek).toBe(7);

    await ops.finalizePeriod(db, { leagueId, token });
    const week3 = (await periods()).find((p) => p.number === 3 && p.type === "week");
    expect(week3.nfl_week).toBe(8);
  });

  it("SURVIVES AN ORDINARY BLOB WRITE", async () => {
    /* THE REGRESSION THIS BLOCK EXISTS FOR.
     *
     * Every lifecycle step rewrites the period row through decompose, and `external_ids`
     * was silently cleared for weeks by exactly that path (docs/PHASE-4-HANDOFF.md).
     * nfl_week is kept out of decompose so the column is never in the upsert's SET list
     * - but "never" is a claim, and this is what checks it against a real PostgREST
     * rather than against a reading of the code. */
    const token = await asCommissioner();
    const before = (await current()).nfl_week;
    expect(before).toBe(2);

    await ops.finalizePeriod(db, { leagueId, token });   // rewrites week 2 as historical
    await ops.dealPeriod(db, { leagueId, token, refresh: false }); // rewrites the new week
    await ops.processSchemes(db, { leagueId, token });   // and again

    expect((await current()).nfl_week).toBe(before);
    const week3 = (await periods()).find((p) => p.number === 3 && p.type === "week");
    expect(week3.nfl_week).toBe(3);
  });

  it("lets the commissioner unmap a week, and nobody else touch it at all", async () => {
    const token = await asCommissioner();
    const cleared = await ops.setNflWeek(db, { leagueId, token, nflWeek: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.view._meta.nflWeek).toBe(null);
    expect((await current()).nfl_week).toBe(null);

    const mgr = await asManager(T1);
    const refused = await ops.setNflWeek(db, { leagueId, token: mgr, nflWeek: 4 });
    expect(refused.status).toBe(403);
    expect((await current()).nfl_week).toBe(null);
  });

  it("refuses a week the column would refuse, with a message a person can act on", async () => {
    /* Better here than as a check-constraint violation from Postgres, which arrives as
     * unreadable SQL on the commissioner's screen. */
    const token = await asCommissioner();
    for (const bad of [0, 24, 2.5, "soon"]) {
      const r = await ops.setNflWeek(db, { leagueId, token, nflWeek: bad });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/1 to 23/);
    }
    expect((await current()).nfl_week).toBe(2);
  });

  it("maps a brand new league's first week at creation", async () => {
    const { token: jwt } = await makeAccount("kickoff@example.test");
    const r = await ops.createLeague(db, { accountToken: jwt, name: "Kickoff League", year: 2033 });
    expect(r.status).toBe(200);

    const { data: season } = await db
      .from("seasons").select("id").eq("league_id", r.body.leagueId).single();
    const { data: made } = await db
      .from("periods").select("number, nfl_week").eq("season_id", season.id);
    // Opening weekend is the only thing a blank league can assume, and it is correctable.
    expect(made).toHaveLength(1);
    expect(made[0]).toEqual({ number: 1, nfl_week: 1 });

    await db.from("leagues").delete().eq("name", "Kickoff League");
  });
});

/* The lineup lock, against real Postgres.
 *
 * The rule itself is unit-tested without a database (tests/lineupLock.test.js). What
 * can only be checked here is that the SERVER refuses the write - the browser greys the
 * row out, but a client that ignores the UI is exactly what a lock is for - and that
 * the two policies are per-league rather than global.
 *
 * The kickoff times are written straight onto the period rather than fetched, so these
 * assertions do not depend on what day the suite is run. The fetching half is covered
 * by the fixture cases at the end.
 */
gate()("the lineup lock", () => {
  beforeEach(() => resetDemo());

  const HOUR = 3600 * 1000;
  const past = () => new Date(Date.now() - HOUR).toISOString();
  const future = () => new Date(Date.now() + HOUR).toISOString();

  const currentPeriod = async () => {
    const { data } = await db
      .from("periods").select("*").eq("type", "week").eq("number", 2).maybeSingle();
    return data;
  };

  /* The demo's current week sits in 'stats', where no lineup may be changed at all.
   * Wind it back to the phase a manager actually swaps in, so what is being tested is
   * the lock rather than the phase guard. */
  const openForSwaps = async (periodId) =>
    db.from("periods").update({ phase: "schemes-processed" }).eq("id", periodId);

  const setKickoffs = async (periodId, kickoffs) =>
    db.from("periods").update({ kickoffs }).eq("id", periodId);

  const setMode = async (mode) => {
    const { data: season } = await db.from("seasons").select("id").eq("league_id", leagueId).single();
    await db.from("seasons").update({ lineup_lock: mode }).eq("id", season.id);
  };

  /** One team's slots for this period, with the NFL team each player belongs to. */
  const rosterOf = async (periodId, teamLegacy) => {
    const { data: team } = await db
      .from("teams").select("id").eq("league_id", leagueId).eq("legacy_id", teamLegacy).single();
    const { data: slots } = await db
      .from("roster_slots").select("*").eq("period_id", periodId).eq("team_id", team.id);
    const { data: players } = await db.from("players").select("id, name, nfl_team").eq("league_id", leagueId);
    const byId = new Map(players.map((p) => [p.id, p]));
    return slots.map((r) => ({ ...r, player: byId.get(r.player_id) ?? null }));
  };

  it("defaults every league to gametime, and lets the commissioner choose weekly", async () => {
    const token = await asCommissioner();
    const { data: before } = await db.from("seasons").select("lineup_lock").eq("league_id", leagueId).single();
    expect(before.lineup_lock).toBe("gametime");

    const r = await ops.setLineupLock(db, { leagueId, token, mode: "weekly" });
    expect(r.status).toBe(200);
    expect(r.body.view._meta.lineupLock).toBe("weekly");

    const { data: after } = await db.from("seasons").select("lineup_lock").eq("league_id", leagueId).single();
    expect(after.lineup_lock).toBe("weekly");
  });

  it("is the commissioner's to set, and only his", async () => {
    const mgr = await asManager(T1);
    const refused = await ops.setLineupLock(db, { leagueId, token: mgr, mode: "weekly" });
    expect(refused.status).toBe(403);

    const token = await asCommissioner();
    const nonsense = await ops.setLineupLock(db, { leagueId, token, mode: "whenever" });
    expect(nonsense.status).toBe(400);

    const { data } = await db.from("seasons").select("lineup_lock").eq("league_id", leagueId).single();
    expect(data.lineup_lock).toBe("gametime");
  });

  it("gametime: refuses a starter whose game has kicked off", async () => {
    const period = await currentPeriod();
    await openForSwaps(period.id);
    const roster = await rosterOf(period.id, T1);
    const qb = roster.find((r) => r.slot === "QB");
    await setKickoffs(period.id, { [qb.player.nfl_team]: past() });

    const token = await asManager(T1);
    const r = await ops.swapLineupSlot(db, { leagueId, token, teamId: T1, slot: "QB", benchIndex: 0 });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("locked");
    expect(r.body.error).toMatch(/game has started/i);

    // Refused means unchanged, not half-applied.
    const after = await rosterOf(period.id, T1);
    expect(after.find((x) => x.slot === "QB").player_id).toBe(qb.player_id);
  });

  it("gametime: still allows a swap between two players who have not played", async () => {
    const period = await currentPeriod();
    await openForSwaps(period.id);
    const roster = await rosterOf(period.id, T1);
    const qb = roster.find((r) => r.slot === "QB");
    /* Lock only the quarterback's team, then find a starter and a bench player who are
     * on neither that team nor each other's - the late-window swap the whole policy
     * exists to allow. */
    const kicked = qb.player.nfl_team;
    const openStarter = roster.find((r) => r.area === "starter" && r.player && r.player.nfl_team !== kicked);
    const openBench = roster.find((r) => r.area === "bench" && r.player && r.player.nfl_team !== kicked);
    expect(openStarter && openBench).toBeTruthy();
    await setKickoffs(period.id, { [kicked]: past() });

    const token = await asManager(T1);
    const r = await ops.swapLineupSlot(db, {
      leagueId, token, teamId: T1, slot: openStarter.slot, benchIndex: openBench.bench_index,
    });
    expect(r.status).toBe(200);

    const after = await rosterOf(period.id, T1);
    expect(after.find((x) => x.slot === openStarter.slot).player_id).toBe(openBench.player_id);
  });

  it("gametime: refuses the BENCH half too - a finished player cannot be promoted", async () => {
    const period = await currentPeriod();
    await openForSwaps(period.id);
    const roster = await rosterOf(period.id, T1);
    const starter = roster.find((r) => r.slot === "TE");
    const bench = roster.find(
      (r) => r.area === "bench" && r.player && r.player.nfl_team !== starter.player.nfl_team
    );
    await setKickoffs(period.id, { [bench.player.nfl_team]: past() });

    const token = await asManager(T1);
    const r = await ops.swapLineupSlot(db, {
      leagueId, token, teamId: T1, slot: "TE", benchIndex: bench.bench_index,
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain(bench.player.name);
  });

  it("weekly: one kickoff closes every lineup, whoever is playing when", async () => {
    const period = await currentPeriod();
    await openForSwaps(period.id);
    await setMode("weekly");
    const roster = await rosterOf(period.id, T1);
    const starter = roster.find((r) => r.area === "starter" && r.player);
    const bench = roster.find((r) => r.area === "bench" && r.player);
    /* One team's game has started; nobody else's has. Under gametime this swap would be
     * allowed - that is the difference between the two leagues. */
    await setKickoffs(period.id, { "Kansas City Chiefs": past(), "Green Bay Packers": future() });

    const token = await asManager(T1);
    const r = await ops.swapLineupSlot(db, {
      leagueId, token, teamId: T1, slot: starter.slot, benchIndex: bench.bench_index,
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/first kickoff/i);
  });

  it("weekly: leaves the week open right up to that kickoff", async () => {
    const period = await currentPeriod();
    await openForSwaps(period.id);
    await setMode("weekly");
    const roster = await rosterOf(period.id, T1);
    const starter = roster.find((r) => r.area === "starter" && r.player);
    const bench = roster.find((r) => r.area === "bench" && r.player);
    await setKickoffs(period.id, { "Kansas City Chiefs": future() });

    const token = await asManager(T1);
    const r = await ops.swapLineupSlot(db, {
      leagueId, token, teamId: T1, slot: starter.slot, benchIndex: bench.bench_index,
    });
    expect(r.status).toBe(200);
  });

  it("a week with no kickoff times locks nobody on the clock", async () => {
    const period = await currentPeriod();
    await openForSwaps(period.id);
    await setMode("weekly");
    await setKickoffs(period.id, null);
    const roster = await rosterOf(period.id, T1);
    const starter = roster.find((r) => r.area === "starter" && r.player);
    const bench = roster.find((r) => r.area === "bench" && r.player);

    const token = await asManager(T1);
    const r = await ops.swapLineupSlot(db, {
      leagueId, token, teamId: T1, slot: starter.slot, benchIndex: bench.bench_index,
    });
    expect(r.status).toBe(200);
  });

  it("the commissioner's manual lock still holds, whatever the schedule says", async () => {
    const period = await currentPeriod();
    await openForSwaps(period.id);
    await setKickoffs(period.id, {});
    const roster = await rosterOf(period.id, T1);
    const starter = roster.find((r) => r.slot === "WR");
    await db.from("roster_slots").update({ locked: true }).eq("id", starter.id);

    const token = await asManager(T1);
    const r = await ops.swapLineupSlot(db, { leagueId, token, teamId: T1, slot: "WR", benchIndex: 0 });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("locked");
  });

  it("reads the week's kickoff times when it deals, and hands them to the browser", async () => {
    const feed = await import("../server/feed/fixture.js");
    const token = await asCommissioner();
    await ops.finalizePeriod(db, { leagueId, token });          // week 3, mapped to NFL week 3
    const dealt = await ops.dealPeriod(db, { leagueId, token, feed });
    expect(dealt.status).toBe(200);

    const { data: week3 } = await db
      .from("periods").select("kickoffs, kickoffs_read_at").eq("type", "week").eq("number", 3).single();
    expect(Object.keys(week3.kickoffs)).toHaveLength(32);
    expect(week3.kickoffs_read_at).toBeTruthy();
    // The browser decides what to grey out from these, so they have to travel.
    expect(Object.keys(dealt.body.view._meta.kickoffs)).toHaveLength(32);
  });

  it("re-reads them on demand, because flex scheduling moves games", async () => {
    const feed = await import("../server/feed/fixture.js");
    const token = await asCommissioner();
    const r = await ops.refreshKickoffs(db, { leagueId, token, feed });
    expect(r.status).toBe(200);
    expect(r.body.report.teams).toBe(32);
    expect(r.body.report.nflWeek).toBe(2);

    const mgr = await asManager(T1);
    expect((await ops.refreshKickoffs(db, { leagueId, token: mgr, feed })).status).toBe(403);
  });

  it("refuses to read them for a week nobody has mapped, and changes nothing", async () => {
    const feed = await import("../server/feed/fixture.js");
    const token = await asCommissioner();
    await ops.setNflWeek(db, { leagueId, token, nflWeek: null, feed });

    const r = await ops.refreshKickoffs(db, { leagueId, token, feed });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("kickoffs");

    const period = await currentPeriod();
    expect(period.kickoffs).toBe(null);
  });

  it("brings this week's times with a corrected NFL week", async () => {
    /* The mapping is what says WHICH week's kickoffs apply, so a correction that left
     * the old times behind would lock the league on the wrong Thursday. */
    const feed = await import("../server/feed/fixture.js");
    const token = await asCommissioner();
    await ops.refreshKickoffs(db, { leagueId, token, feed });
    const before = (await currentPeriod()).kickoffs;

    const set = await ops.setNflWeek(db, { leagueId, token, nflWeek: 5, feed });
    expect(set.status).toBe(200);
    const after = (await currentPeriod()).kickoffs;
    /* Week 5 has byes in it, so this is deliberately not "32" - a team that is not
     * playing has no kickoff, and its players stay changeable all week. */
    expect(Object.keys(after).length).toBeGreaterThan(24);
    expect(after).not.toEqual(before);
  });

  it("SURVIVES AN ORDINARY BLOB WRITE, like nfl_week before it", async () => {
    /* Same regression, same reasoning: `kickoffs` is written by direct update and left
     * out of decompose, so a lifecycle step that rewrites the period row must not clear
     * it. Asserted against a real PostgREST rather than against a reading of the code. */
    const feed = await import("../server/feed/fixture.js");
    const token = await asCommissioner();
    await ops.refreshKickoffs(db, { leagueId, token, feed });
    const before = (await currentPeriod()).kickoffs;
    expect(Object.keys(before)).toHaveLength(32);

    await ops.setStatLine(db, { leagueId, token, teamId: T1, slot: "QB", line: { yards: "10", tds: "1" } });
    await ops.toggleRosterLock(db, { leagueId, token });
    await ops.toggleRosterLock(db, { leagueId, token });

    expect((await currentPeriod()).kickoffs).toEqual(before);
  });
});

/* The stats pull, against real Postgres.
 *
 * The planner is covered without a database in tests/stats.test.js. What can only be
 * checked here is what actually reaches the table: that a manual line survives a pull
 * through a real PostgREST upsert, that the feed mirrors land in the columns the split
 * migration added for them, and that each refusal leaves the week untouched rather than
 * half-written. "The planner returns the right rows" is a claim about code; "the
 * commissioner's 84 is still 84 afterwards" is a claim about the database.
 */
gate()("the stats pull", () => {
  beforeEach(() => resetDemo());

  const current = async () => {
    const { data: season } = await db
      .from("seasons").select("id").eq("league_id", leagueId).single();
    const { data } = await db
      .from("periods").select("*").eq("season_id", season.id).eq("number", 2).single();
    return data;
  };

  const startersOf = async (periodId) => {
    const { data } = await db
      .from("roster_slots").select("*, players(*)")
      .eq("period_id", periodId).eq("area", "starter");
    return data;
  };

  /* A feed built from the league's OWN starters, so every slot matches and the rules
   * are what is being tested rather than the matching. */
  const feedOf = (starters, over = {}) => ({
    fetchWeeklyStats: async () => ({
      lines: starters
        .filter((s) => s.players && s.players.position !== "Coach")
        .map((s) => ({
          gsis: s.players.external_ids?.gsis,
          name: s.players.name,
          passYards: 0, passTds: 0, rushYards: 0, rushTds: 0,
          recYards: 91, recTds: 1,
        }))
        .filter((l) => l.gsis),
      stoppedEarly: true,
    }),
    fetchGameResults: async () => ({
      results: new Map(
        starters
          .filter((s) => s.players && s.players.position === "Coach")
          .map((s) => [s.players.nfl_team, "Win"])
      ),
    }),
    ...over,
  });

  /* Two things about the demo league shape these, and neither is worth asserting by
   * accident: the pool is the artifact's hand-typed one, so only the names the recorded
   * feed also knows carry a gsis; and week 2 already has stat lines typed for about half
   * its slots, every one of them source 'manual'. So a test picks the CASE it is about -
   * an empty slot to fill, or a typed one to leave alone - rather than a slot name. */
  const withGsis = (starters) =>
    starters.filter((s) => s.players && s.players.position !== "Coach" && s.players.external_ids?.gsis);

  const pick = async (periodId, starters, { typed }) => {
    const existing = await lines(periodId);
    const has = (s) => existing.some((l) => l.team_id === s.team_id && l.slot === s.slot);
    const found = withGsis(starters).find((s) => (typed ? has(s) : !has(s)));
    if (!found) throw new Error("no " + (typed ? "typed" : "empty") + " slot in the demo league");
    return found;
  };

  const lines = async (periodId) => {
    const { data } = await db.from("stat_lines").select("*").eq("period_id", periodId);
    return data;
  };

  it("fills the boxes in and records the feed's numbers beside them", async () => {
    const token = await asCommissioner();
    const period = await current();
    const starters = await startersOf(period.id);
    const scorer = await pick(period.id, starters, { typed: false });
    const existingBefore = await lines(period.id);

    const r = await ops.pullStats(db, { leagueId, token, feed: feedOf(starters) });
    expect(r.status).toBe(200);
    expect(r.body.report.nflWeek).toBe(2);
    expect(r.body.report.filled.length).toBeGreaterThan(0);

    const written = await lines(period.id);
    const line = written.find((s) => s.team_id === scorer.team_id && s.slot === scorer.slot);
    expect(line.rec_yards).toBe(91);
    expect(line.feed_rec_yards).toBe(91); // the mirror the split migration added for this
    expect(line.source).toBe("feed");
    expect(line.feed_provider).toBe("nflverse");

    /* The Coach slot has no player id to match on at all - it resolves by team - so it
     * is worth asserting separately from the skill players. An untyped one, for the same
     * reason as above: the seed has already typed some. */
    const before = existingBefore.filter((l) => l.slot === "Coach").map((l) => l.team_id);
    const coachSlot = starters.find((s) => s.slot === "Coach" && !before.includes(s.team_id));
    const coach = written.find((s) => s.team_id === coachSlot.team_id && s.slot === "Coach");
    expect(coach.coach_result).toBe("Win");
    expect(coach.feed_coach_result).toBe("Win");
  });

  /* THE ONE THAT MATTERS, and the reason this suite exists at all: an upsert writes
   * whole rows, so "the planner preserved his numbers" is only half the claim - the
   * other half is that the round trip did not quietly replace them. */
  it("LEAVES A COMMISSIONER'S OWN NUMBERS EXACTLY AS HE TYPED THEM", async () => {
    const token = await asCommissioner();
    const period = await current();
    const starters = await startersOf(period.id);
    const his = await pick(period.id, starters, { typed: true });
    const { data: team } = await db
      .from("teams").select("legacy_id").eq("id", his.team_id).single();

    const typed = await ops.setStatLine(db, {
      leagueId, token, teamId: team.legacy_id, slot: his.slot,
      line: { recYards: 84, recTds: 1 },
    });
    expect(typed.status).toBe(200);

    const r = await ops.pullStats(db, { leagueId, token, feed: feedOf(starters) });
    expect(r.status).toBe(200);

    const written = (await lines(period.id)).find(
      (s) => s.team_id === his.team_id && s.slot === his.slot
    );
    expect(written.rec_yards).toBe(84); // his
    expect(written.feed_rec_yards).toBe(91); // the feed's, beside it
    expect(written.source).toBe("manual");

    const kept = r.body.report.kept.find((k) => k.slot === his.slot);
    expect(kept.differences).toContainEqual({
      field: "recYards", label: "Rec Yds", yours: 84, feed: 91,
    });
  });

  it("refuses when the period is not mapped to an NFL week, and changes nothing", async () => {
    const token = await asCommissioner();
    const period = await current();
    await db.from("periods").update({ nfl_week: null }).eq("id", period.id);
    const before = await lines(period.id);

    const r = await ops.pullStats(db, { leagueId, token, feed: feedOf(await startersOf(period.id)) });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("unmapped");
    expect(await lines(period.id)).toEqual(before);
  });

  /* Same rule setStatLine enforces (OQ-E): stats are keyed by slot, so a lineup change
   * after a pull would move these numbers to a different player silently. */
  it("refuses while the rosters are unlocked, and changes nothing", async () => {
    const token = await asCommissioner();
    const period = await current();
    await db.from("periods").update({ roster_locked: false }).eq("id", period.id);
    const before = await lines(period.id);

    const r = await ops.pullStats(db, { leagueId, token, feed: feedOf(await startersOf(period.id)) });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("unlocked");
    expect(await lines(period.id)).toEqual(before);
  });

  it("says so when the feed has nothing for the week, rather than reporting success", async () => {
    const token = await asCommissioner();
    const r = await ops.pullStats(db, {
      leagueId, token,
      feed: {
        fetchWeeklyStats: async () => ({ lines: [], stoppedEarly: false }),
        fetchGameResults: async () => ({ results: new Map() }),
      },
    });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("feed-empty");
    expect(r.body.error).toMatch(/week 2/);
  });

  it("leaves the week alone when the feed is down", async () => {
    const token = await asCommissioner();
    const period = await current();
    const before = await lines(period.id);
    const r = await ops.pullStats(db, {
      leagueId, token,
      feed: {
        fetchWeeklyStats: async () => { throw new Error("HTTP 503"); },
        fetchGameResults: async () => ({ results: new Map() }),
      },
    });
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/unchanged/);
    expect(await lines(period.id)).toEqual(before);
  });

  it("is commissioner-only", async () => {
    const token = await asManager(T1);
    const r = await ops.pullStats(db, { leagueId, token, feed: feedOf([]) });
    expect(r.status).toBe(403);
  });

  /* End to end on the recording, which is the whole point of having one: the demo
   * league sits in week 2 and the fixture now carries it. */
  it("works against the recorded fixture, start to finish", async () => {
    const token = await asCommissioner();
    const fixture = await import("../server/feed/fixture.js");

    const r = await ops.pullStats(db, { leagueId, token, feed: fixture });
    expect(r.status).toBe(200);
    expect(r.body.report.filled.length + r.body.report.missing.length).toBeGreaterThan(0);
    expect(r.body.report.nflWeek).toBe(2);
  });

  /* ------------------------ stage 7: the scheduled pull ------------------------
   *
   * The unit half of this - which leagues are eligible and why not - is in
   * tests/autoPull.test.js and runs anywhere. What needs a real PostgREST is the part
   * that cannot be reasoned about: that the scheduler writes THE SAME LINES the button
   * writes, and that the opt-in genuinely gates it.
   */

  const setAutoPull = async (enabled) =>
    db.from("leagues").update({ auto_pull_stats: enabled }).eq("id", leagueId);

  it("does nothing at all to a league that has not opted in", async () => {
    await setAutoPull(false);
    const period = await current();
    const before = await lines(period.id);

    const r = await ops.scheduledStatsPull(db, { feed: feedOf(await startersOf(period.id)) });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.pulled).toBe(0);
    expect(await lines(period.id)).toEqual(before);
  });

  it("writes the same lines the button writes, once opted in", async () => {
    await setAutoPull(true);
    const period = await current();
    const starters = await startersOf(period.id);
    const scorer = await pick(period.id, starters, { typed: false });

    const r = await ops.scheduledStatsPull(db, { feed: feedOf(starters) });
    expect(r.status).toBe(200);
    expect(r.body.pulled).toBe(1);

    const written = await lines(period.id);
    const line = written.find((s) => s.team_id === scorer.team_id && s.slot === scorer.slot);
    expect(line.rec_yards).toBe(91);
    expect(line.source).toBe("feed");
    await setAutoPull(false);
  });

  /* The guard that matters most, and the reason the scheduler is not simply a cron on
   * the button: numbers arriving while a lineup can still move land on whoever occupies
   * the slot afterwards. A SKIP, not a failure - an unlocked week on a Thursday is the
   * ordinary state of the world. */
  it("skips an unlocked week rather than failing the run", async () => {
    await setAutoPull(true);
    const period = await current();
    await db.from("periods").update({ roster_locked: false }).eq("id", period.id);
    const before = await lines(period.id);

    const r = await ops.scheduledStatsPull(db, { feed: feedOf(await startersOf(period.id)) });
    expect(r.body.ok).toBe(true);
    expect(r.body.pulled).toBe(0);
    expect(r.body.skipped).toBe(1);
    expect(r.body.leagues[0].why).toContain("not locked");
    expect(await lines(period.id)).toEqual(before);

    await db.from("periods").update({ roster_locked: true }).eq("id", period.id);
    await setAutoPull(false);
  });

  it("never overwrites a line the commissioner typed", async () => {
    await setAutoPull(true);
    const period = await current();
    const starters = await startersOf(period.id);
    const typed = await pick(period.id, starters, { typed: true });
    const was = (await lines(period.id)).find(
      (l) => l.team_id === typed.team_id && l.slot === typed.slot
    );

    await ops.scheduledStatsPull(db, { feed: feedOf(starters) });

    const now = (await lines(period.id)).find(
      (l) => l.team_id === typed.team_id && l.slot === typed.slot
    );
    expect(now.source).toBe("manual");
    expect(now.rec_yards).toBe(was.rec_yards);
    expect(now.feed_rec_yards).toBe(91); // the mirror still records what the feed said
    await setAutoPull(false);
  });

  it("setAutoPullStats is commissioner-only", async () => {
    const manager = await asManager(T1);
    expect((await ops.setAutoPullStats(db, { leagueId, token: manager, enabled: true })).status).toBe(403);

    const token = await asCommissioner();
    const r = await ops.setAutoPullStats(db, { leagueId, token, enabled: true });
    expect(r.status).toBe(200);
    expect(r.body.view._meta.autoPullStats).toBe(true);

    const off = await ops.setAutoPullStats(db, { leagueId, token, enabled: false });
    expect(off.body.view._meta.autoPullStats).toBe(false);
  });

  /* The same family as the `nfl_week` and `external_ids` regressions above: a
   * server-owned column must survive an ordinary blob write, or a deal would quietly
   * turn the setting off. */
  it("SURVIVES AN ORDINARY BLOB WRITE", async () => {
    const token = await asCommissioner();
    await ops.setAutoPullStats(db, { leagueId, token, enabled: true });

    await ops.toggleRosterLock(db, { leagueId, token });
    await ops.toggleRosterLock(db, { leagueId, token });

    const { data } = await db.from("leagues").select("auto_pull_stats").eq("id", leagueId).single();
    expect(data.auto_pull_stats).toBe(true);
    await setAutoPull(false);
  });
});

/* ======================================================================== */
/*  SITE ADMIN - the head-coach list (issue #40)                            */
/* ======================================================================== */
/*
 * The first authorization in this app that is not a `league_members` row, and the first
 * write that deliberately crosses a league boundary. Both need proving here rather than
 * in a unit test: the rule is enforced by a table and a query, not by a pure function.
 *
 * The safety argument for crossing the boundary is that a coach's NAME cannot move a
 * point - see server/coaches.js and tests/coaches.test.js. The last test in this block
 * is that claim checked against a real database rather than asserted.
 */
gate()("site admin: head coaches", () => {
  const ADMIN = "site-admin@example.test";
  const templateBefore = new Map();

  const asAdmin = async () => {
    const acct = await accountFor(ADMIN);
    await db.from("site_admins").upsert({ email: ADMIN, note: "test" }, { onConflict: "email" });
    return acct.token;
  };

  beforeEach(async () => {
    await resetDemo();
    if (!templateBefore.size) {
      const { data } = await db.from("player_pool").select("legacy_id, name").eq("position", "Coach");
      for (const r of data ?? []) templateBefore.set(r.legacy_id, r.name);
    }
  });

  /* `player_pool` is GLOBAL - resetDemo rebuilds the demo league and does not touch it -
   * so a test that renames a coach would otherwise leave the template changed for every
   * later run. Put back exactly what was there. */
  afterAll(async () => {
    for (const [legacy_id, name] of templateBefore) {
      await db.from("player_pool").update({ name }).eq("legacy_id", legacy_id);
    }
    await db.from("site_admins").delete().eq("email", ADMIN);
    /* And rebuild the demo league, because the LAST test in this block leaves a coach
     * renamed in it - beforeEach cleans up for the next test but not for the developer
     * who runs the suite and then opens the app. */
    if (available) await resetDemo().catch(() => {});
  });

  const coachRow = async (team) => {
    const { data } = await db
      .from("players").select("id, name, retired")
      .eq("league_id", leagueId).eq("position", "Coach").eq("nfl_team", team).eq("active", true);
    return (data ?? []).filter((r) => !r.retired)[0] ?? null;
  };
  const teamOfSomeCoach = async () => {
    const { data } = await db
      .from("players").select("nfl_team").eq("league_id", leagueId).eq("position", "Coach").limit(1);
    return data[0].nfl_team;
  };

  it("tells an ordinary account it is not an admin, and never lists the admins", async () => {
    const acct = await accountFor("nobody-special@example.test");
    const r = await ops.adminWhoami(db, { accountToken: acct.token });
    expect(r.status).toBe(200);
    expect(r.body.admin).toBe(false);
    // The answer is about the caller. Nothing here names anybody else.
    expect(JSON.stringify(r.body)).not.toContain("@pigskin");
  });

  it("refuses a signed-out caller", async () => {
    expect((await ops.adminWhoami(db, { accountToken: null })).status).toBe(401);
    expect((await ops.listCoaches(db, { accountToken: null })).status).toBe(403);
  });

  it("A COMMISSIONER IS NOT AN ADMIN", async () => {
    /* The whole point of the new role. Running a league is not the same as owning the
     * list every league is built from. */
    const acct = await accountFor("commissioner@example.test");
    await db.from("league_members").upsert(
      { league_id: leagueId, user_id: acct.userId, role: "commissioner", team_id: null },
      { onConflict: "league_id,user_id" }
    );
    expect((await ops.adminWhoami(db, { accountToken: acct.token })).body.admin).toBe(false);
    expect((await ops.listCoaches(db, { accountToken: acct.token })).status).toBe(403);
    expect((await ops.setCoach(db, { accountToken: acct.token, team: "Chicago Bears", name: "X" })).status).toBe(403);
    expect((await ops.syncCoaches(db, { accountToken: acct.token })).status).toBe(403);
  });

  it("lists all 32 teams for an admin", async () => {
    const token = await asAdmin();
    expect((await ops.adminWhoami(db, { accountToken: token })).body.admin).toBe(true);
    const r = await ops.listCoaches(db, { accountToken: token });
    expect(r.status).toBe(200);
    expect(r.body.coaches).toHaveLength(32);
    expect(r.body.leagueCount).toBeGreaterThanOrEqual(1);
  });

  it("renames the template AND the league in one call", async () => {
    const token = await asAdmin();
    const team = await teamOfSomeCoach();
    const before = await coachRow(team);

    const r = await ops.setCoach(db, { accountToken: token, team, name: "Norman Testington" });
    expect(r.status).toBe(200);
    expect(r.body.report.templateChanged).toBe(true);
    expect(r.body.report.leaguesUpdated).toBe(1);

    const { data: tpl } = await db
      .from("player_pool").select("name").eq("position", "Coach").eq("nfl_team", team).single();
    expect(tpl.name).toBe("Norman Testington");
    expect((await coachRow(team)).name).toBe("Norman Testington");
    expect((await coachRow(team)).id).toBe(before.id); // renamed, never replaced
  });

  it("refuses a name that is blank and a team that is not in the NFL", async () => {
    const token = await asAdmin();
    expect((await ops.setCoach(db, { accountToken: token, team: "Chicago Bears", name: "   " })).status).toBe(400);
    expect((await ops.setCoach(db, { accountToken: token, team: "London Jaguars", name: "Y" })).status).toBe(400);
  });

  it("pushes the whole list into a league a commissioner had edited", async () => {
    const token = await asAdmin();
    const team = await teamOfSomeCoach();
    const { data: tpl } = await db
      .from("player_pool").select("name").eq("position", "Coach").eq("nfl_team", team).single();

    const row = await coachRow(team);
    await db.from("players").update({ name: "Wrong Man" }).eq("id", row.id);

    const r = await ops.syncCoaches(db, { accountToken: token });
    expect(r.status).toBe(200);
    expect(r.body.report.rowsUpdated).toBeGreaterThanOrEqual(1);
    expect((await coachRow(team)).name).toBe(tpl.name);

    /* And the whole league now agrees, which is the actual promise. The demo seed's
     * coaches are the artifact's hand-typed names and the template's are the 08-29
     * ones, so this legitimately corrects several teams at once - that mismatch is
     * exactly the state issue #40 describes in the leagues people are playing. */
    const { data: after } = await db
      .from("players").select("name, nfl_team, retired")
      .eq("league_id", leagueId).eq("position", "Coach").eq("active", true);
    const { data: master } = await db
      .from("player_pool").select("name, nfl_team").eq("position", "Coach");
    const byTeam = new Map(master.map((m) => [m.nfl_team, m.name]));
    for (const row of after.filter((x) => !x.retired)) {
      expect(row.name).toBe(byTeam.get(row.nfl_team));
    }
  });

  it("A RENAME CANNOT MOVE A POINT", async () => {
    /* The claim the whole cross-league write rests on, checked rather than asserted:
     * every stat line and every finalized result in the league is byte-identical either
     * side of a coach being renamed. Scoring reads `nfl_team`, never the name. */
    const token = await asAdmin();
    const team = await teamOfSomeCoach();
    const snapshot = async () => {
      const [lines, results, totals] = await Promise.all([
        db.from("stat_lines").select("*").order("id"),
        db.from("period_results").select("*").order("id"),
        db.from("team_totals").select("*").order("id"),
      ]);
      return JSON.stringify([lines.data, results.data, totals.data]);
    };

    const before = await snapshot();
    await ops.setCoach(db, { accountToken: token, team, name: "Somebody Else Entirely" });
    expect(await snapshot()).toBe(before);
  });
});

/* ============================ the scheduled cycle ==========================
 *
 * Issue #52 / OQ-14: the weekly flow on a clock. The unit half - which leagues are due
 * and why not - is tests/autoCycle.test.js and runs anywhere. What needs a real
 * PostgREST is what cannot be reasoned about: that the scheduler runs THE SAME
 * OPERATIONS the commissioner's buttons run and leaves the same rows behind, that the
 * opt-in genuinely gates it, and that a refusal leaves the week exactly as it was
 * rather than half-advanced.
 *
 * The demo league sits in week 2 with rosters dealt, so the clock is moved rather than
 * the league: every test picks an instant, which is what the real job does anyway.
 */
gate()("the scheduled weekly cycle", () => {
  beforeEach(() => resetDemo());

  const season = async () => {
    const { data } = await db.from("seasons").select("*").eq("league_id", leagueId).single();
    return data;
  };
  const current = async () => {
    const { data } = await db
      .from("periods").select("*").eq("season_id", (await season()).id).eq("number", 2).single();
    return data;
  };
  const periodsOf = async () => {
    const { data } = await db
      .from("periods").select("*").eq("season_id", (await season()).id).order("number");
    return data;
  };
  const setSwitches = (patch) => db.from("leagues").update(patch).eq("id", leagueId);

  /* Tuesday 10am ET in the week the demo league was dealt; Thursday noon ET after it. */
  const TUESDAY = Date.parse("2026-10-20T14:00:00Z");
  const THURSDAY = Date.parse("2026-10-15T16:00:00Z");
  const DEALT_AT = "2026-10-13T14:00:00Z";

  /* Put the current week where a given step would find it. */
  const stage = async (patch) => {
    const period = await current();
    await db.from("periods").update({ dealt_at: DEALT_AT, ...patch }).eq("id", period.id);
    return current();
  };

  /* Every team in the week has a result, so `weekIsComplete` is satisfied. */
  const feedAllDone = async (periodId) => {
    const { data } = await db
      .from("roster_slots").select("players(nfl_team)").eq("period_id", periodId);
    const teams = [...new Set((data ?? []).map((r) => r.players?.nfl_team).filter(Boolean))];
    return {
      fetchGameResults: async () => ({ results: new Map(teams.map((t) => [t, "Win"])) }),
      fetchWeeklyStats: async () => ({ lines: [], stoppedEarly: false }),
      fetchDepthChart: async () => { throw new Error("feed down"); },
      fetchKickoffs: async () => ({ kickoffs: {} }),
      fetchWeekStarts: async () => ({ weekStarts: {} }),
    };
  };

  /* Kickoffs for exactly the teams that will have results, so the week reads complete. */
  const kickoffsForWeek = async (periodId) => {
    const { data } = await db
      .from("roster_slots").select("players(nfl_team)").eq("period_id", periodId);
    const out = {};
    for (const row of data ?? []) {
      if (row.players?.nfl_team) out[row.players.nfl_team] = "2026-10-18T17:00:00Z";
    }
    return out;
  };

  /* ------------------------------ the opt-in ------------------------------ */

  it("does nothing at all to a league that has not opted in", async () => {
    await setSwitches({ auto_process_schemes: false, auto_advance_week: false });
    const before = await periodsOf();

    const r = await ops.scheduledWeeklyCycle(db, { now: THURSDAY });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.considered).toBe(0);
    expect(await periodsOf()).toEqual(before);
  });

  /* ------------------------- Thursday: the schemes ------------------------ */

  it("processes schemes once the Thursday deadline has passed", async () => {
    await setSwitches({ auto_process_schemes: true, auto_advance_week: false });
    const period = await stage({ phase: "dealt" });

    const r = await ops.scheduledWeeklyCycle(db, { now: THURSDAY });
    expect(r.body.ok).toBe(true);
    expect(r.body.acted).toBe(1);

    const after = (await periodsOf()).find((p) => p.id === period.id);
    expect(after.phase).toBe("schemes-processed");
    /* Same as the button: scheme resolution locks the rosters, which is what opens the
     * stats window (see applyProcessSchemes, and OQ-12). */
    expect(after.roster_locked).toBe(true);
    expect(after.scheme_seed).toBeTruthy();
  });

  it("says so in the activity log, because nobody pressed anything", async () => {
    await setSwitches({ auto_process_schemes: true, auto_advance_week: false });
    await stage({ phase: "dealt" });

    await ops.scheduledWeeklyCycle(db, { now: THURSDAY });

    const { data: rows } = await db
      .from("events").select("text, type").eq("season_id", (await season()).id);
    expect(rows.some((r) => r.type === "auto" && /processed automatically/i.test(r.text))).toBe(true);
  });

  it("waits when the deadline has not come round yet", async () => {
    await setSwitches({ auto_process_schemes: true, auto_advance_week: false });
    const period = await stage({ phase: "dealt" });

    // Wednesday: dealt on Tuesday, Thursday 3am is still ahead.
    const r = await ops.scheduledWeeklyCycle(db, { now: Date.parse("2026-10-14T16:00:00Z") });
    expect(r.body.ok).toBe(true);
    expect(r.body.acted).toBe(0);
    expect(r.body.skipped).toBe(1);
    expect((await periodsOf()).find((p) => p.id === period.id).phase).toBe("dealt");
  });

  it("does nothing twice - a second run in the same hour is a skip", async () => {
    await setSwitches({ auto_process_schemes: true, auto_advance_week: false });
    const period = await stage({ phase: "dealt" });

    await ops.scheduledWeeklyCycle(db, { now: THURSDAY });
    const { data: once } = await db.from("periods").select("*").eq("id", period.id).single();

    const again = await ops.scheduledWeeklyCycle(db, { now: THURSDAY + 3600 * 1000 });
    expect(again.body.acted).toBe(0);
    const { data: twice } = await db.from("periods").select("*").eq("id", period.id).single();
    expect(twice.scheme_seed).toBe(once.scheme_seed);
  });

  /* --------------------- Tuesday: finalize, then deal --------------------- */

  it("finalizes a finished week and deals the next one", async () => {
    await setSwitches({ auto_process_schemes: false, auto_advance_week: true, auto_pull_stats: false });
    const period = await stage({
      phase: "stats", roster_locked: true, nfl_week: 6, kickoffs: await kickoffsForWeek((await current()).id),
    });

    const r = await ops.scheduledWeeklyCycle(db, { now: TUESDAY, feed: await feedAllDone(period.id) });
    expect(r.body.ok).toBe(true);
    expect(r.body.acted).toBe(1);

    const after = await periodsOf();
    expect(after.find((p) => p.id === period.id).phase).toBe("finalized");
    const next = after.find((p) => p.number === 3 && p.type === "week");
    expect(next).toBeTruthy();
    expect(next.phase).toBe("dealt");
    expect(next.deal_seed).toBeTruthy();
  });

  /* THE GUARD THAT MATTERS MOST. finalizePeriod will happily commit a week of zeros;
   * this is what stops an unattended one doing it while a game is still to be played. */
  it("REFUSES to finalize while a game of the week is unfinished", async () => {
    await setSwitches({ auto_process_schemes: false, auto_advance_week: true });
    const kickoffs = await kickoffsForWeek((await current()).id);
    const period = await stage({ phase: "stats", roster_locked: true, nfl_week: 6, kickoffs });

    const partial = {
      fetchGameResults: async () => ({ results: new Map() }), // nothing has finished
      fetchWeeklyStats: async () => ({ lines: [], stoppedEarly: false }),
    };
    const r = await ops.scheduledWeeklyCycle(db, { now: TUESDAY, feed: partial });
    expect(r.body.ok).toBe(true);
    expect(r.body.acted).toBe(0);
    expect(r.body.leagues[0].why).toMatch(/not finished playing/);
    expect((await periodsOf()).find((p) => p.id === period.id).phase).toBe("stats");
  });

  it("refuses when the week's kickoff times were never read", async () => {
    await setSwitches({ auto_process_schemes: false, auto_advance_week: true });
    const period = await stage({ phase: "stats", roster_locked: true, nfl_week: 6, kickoffs: {} });

    const r = await ops.scheduledWeeklyCycle(db, { now: TUESDAY, feed: await feedAllDone(period.id) });
    expect(r.body.acted).toBe(0);
    expect(r.body.leagues[0].why).toMatch(/kickoff times/);
    expect((await periodsOf()).find((p) => p.id === period.id).phase).toBe("stats");
  });

  it("refuses a week whose schemes were never processed", async () => {
    await setSwitches({ auto_process_schemes: false, auto_advance_week: true });
    const period = await stage({ phase: "dealt", kickoffs: await kickoffsForWeek((await current()).id) });

    const r = await ops.scheduledWeeklyCycle(db, { now: TUESDAY, feed: await feedAllDone(period.id) });
    expect(r.body.acted).toBe(0);
    expect((await periodsOf()).find((p) => p.id === period.id).phase).toBe("dealt");
  });

  /* THE STOP CONDITION. Nothing in the engine knows how long a regular season is, so
   * without this the clock would deal week 19, 20 and 21 into January. */
  it("finalizes week 18 but does not deal week 19", async () => {
    await setSwitches({ auto_process_schemes: false, auto_advance_week: true });
    const kickoffs = await kickoffsForWeek((await current()).id);
    const period = await stage({
      phase: "stats", roster_locked: true, nfl_week: 18, kickoffs,
    });

    const r = await ops.scheduledWeeklyCycle(db, { now: TUESDAY, feed: await feedAllDone(period.id) });
    expect(r.body.ok).toBe(true);

    const after = await periodsOf();
    expect(after.find((p) => p.id === period.id).phase).toBe("finalized");
    const next = after.find((p) => p.number === 3 && p.type === "week");
    expect(next.phase).toBe("pre-deal"); // created, deliberately not dealt

    const { data: log } = await db.from("events").select("text").eq("season_id", (await season()).id);
    expect(log.some((l) => /last week of the regular season/i.test(l.text))).toBe(true);
  });

  it("does not repeat the end-of-season note on every hourly tick", async () => {
    await setSwitches({ auto_process_schemes: false, auto_advance_week: true });
    const kickoffs = await kickoffsForWeek((await current()).id);
    const period = await stage({ phase: "stats", roster_locked: true, nfl_week: 18, kickoffs });
    const feed = await feedAllDone(period.id);

    await ops.scheduledWeeklyCycle(db, { now: TUESDAY, feed });
    await ops.scheduledWeeklyCycle(db, { now: TUESDAY + 3600 * 1000, feed });

    const { data: log } = await db.from("events").select("text").eq("season_id", (await season()).id);
    expect(log.filter((l) => /last week of the regular season/i.test(l.text)).length).toBe(1);
  });

  /* THE CASE THAT SPLIT THE STEP IN TWO. A commissioner who finalizes himself on Monday
   * night leaves the week in `pre-deal` with nothing left to finalize. A job that could
   * only "finalize and then deal" would skip that league every Tuesday, forever, and
   * the league would simply never be dealt. */
  it("deals a week the commissioner finalized himself the night before", async () => {
    await setSwitches({ auto_process_schemes: false, auto_advance_week: true });
    const period = await current();
    // Week 2 finished by hand on Monday night; week 3 exists and is waiting.
    await db.from("periods")
      .update({ phase: "finalized", finalized_at: "2026-10-20T02:00:00Z" })
      .eq("id", period.id);
    const { data: season3 } = await db
      .from("periods").insert({
        season_id: (await season()).id, type: "week", number: 3, phase: "pre-deal", nfl_week: 7,
      }).select().single();

    const r = await ops.scheduledWeeklyCycle(db, { now: TUESDAY, feed: await feedAllDone(period.id) });
    expect(r.body.ok).toBe(true);

    const { data: after } = await db.from("periods").select("*").eq("id", season3.id).single();
    expect(after.phase).toBe("dealt");
  });

  /* And NOT at 11pm on the Monday, because Scott asked for Tuesday morning. */
  it("does not deal on the Monday night the week ended", async () => {
    await setSwitches({ auto_process_schemes: false, auto_advance_week: true });
    const period = await current();
    await db.from("periods")
      .update({ phase: "finalized", finalized_at: "2026-10-20T02:00:00Z" })
      .eq("id", period.id);
    const { data: week3 } = await db
      .from("periods").insert({
        season_id: (await season()).id, type: "week", number: 3, phase: "pre-deal", nfl_week: 7,
      }).select().single();

    const mondayNight = Date.parse("2026-10-20T03:00:00Z"); // 11pm ET Monday
    await ops.scheduledWeeklyCycle(db, { now: mondayNight, feed: await feedAllDone(period.id) });

    const { data: after } = await db.from("periods").select("*").eq("id", week3.id).single();
    expect(after.phase).toBe("pre-deal");
  });

  /* -------------------------- the two together --------------------------- */

  /* A Tuesday run deals a fresh week, whose `dealt_at` is NOW - so the scheme step,
   * which runs second, must correctly leave it alone rather than processing schemes
   * that were submitted seconds ago. */
  it("does not process the schemes of a week it just dealt", async () => {
    await setSwitches({ auto_process_schemes: true, auto_advance_week: true });
    const kickoffs = await kickoffsForWeek((await current()).id);
    const period = await stage({ phase: "stats", roster_locked: true, nfl_week: 6, kickoffs });

    await ops.scheduledWeeklyCycle(db, { now: TUESDAY, feed: await feedAllDone(period.id) });

    const next = (await periodsOf()).find((p) => p.number === 3 && p.type === "week");
    expect(next.phase).toBe("dealt");
    expect(next.roster_locked).toBe(false);
  });

  /* ------------------------------ the switch ------------------------------ */

  it("setAutoCycle is commissioner-only, and reaches the browser", async () => {
    const manager = await asManager(T1);
    expect((await ops.setAutoCycle(db, { leagueId, token: manager, processSchemes: true })).status).toBe(403);

    const token = await asCommissioner();
    const r = await ops.setAutoCycle(db, { leagueId, token, processSchemes: true, advanceWeek: true });
    expect(r.status).toBe(200);
    expect(r.body.view._meta.autoProcessSchemes).toBe(true);
    expect(r.body.view._meta.autoAdvanceWeek).toBe(true);

    const off = await ops.setAutoCycle(db, { leagueId, token, processSchemes: false, advanceWeek: false });
    expect(off.body.view._meta.autoProcessSchemes).toBe(false);
    expect(off.body.view._meta.autoAdvanceWeek).toBe(false);
  });

  it("changes only what it was sent", async () => {
    const token = await asCommissioner();
    await ops.setAutoCycle(db, { leagueId, token, processSchemes: true, advanceWeek: true });
    const r = await ops.setAutoCycle(db, { leagueId, token, tz: "America/Denver" });
    expect(r.body.view._meta.tz).toBe("America/Denver");
    expect(r.body.view._meta.autoProcessSchemes).toBe(true);
    expect(r.body.view._meta.autoAdvanceWeek).toBe(true);
  });

  /* Refused at the door rather than three hours later inside a cron, where the only
   * symptom would be a league that quietly stopped advancing. */
  it("refuses a timezone the runtime cannot use", async () => {
    const token = await asCommissioner();
    const r = await ops.setAutoCycle(db, { leagueId, token, tz: "Mars/Olympus_Mons" });
    expect(r.status).toBe(400);
  });

  /* A league in California should not have its schemes processed at midnight because
   * the deadline was written in Eastern. */
  it("keeps the deadline in the league's own timezone", async () => {
    await setSwitches({ auto_process_schemes: true, auto_advance_week: false, tz: "America/Los_Angeles" });
    const period = await stage({ phase: "dealt" });

    // 3:30am Eastern on Thursday is 12:30am Pacific - the Pacific deadline is hours off.
    const early = await ops.scheduledWeeklyCycle(db, { now: Date.parse("2026-10-15T07:30:00Z") });
    expect(early.body.acted).toBe(0);
    expect((await periodsOf()).find((p) => p.id === period.id).phase).toBe("dealt");

    // 3:30am Pacific.
    const due = await ops.scheduledWeeklyCycle(db, { now: Date.parse("2026-10-15T10:30:00Z") });
    expect(due.body.acted).toBe(1);
    expect((await periodsOf()).find((p) => p.id === period.id).phase).toBe("schemes-processed");
  });
});
