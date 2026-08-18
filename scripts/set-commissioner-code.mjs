#!/usr/bin/env node
/* Set or rotate a league's commissioner code.
 *
 * WHY THIS EXISTS
 * Codes are stored as one-way scrypt hashes, so a forgotten or mistyped code cannot be
 * recovered - only replaced. Without this script the only recovery is hand-editing the
 * database, which is exactly the situation nobody should be in at 1pm on a Sunday.
 *
 * It is also the rotation path: if a code leaks, change it here.
 *
 * SECURITY: rotating the code INVALIDATES existing commissioner sessions. A code change
 * usually means "someone shouldn't have this any more", and a 30-day session token that
 * survived the rotation would quietly defeat the point.
 *
 * USAGE
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... PIGSKIN_COMMISSIONER_CODE=... \
 *     node scripts/set-commissioner-code.mjs [--name "League Name"]
 *
 * Secrets come from the environment, never from arguments - arguments land in shell
 * history and process listings.
 */

import { createClient } from "@supabase/supabase-js";
import { hashCode } from "../server/auth.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);


/* Shell quoting leaks through more often than you would think - a code arriving as
 * 'pigskinPoker' (quotes included) hashes those quotes in, and then nothing the person
 * types on the login screen can ever match. Smart quotes from copy-paste are worse,
 * because they are invisible in most terminals.
 *
 * Strip a matching surrounding pair, and say so loudly rather than silently. */
const QUOTE_PAIRS = [["'", "'"], ['"', '"'], ["\u2018", "\u2019"], ["\u201c", "\u201d"], ["\u2019", "\u2019"]];
function unquote(raw) {
  let v = String(raw ?? "").trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (v.length >= 2 && v.startsWith(open) && v.endsWith(close)) {
      const inner = v.slice(1, -1);
      console.warn(
        "\n  NOTE: the code arrived wrapped in quote characters (" + open + close + ").\n" +
        "  That is shell quoting leaking through, not part of your code. Using the\n" +
        "  text inside the quotes instead - otherwise nobody could ever type it in."
      );
      return inner.trim();
    }
  }
  return v;
}

/* Anything outside printable ASCII will be impossible to type on a phone. */
function warnIfExotic(v) {
  const bad = [...v].filter((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126);
  if (bad.length) {
    console.warn(
      "\n  WARNING: the code contains " + bad.length + " non-ASCII or control character(s): " +
      bad.map((c) => "U+" + c.charCodeAt(0).toString(16).padStart(4, "0")).join(" ") +
      "\n  Smart quotes and dashes look normal but cannot be typed reliably on a phone."
    );
  }
}

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const code = unquote(process.env.PIGSKIN_COMMISSIONER_CODE);

const die = (m) => {
  console.error("\n  " + m + "\n");
  process.exit(1);
};

if (!url) die("SUPABASE_URL is not set.");
if (!secret) die("SUPABASE_SECRET_KEY is not set.");
if (secret.startsWith("sb_publishable_")) die("SUPABASE_SECRET_KEY holds a PUBLISHABLE key.");
if (!code) die("PIGSKIN_COMMISSIONER_CODE is not set - that is the code you want to set.");
warnIfExotic(code);
if (code.trim().length < 8) {
  die(
    "PIGSKIN_COMMISSIONER_CODE is too short - use at least 8 characters.\n" +
    "  Login is not rate limited yet (see docs/AUTH.md), so a short code is genuinely\n" +
    "  guessable. A short phrase works well: 'gridiron-tuesday-night'."
  );
}

const db = createClient(url, secret, { auth: { persistSession: false } });

const { data: leagues, error } = await db.from("leagues").select("id, name");
if (error) die("Could not read the database: " + error.message);
if (!leagues.length) {
  die("This database has no league yet. Run `npm run bootstrap` first.");
}

let league;
if (args.name) {
  league = leagues.find((l) => l.name === args.name);
  if (!league) {
    die(
      'No league named "' + args.name + '". This database has:\n' +
      leagues.map((l) => "    - " + l.name).join("\n")
    );
  }
} else if (leagues.length === 1) {
  league = leagues[0];
} else {
  die(
    "This database holds " + leagues.length + " leagues. Pass --name to choose one:\n" +
    leagues.map((l) => "    - " + l.name).join("\n")
  );
}

const up = await db.from("league_secrets").upsert({
  league_id: league.id,
  commissioner_code_hash: hashCode(code),
  updated_at: new Date().toISOString(),
});
if (up.error) die("Could not store the code: " + up.error.message);

const flag = await db.from("leagues").update({ has_commissioner_code: true }).eq("id", league.id);
if (flag.error) die("Could not set has_commissioner_code: " + flag.error.message);

/* Any session issued under the OLD code is now void. */
const killed = await db
  .from("sessions")
  .delete()
  .eq("league_id", league.id)
  .eq("role", "commissioner")
  .select("id");

/* Prove it. Reading the stored hash back and verifying against it turns "the write
 * succeeded" into "this exact code will log you in" - which is the thing the person
 * actually cares about, and the check that would have caught quote characters
 * immediately instead of at the login screen. */
const { verifyCode } = await import("../server/auth.js");
const back = await db
  .from("league_secrets").select("commissioner_code_hash").eq("league_id", league.id).single();
if (back.error || !verifyCode(code, back.data.commissioner_code_hash)) {
  die("The code was written but does NOT verify on read-back. Do not rely on it.");
}

console.log("\n  Commissioner code updated for \"" + league.name + "\" and verified.");
if (killed.data?.length) {
  console.log("  Signed out " + killed.data.length + " existing commissioner session(s).");
}
console.log("\n  Log in with exactly this, between the markers:\n");
console.log("      >>>" + code + "<<<   (" + code.length + " characters)\n");
console.log("  Case and surrounding spaces do not matter.\n");
