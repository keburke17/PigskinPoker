#!/usr/bin/env node
/* Pigskin Poker - TAKE A BACKUP OF THE HOSTED PROJECT.
 *
 *   npm run db:backup
 *
 * Writes three timestamped files into `backups/` and tells you what each one is for.
 *
 * WHY THIS EXISTS
 * `docs/DEPLOYMENT.md` says "there is no undo" and points at Supabase's own backups.
 * On the free tier there are none to point at - no daily snapshot, no point-in-time
 * restore - so from the moment a real season is in that database, the only backup is
 * one somebody took. This is the command that makes taking one a ten-second job instead
 * of a research project.
 *
 * IT DOES NOT REPLACE THE IN-APP BACKUP, and the difference is worth knowing:
 *
 *   Commissioner -> Backup -> Download Backup (JSON)
 *       ONE league's game state, in the app's own format, restorable through the app by
 *       the commissioner with no tools and no help. That is the backup that gets used.
 *
 *   npm run db:backup
 *       The whole project - every league, plus the accounts, memberships, invitations
 *       and site admins that the JSON export has no room for, because they are not part
 *       of any league's game state. Restoring it needs psql and Kyle.
 *
 * Take the JSON one weekly for convenience. Take this one before anything irreversible:
 * a migration, a wipe, a restore.
 *
 * WHAT IT PRODUCES
 *   <stamp>-schema.sql   tables, indexes, policies, grants, functions
 *   <stamp>-data.sql     every row in `public`, as COPY statements
 *   <stamp>-auth.sql     the `auth` schema's rows: the accounts themselves
 *
 * THE AUTH DUMP HOLDS CREDENTIAL MATERIAL. `backups/` is git-ignored, and this refuses
 * to write anywhere that is not - see the check below. Do not paste these into a chat,
 * an issue, or a support ticket.
 *
 * It reads the LINKED project (`supabase link`), the same as `verify:grants`, so there
 * is no second place to configure a target and no chance of pointing it at the wrong one.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./local-env.mjs";

const BACKUP_DIR = path.join(ROOT, "backups");

const say = (s) => console.log(s);
const die = (msg) => {
  console.error("\n" + msg + "\n");
  process.exit(1);
};

/* ------------------------------------------------------------------ target -- */

const refFile = path.join(ROOT, "supabase", ".temp", "project-ref");
if (!fs.existsSync(refFile)) {
  die(
    "  No linked project.\n\n" +
    "  This dumps the project the Supabase CLI is linked to, so there is one target\n" +
    "  and no way to name the wrong one by hand:\n\n" +
    "      npx supabase login\n" +
    "      npx supabase link --project-ref YOUR_REF"
  );
}
const ref = fs.readFileSync(refFile, "utf8").trim();

/* THE ONE CHECK THAT IS NOT A FORMALITY. The auth dump contains hashed credentials and
 * every address in the league. If `backups/` ever stopped being ignored, this command
 * would quietly stage them for the next commit. Ask git rather than trusting the
 * .gitignore to still say what it says today. */
const ignored = spawnSync("git", ["check-ignore", "-q", BACKUP_DIR + "/probe.sql"], { cwd: ROOT });
if (ignored.status !== 0) {
  die(
    "  REFUSING: `backups/` is not git-ignored.\n\n" +
    "  These files contain account credential material and every member's email\n" +
    "  address. Add this to .gitignore, then re-run:\n\n" +
    "      backups/"
  );
}

/* ------------------------------------------------------------------- dump -- */

/* Sortable, filesystem-safe, and no colons - 2026-09-07T2114Z. */
const stamp = new Date().toISOString().slice(0, 16).replace(/:/g, "") + "Z";
const prefix = path.join(BACKUP_DIR, stamp + "-" + ref);

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const dumps = [
  {
    name: "schema",
    what: "tables, indexes, RLS policies, grants, functions",
    args: ["db", "dump", "--linked"],
  },
  {
    name: "data",
    what: "every row in `public` - the leagues and everything under them",
    /* COPY rather than INSERT: an order of magnitude smaller and faster to restore, and
     * the file is never meant to be read line by line anyway. */
    args: ["db", "dump", "--linked", "--data-only", "--use-copy"],
  },
  {
    name: "auth",
    what: "the accounts themselves - CREDENTIAL MATERIAL, handle accordingly",
    args: ["db", "dump", "--linked", "--data-only", "--schema", "auth"],
  },
];

say("\n  Backing up " + ref + " into backups/\n");

const written = [];
for (const d of dumps) {
  const file = prefix + "-" + d.name + ".sql";
  process.stdout.write("  " + d.name.padEnd(7));
  const r = spawnSync("npx", ["supabase", ...d.args, "-f", file], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    say("FAILED");
    die("  `supabase " + d.args.join(" ") + "` failed:\n\n" + (r.stderr || r.error || "").toString().trim());
  }
  const bytes = fs.statSync(file).size;
  say(String(Math.round(bytes / 1024)).padStart(6) + " KB   " + d.what);
  written.push({ file, bytes });
}

/* An empty dump is a successful command that backed nothing up, and it is the failure
 * you would not notice until you needed the file. */
const suspicious = written.filter((w) => w.bytes < 512);
if (suspicious.length) {
  say(
    "\n  WARNING: " + suspicious.length + " of these came back nearly empty. That is normal\n" +
    "  for `auth` on a project nobody has signed into yet, and a problem otherwise."
  );
}

say(
  "\n  Written to backups/" + path.basename(prefix) + "-{schema,data,auth}.sql\n" +
  "\n" +
  "  TO RESTORE, and it is worth reading this now rather than at the moment you need it:\n" +
  "\n" +
  "    A restore is a manual, deliberate operation - there is no `db:restore` on purpose,\n" +
  "    because the safe procedure depends on what went wrong. Broadly:\n" +
  "\n" +
  "      psql \"$DIRECT_CONNECTION_STRING\" -f backups/<stamp>-schema.sql   # empty project\n" +
  "      psql \"$DIRECT_CONNECTION_STRING\" -f backups/<stamp>-data.sql\n" +
  "\n" +
  "    The connection string is in the Supabase dashboard under Project Settings ->\n" +
  "    Database. Restoring `auth` into a project that still has accounts conflicts on\n" +
  "    the user ids; that file is for rebuilding an EMPTY project, not for merging.\n" +
  "\n" +
  "    For one league gone wrong, the in-app Restore (Commissioner -> Backup) is the\n" +
  "    faster and far safer tool. Reach for this only when the project itself is lost.\n"
);
