#!/usr/bin/env node
/* Verify the LIVE grant/RLS posture of a linked Supabase project.
 *
 * Run after every `supabase db push`:   npm run verify:grants
 *
 * Structural tests run against the local stack, which has no default privileges. A
 * hosted project DOES: every table it creates is born with `GRANT ALL` to `anon`, the
 * role the public publishable key uses. That difference is invisible locally and hid a
 * real regression on the first push - GRANT ALL on the secret-bearing tables and
 * sessions - so it needs checking where it actually happens.
 *
 * Read-only. Uses the CLI's existing link; no keys are read or written.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const READABLE = [
  "leagues", "seasons", "teams", "team_totals", "players",
  "periods", "roster_slots", "stat_lines", "period_results", "events",
  // Global, not league-scoped, and public on purpose - see the pool migration.
  "player_pool",
];
const SECRETS = ["invites"];
/* Phase 3b. A THIRD category, because these fit neither of the other two: they are
 * about people rather than about the game, so a signed-in visitor may read their own
 * rows (SELECT to `authenticated`, narrowed further by an RLS policy scoped to
 * auth.uid()) while a signed-out one gets nothing at all.
 *
 * Filed separately on purpose. Putting them in READABLE would assert `anon` can read
 * them, which is exactly wrong; putting them in SECRETS would assert nobody can, which
 * would fail on the grant the app actually needs. */
const ACCOUNT_TABLES = ["profiles", "league_members"];
const BROWSER_ROLES = ["anon", "authenticated"];

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pigskin-grants-")), "schema.sql");
console.log("Dumping remote schema...");
execSync("npx supabase db dump --linked -f " + out, { stdio: ["ignore", "ignore", "inherit"] });
const sql = fs.readFileSync(out, "utf8");

const problems = [];
const ok = [];

/** All GRANT statements against a table, as [privileges, role] pairs.
 *
 * NOTE the `"` in the character class. pg_dump emits COLUMN-level grants one per
 * column with the name quoted - GRANT SELECT("id") ON TABLE ... - so a pattern that
 * omits the quote silently matches nothing and reports a table as ungranted. */
function grantsFor(table) {
  const re = new RegExp(
    'GRANT ([A-Z, ()"a-z_]+) ON TABLE "public"\\."' + table + '" TO "([a-z_]+)"',
    "g"
  );
  return [...sql.matchAll(re)].map((m) => [m[1].trim(), m[2]]);
}

const rlsOn = (t) => new RegExp('"public"\\."' + t + '" ENABLE ROW LEVEL SECURITY').test(sql);

/* 1. RLS must be on everywhere. */
for (const t of [...READABLE, ...SECRETS, ...ACCOUNT_TABLES, "schemes"]) {
  if (rlsOn(t)) ok.push("RLS enabled on " + t);
  else problems.push("RLS is NOT enabled on " + t);
}

/* 2. The secrets tables must grant the browser roles nothing at all. */
for (const t of SECRETS) {
  const bad = grantsFor(t).filter(([, role]) => BROWSER_ROLES.includes(role));
  if (bad.length === 0) ok.push("no browser-role grants on " + t);
  else
    problems.push(
      t + " grants " + bad.map(([p, r]) => p + " to " + r).join(", ") +
      " - this table must be unreachable with the publishable key"
    );
}

/* 3. Readable tables must grant SELECT and nothing more. */
for (const t of READABLE) {
  const browser = grantsFor(t).filter(([, role]) => BROWSER_ROLES.includes(role));
  const overreach = browser.filter(([p]) => p !== "SELECT");
  if (browser.length === 0) problems.push(t + " grants the browser roles nothing - the app cannot read it");
  else if (overreach.length) {
    problems.push(
      t + " grants " + overreach.map(([p, r]) => p + " to " + r).join(", ") +
      " - the publishable key must have SELECT only"
    );
  } else ok.push("SELECT-only on " + t);
}

/* 4. Account tables: SELECT to `authenticated`, and NOTHING to `anon`.
 *
 * The anon half is the half that matters. These tables say which real people belong to
 * which leagues, which is not something a signed-out visitor with the publishable key
 * should be able to enumerate - and on a hosted project the default grant would have
 * handed them exactly that. */
for (const t of ACCOUNT_TABLES) {
  const anonGrants = grantsFor(t).filter(([, role]) => role === "anon");
  const authGrants = grantsFor(t).filter(([, role]) => role === "authenticated");
  const overreach = authGrants.filter(([p]) => p !== "SELECT");

  if (anonGrants.length) {
    problems.push(
      t + " grants " + anonGrants.map(([p]) => p).join(", ") +
      " to anon - a signed-OUT visitor must not see who belongs to a league"
    );
  } else if (authGrants.length === 0) {
    problems.push(t + " grants authenticated nothing - a signed-in person cannot read their own row");
  } else if (overreach.length) {
    problems.push(
      t + " grants " + overreach.map(([p]) => p).join(", ") +
      " to authenticated - reads only; every write goes through the function"
    );
  } else {
    ok.push("SELECT-to-authenticated-only on " + t + " (nothing to anon)");
  }
}

/* 5. schemes must be column-level, withholding submitted_at. */
const schemeBrowser = grantsFor("schemes").filter(([, r]) => BROWSER_ROLES.includes(r));
const wholeTable = schemeBrowser.filter(([p]) => p === "ALL" || p === "SELECT");
const leaksSubmittedAt = schemeBrowser.some(([p]) => /submitted_at/.test(p));
const columns = new Set(
  schemeBrowser.map(([p]) => (p.match(/SELECT\("([a-z_]+)"\)/) || [])[1]).filter(Boolean)
);

if (wholeTable.length) {
  problems.push("schemes has a whole-table grant - submitted_at would be exposed");
} else if (leaksSubmittedAt) {
  problems.push("schemes grants submitted_at to a browser role");
} else if (columns.size === 0) {
  problems.push("schemes grants the browser roles nothing - resolved schemes cannot be read");
} else {
  ok.push(
    "schemes is column-level (" + columns.size + " columns), submitted_at withheld"
  );
}

console.log("\n  " + ok.length + " checks passed");
for (const o of ok) console.log("    ok  " + o);

if (problems.length) {
  console.error("\n  " + problems.length + " PROBLEM(S):\n");
  for (const p of problems) console.error("    !!  " + p);
  console.error("\n  The publishable key ships to every browser. Fix these before deploying.\n");
  process.exit(1);
}
console.log("\n  Grant posture is correct.\n");
