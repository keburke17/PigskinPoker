#!/usr/bin/env node
/* Generates supabase/seed.sql from the SAME demo-league definition the in-memory
 * adapter uses (src/storage/demoLeague.js), via the SAME decomposition the Phase 5
 * importer will use (src/storage/decompose.js).
 *
 * Generating rather than hand-writing is the point: the two demo leagues cannot drift,
 * and the blob->rows mapping that carries the real league across in Phase 5 gets
 * exercised on every `supabase db reset`.
 *
 *   npm run seed:generate
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoLeague } from "../src/storage/demoLeague.js";
import { decomposeLeague } from "../src/storage/decompose.js";
import { buildPool, fetchDepthChart, fetchHeadCoaches } from "../server/feed/fixture.js";
import { normalizeName } from "../server/pool.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "supabase", "seed.sql");

const DEMO_LEAGUE_KEY = "demo";
const DEMO_YEAR = 2026;

/* Hashing comes from server/auth.js - the SAME scrypt function the login endpoint
 * verifies against. One implementation, so a seeded code and a commissioner-set code
 * can never end up in incompatible formats. */

/* ---------- SQL literal formatting ---------- */
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) {
    if (v.length === 0) return "'{}'";
    // int[] and uuid[] both render fine as an array literal.
    return q("{" + v.map((x) => (typeof x === "number" ? x : '"' + x + '"')).join(",") + "}");
  }
  if (typeof v === "object") return q(JSON.stringify(v)) + "::jsonb";
  return q(v);
}

function insertStatement(table, rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const values = rows
    .map((r) => "  (" + cols.map((c) => lit(r[c])).join(", ") + ")")
    .join(",\n");
  return (
    "insert into " + table + " (" + cols.join(", ") + ") values\n" + values + ";\n"
  );
}

/* ---------- build ---------- */
const state = createDemoLeague();
const rows = decomposeLeague(state, {
  leagueKey: DEMO_LEAGUE_KEY,
  year: DEMO_YEAR,
});

/* ---------- what the pool refresh will find here ----------
 *
 * A freshly reset demo league used to have every player row identical: source 'seed',
 * status_source 'default', nothing the feed had ever said. Pressing Refresh against it
 * produced one enormous undifferentiated diff, and the screens that exist to show
 * DISAGREEMENT had nothing to show - so the interesting cases could only be tested by
 * editing rows by hand first, which nobody does twice.
 *
 * These three rows are chosen against the RECORDED fixture (server/feed/fixture/), so
 * they mean the same thing on every machine and after every reset. Derived rather than
 * hard-coded by name: re-recording the fixture re-picks them instead of quietly making
 * the scenario meaningless.
 */
const feedChart = await fetchDepthChart({ season: DEMO_YEAR });
const feedCoaches = await fetchHeadCoaches({ season: DEMO_YEAR });
const feedPool = buildPool({
  depthPlayers: feedChart.players,
  coaches: feedCoaches.coaches,
}).players;
const feedKeys = new Set(feedPool.map((p) => normalizeName(p.name) + "|" + p.position));
const keyOf = (r) => normalizeName(r.name) + "|" + r.position;

/* Columns decompose does not write, spelled out on EVERY row: insertStatement takes its
 * column list from the first row, so a key that exists on only some of them would be
 * dropped from the statement entirely. */
rows.players = rows.players.map((r) => ({
  ...r, depth_rank: null, feed_status: null, feed_updated_at: null,
}));

const scenarios = [];
const scenario = (row, patch, why) => {
  if (!row) return;
  Object.assign(row, patch);
  scenarios.push("  " + (row.name + " (" + row.position + ")").padEnd(34) + why);
};
const claimed = rows.players.filter((r) => r.position !== "Coach" && feedKeys.has(keyOf(r)));
const unclaimed = rows.players.filter((r) => r.position !== "Coach" && !feedKeys.has(keyOf(r)));

scenario(claimed[0], { status: "OUT", status_source: "manual" },
  "OUT by hand, still starting per the feed - the disagreement");
scenario(unclaimed[0], { source: "manual" },
  "added by hand - a refresh must never retire him");
scenario(unclaimed[1], {
  status: "OUT", status_source: "feed", feed_status: "OUT", feed_updated_at: feedChart.snapshotAt,
}, "already retired BY the feed - a second refresh leaves him alone");

/* League week is not NFL week, and nothing writes the mapping yet (stage 3). The demo
 * league opens on week 1, so here they coincide - which is what lets a stats pull ask
 * the fixture for a week and get an answer. */
rows.periods = rows.periods.map((r) => ({
  ...r, nfl_week: r.type === "week" ? r.number : null,
}));

const ORDER = [
  "leagues", "seasons", "teams", "players", "periods",
  "team_totals", "roster_slots", "stat_lines", "schemes",
  "period_results", "events",
];

const header = `-- ============================================================================
--  Pigskin Poker - LOCAL DEVELOPMENT SEED
--
--  GENERATED FILE - DO NOT EDIT BY HAND.
--  Regenerate with:  npm run seed:generate
--  Source of truth:  src/storage/demoLeague.js + src/storage/decompose.js
--
--  Runs automatically on \`supabase start\` and \`supabase db reset\`, so
--  \`supabase db reset\` is the one-command way back to a clean, populated league.
--
--  ============================== SIGNING IN =================================
--  This file seeds the GAME. It seeds no credentials, because there are none to
--  seed: join codes are gone, and accounts live in Supabase's own auth schema
--  where SQL has no business creating them.
--
--  \`scripts/seed-accounts.mjs\` creates the development accounts and their
--  league_members rows through the admin API, and \`npm run dev\` runs it for you.
--      Commissioner:  commish@pigskin.test
--      Managers:      team1@pigskin.test .. team6@pigskin.test
--  ===========================================================================
--
--  Contents: a six-team league with Week 1 played and finalized (so standings and
--  results have data) and Week 2 dealt, schemes resolved, and stats part-entered -
--  which is the state the app is actually in on a Sunday afternoon.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  SAFETY GUARD - refuse to run against a database holding real data.
--
--  In the normal workflow this file only ever runs locally: \`supabase db reset\`
--  and \`supabase start\` target the local stack, and \`supabase db push\` (which is
--  what touches a hosted project) does NOT run seeds. This guard is for the
--  abnormal case - someone piping this file at a real database by hand.
--
--  It keys off DATA rather than hostname, because that is what actually matters
--  and what can be checked reliably from inside SQL.
-- ---------------------------------------------------------------------------
do $guard$
declare
  foreign_leagues int;
  finalized       int;
begin
  select count(*) into foreign_leagues
    from leagues where id <> ${q(rows.leagues[0].id)}::uuid;

  -- Scoped to OTHER leagues on purpose: the demo league contains its own finalized
  -- Week 1, so an unscoped count would make this file refuse to re-run over itself.
  select count(*) into finalized
    from periods p
    join seasons s on s.id = p.season_id
   where p.phase = 'finalized'
     and s.league_id <> ${q(rows.leagues[0].id)}::uuid;

  if foreign_leagues > 0 or finalized > 0 then
    raise exception
      'REFUSING TO SEED: this database already holds real data (% other league(s), % finalized period(s) outside the demo league). The demo seed is for local development only.',
      foreign_leagues, finalized
      using hint = 'If this really is a scratch database, delete its contents first.';
  end if;
end
$guard$;

-- Idempotent: wipe any previous demo league, then rebuild it. Everything else
-- cascades from the league row.
delete from leagues where id = ${q(rows.leagues[0].id)}::uuid;

`;

const body = ORDER.map((t) => insertStatement(t, rows[t] || [])).filter(Boolean).join("\n");

const footer = `
-- ---------------------------------------------------------------------------
--  Sanity check: fail loudly if the seed did not land as expected, rather than
--  leaving a half-populated database that looks fine until someone logs in.
-- ---------------------------------------------------------------------------
do $verify$
declare
  n_teams int; n_players int; n_slots int; n_results int;
begin
  select count(*) into n_teams   from teams;
  select count(*) into n_players from players;
  select count(*) into n_slots   from roster_slots;
  select count(*) into n_results from period_results;

  if n_teams <> ${rows.teams.length} or n_players <> ${rows.players.length}
     or n_slots <> ${rows.roster_slots.length} or n_results <> ${rows.period_results.length} then
    raise exception 'SEED VERIFICATION FAILED: teams=% players=% slots=% results=%',
      n_teams, n_players, n_slots, n_results;
  end if;

  raise notice 'Pigskin Poker demo league seeded: % teams, % players, % roster slots.',
    n_teams, n_players, n_slots;
end
$verify$;
`;

fs.writeFileSync(OUT, header + body + footer);

const total = ORDER.reduce((n, t) => n + (rows[t]?.length ?? 0), 0);
console.log("Wrote " + path.relative(ROOT, OUT) + " (" + total + " rows)");
for (const t of ORDER) {
  const n = rows[t]?.length ?? 0;
  if (n) console.log("  " + String(n).padStart(4) + "  " + t);
}

console.log("\nPool scenarios a refresh will meet (from the recorded fixture):");
for (const line of scenarios) console.log(line);
