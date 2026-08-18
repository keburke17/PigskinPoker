#!/usr/bin/env node
/* Create a BLANK league in a Supabase database.
 *
 * This is the production equivalent of what the Artifact did in the browser on first
 * run: createDefaultState(). It is needed because `supabase db push` creates the schema
 * but runs no seed, so a freshly deployed database has zero leagues - and the app would
 * sit on "Loading Pigskin Poker..." forever with nothing to load.
 *
 * WHAT "BLANK" MEANS HERE
 *   - one league, one season, week 1, phase 'pre-deal'
 *   - the full 223-player pool (you cannot deal a roster without players)
 *   - ZERO teams - the commissioner adds those through the UI
 *   - the commissioner code set NOW, so there is never an unclaimed commissioner slot
 *
 * WHY THE CODE IS SET HERE RATHER THAN CLAIMED IN THE UI
 * The Artifact let the first person to type a code become the commissioner. That was
 * fine behind a private Artifact link. On a public URL it is a land-grab: whoever finds
 * the site first owns the league. Setting it at bootstrap closes that window.
 *
 * USAGE
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... PIGSKIN_COMMISSIONER_CODE=... \
 *     node scripts/bootstrap-league.mjs --name "Pigskin Poker" --year 2026
 *
 * Secrets come from the environment, never from arguments - arguments land in shell
 * history and process listings.
 */

import { createClient } from "@supabase/supabase-js";
import { createDefaultState } from "../src/engine/index.js";
import { decomposeLeague } from "../src/storage/decompose.js";
import { hashCode } from "../server/auth.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const NAME = args.name || "Pigskin Poker";
const YEAR = Number(args.year || new Date().getFullYear());
const FORCE = "force" in args;

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const code = process.env.PIGSKIN_COMMISSIONER_CODE;

function die(msg) {
  console.error("\n  " + msg + "\n");
  process.exit(1);
}

if (!url) die("SUPABASE_URL is not set.");
if (!secret) die("SUPABASE_SECRET_KEY is not set.");
if (secret.startsWith("sb_publishable_")) {
  die("SUPABASE_SECRET_KEY holds a PUBLISHABLE key. Bootstrapping needs the secret key.");
}
if (!code) {
  die(
    "PIGSKIN_COMMISSIONER_CODE is not set.\n" +
    "  Choose the commissioner code now so the deployed league never has an\n" +
    "  unclaimed commissioner slot. Example:\n\n" +
    "    PIGSKIN_COMMISSIONER_CODE='pick-something-good' node scripts/bootstrap-league.mjs"
  );
}
if (code.trim().length < 8) {
  die("PIGSKIN_COMMISSIONER_CODE is too short - use at least 8 characters. It is the only\n" +
      "  thing standing between the internet and commissioner access, and login is not\n" +
      "  rate limited yet (see docs/AUTH.md).");
}

const db = createClient(url, secret, { auth: { persistSession: false } });

/* ---- refuse to run over an existing league unless explicitly forced ---- */
const existing = await db.from("leagues").select("id, name");
if (existing.error) die("Could not read the database: " + existing.error.message);
if (existing.data.length > 0 && !FORCE) {
  die(
    "REFUSING: this database already contains " + existing.data.length + " league(s):\n" +
    existing.data.map((l) => "    - " + l.name).join("\n") +
    "\n\n  Bootstrapping again would create a second league, so nothing was changed -\n" +
    "  INCLUDING the commissioner code. To change that code, use:\n\n" +
    "    PIGSKIN_COMMISSIONER_CODE='new-code' npm run set-code\n\n" +
    "  Pass --force only if you really do want a second league."
  );
}

/* ---- build the blank league ---- */
const blank = createDefaultState();
blank.leagueName = NAME;
// createDefaultState() has no teams, a full player pool, and week 1 pre-deal - which is
// exactly what "blank" should mean. Nothing else to do.

const rows = decomposeLeague(blank, {
  leagueKey: NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ":" + YEAR,
  year: YEAR,
  hashCode,
});

const ORDER = ["leagues", "seasons", "players", "periods"];
for (const table of ORDER) {
  const data = rows[table] ?? [];
  if (!data.length) continue;
  const { error } = await db.from(table).insert(data);
  if (error) die("Failed inserting " + table + ": " + error.message);
  console.log("  inserted " + String(data.length).padStart(4) + "  " + table);
}

/* ---- set the commissioner code, and the public flag that goes with it ---- */
const leagueId = rows.leagues[0].id;
const sec = await db.from("league_secrets").upsert({
  league_id: leagueId,
  commissioner_code_hash: hashCode(code),
  updated_at: new Date().toISOString(),
});
if (sec.error) die("Failed storing the commissioner code: " + sec.error.message);

const flag = await db.from("leagues").update({ has_commissioner_code: true }).eq("id", leagueId);
if (flag.error) die("Failed setting has_commissioner_code: " + flag.error.message);

console.log("\n  Blank league ready.");
console.log("    name    " + NAME);
console.log("    season  " + YEAR);
console.log("    players " + rows.players.length);
console.log("    teams   0  (add them in the app: Commissioner -> Teams)");
console.log("\n  Log in as commissioner with the code you just set, then add teams,");
console.log("  give each a join code, and deal week 1.\n");
console.log("  Set VITE_LEAGUE_NAME=\"" + NAME + "\" wherever the app is deployed.\n");
