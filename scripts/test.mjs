#!/usr/bin/env node
/* Pigskin Poker - run the tests, then put the development accounts back.
 *
 * THE PROBLEM THIS SOLVES, because the symptom is genuinely mystifying:
 *
 * `tests/server.test.js` needs a known starting point, so it resets the demo league
 * between tests by piping `supabase/seed.sql` straight into psql. That file deletes the
 * league row and rebuilds it - and `league_members.league_id` cascades on delete, so
 * every development membership goes with it. The `auth.users` rows survive, because
 * they belong to Supabase's schema and the seed never touches it.
 *
 * The result is an account that signs in perfectly and then lands on "You are not in a
 * league yet". Nothing looks broken, the magic link worked, and the league is still
 * there - it is only the row joining the two that is gone. That is a bad half hour for
 * anyone who has just run the tests and gone back to the browser.
 *
 * WHY RESTORE HERE RATHER THAN TEACH THE SEED FILE ABOUT ACCOUNTS
 * Because `seed.sql` is what `resetDemo()` runs, memberships added to it would appear
 * in the middle of the security suite - which asserts things about the contents of
 * `league_members`, including that it is empty after a link is refused. Fixtures
 * materialising inside those tests would weaken 149 assertions to save one command.
 * The suite's world stays exactly as it was; the restore happens after it finishes.
 *
 * Vitest's exit code is preserved, so this stays honest in CI.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { seedAccounts } from "./seed-accounts.mjs";

const require = createRequire(import.meta.url);
const bin = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
if (!fs.existsSync(bin)) {
  console.error("\n  Vitest is not installed. Run `npm install`.\n");
  process.exit(1);
}

/* THE SUITE READS THE RECORDED FEED, NEVER THE NETWORK.
 *
 * Some operations reach the feed without a test injecting one - dealing a week reads
 * that week's kickoff times, for instance. Left to the default that would download
 * nflverse's games file inside a unit test, which is slow, flaky, and asserts nothing.
 * Asking for the fixture is enough: feed/index.js still refuses to serve it against
 * anything but a local database, so this cannot leak into a real environment, and a run
 * with no local stack skips those tests anyway. An explicit setting is honoured. */
const env = { ...process.env };
if (!env.PIGSKIN_FEED) env.PIGSKIN_FEED = "fixture";

const child = spawn(process.execPath, [bin, "run", ...process.argv.slice(2)], { stdio: "inherit", env });

child.on("exit", async (code, signal) => {
  /* `optional` - a suite run with no local stack has nothing to restore, and should say
   * nothing rather than complain about a database it never needed. */
  try {
    const r = await seedAccounts({ optional: true, log: () => {} });
    if (r?.restored) console.log("\n  Development accounts restored (" + r.restored + " membership row(s) the demo reset cascaded away).");
  } catch {
    /* Never let cleanup turn a passing run into a failing one. */
  }
  process.exit(signal ? 1 : (code ?? 0));
});
