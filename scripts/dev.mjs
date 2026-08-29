#!/usr/bin/env node
/* Pigskin Poker - THE local development command.
 *
 *   npm run dev
 *
 * One command, one mode: the real stack. It starts Docker's Supabase if it is not
 * already up, writes `.env.local` from what that stack actually reports, makes sure the
 * demo league and the development accounts are in the database, and then runs Vite.
 *
 * WHY THIS REPLACED A README SECTION
 * The old instructions were: start Docker, run `npx supabase start`, run
 * `npx supabase db reset`, then copy four values out of `npx supabase status` into a
 * file you create yourself. Every one of those steps is easy to skip and none of them
 * fail loudly when skipped - you just get a dev server pointed at nothing, or a green
 * `npm test` that silently skipped the 149 tests covering RLS and server authorization.
 * Encoding it here makes the correct setup the default rather than something to
 * remember.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not reset the database on every run. A reset destroys whatever you were in
 * the middle of, and a dev command that quietly discards work is one nobody trusts.
 * A reset happens only when the demo league is missing, or when you ask:
 *
 *   npm run dev -- --reset
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { ENV_PATH, MANAGED_KEYS, parseEnv, isLocalUrl } from "./local-env.mjs";
import { seedAccounts, planAccounts, COMMISSIONER_EMAIL, DEV_PASSWORD, DEMO_INVITE_CODE } from "./seed-accounts.mjs";
import { watchLinks } from "./magic-link.mjs";
import { feedChoice } from "../server/feed/index.js";

const FORCE_RESET = process.argv.slice(2).includes("--reset");

const say = (s) => console.log(s);
const step = (s) => console.log("\n> " + s);
const die = (msg) => {
  console.error("\n" + msg + "\n");
  process.exit(1);
};

function sh(cmd, args, { capture = false } = {}) {
  return spawnSync(cmd, args, {
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    /* npx (and any other .cmd-shimmed binary) only resolves on Windows through a shell -
     * see the same pattern in magic-link.mjs. `docker` is a real .exe either way, so this
     * is a no-op for that call. */
    shell: process.platform === "win32",
  });
}

/* ---------------------------------------------------------------- docker -- */

function requireDocker() {
  const r = sh("docker", ["info"], { capture: true });
  if (r.error && r.error.code === "ENOENT") {
    die(
      "  Docker is not installed.\n\n" +
      "  The local stack is Postgres, GoTrue and PostgREST in containers - the same\n" +
      "  pieces the hosted project runs, which is the point of developing against it.\n\n" +
      "  Install Docker Desktop: https://docs.docker.com/desktop/"
    );
  }
  if (r.status !== 0) {
    die(
      "  Docker is installed but not running.\n\n" +
      "  Start Docker Desktop, wait for the whale in the menu bar to settle, then:\n\n" +
      "      npm run dev"
    );
  }
}

/* ----------------------------------------------------------------- stack -- */

/** `supabase status -o env` output, or null when the stack is down. */
function stackStatus() {
  const r = sh("npx", ["supabase", "status", "-o", "env"], { capture: true });
  if (r.status !== 0) return null;
  const env = parseEnv(r.stdout);
  return env.API_URL ? env : null;
}

function ensureStack() {
  let status = stackStatus();
  if (status) {
    say("  supabase: already running");
    return status;
  }
  step("Starting the local Supabase stack (first run pulls images - this takes a while)");
  const r = sh("npx", ["supabase", "start"]);
  if (r.status !== 0) die("  `supabase start` failed. The output above says why.");
  status = stackStatus();
  if (!status) die("  The stack started but `supabase status` reports nothing usable.");
  return status;
}

/* ------------------------------------------------------------- .env.local -- */

/**
 * Write the four keys this project needs, and leave everything else in the file alone.
 *
 * SUPABASE_SECRET_KEY has no VITE_ prefix on purpose and must never get one: Vite
 * inlines any VITE_ variable into the browser bundle, and the secret key bypasses RLS.
 * tests/bundle.test.js asserts it never reaches the client.
 */
function writeEnvLocal(status) {
  const existingText = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const existing = parseEnv(existingText);

  /* A .env.local pointing at the hosted project is somebody mid-way through an
   * operational task, not a stale file. Overwriting it would silently redirect their
   * next `npm run verify:email` or `verify:redirects` at the wrong project. */
  for (const key of ["VITE_SUPABASE_URL", "SUPABASE_URL"]) {
    const v = existing[key];
    if (v && !isLocalUrl(v)) {
      die(
        "  .env.local points at a NON-LOCAL Supabase project:\n\n" +
        "      " + key + "=" + v + "\n\n" +
        "  Refusing to overwrite it - that file is probably set up for an operational\n" +
        "  task against the hosted database. Move it aside and re-run:\n\n" +
        "      mv .env.local .env.hosted"
      );
    }
  }

  const managed = {
    VITE_SUPABASE_URL: status.API_URL,
    SUPABASE_URL: status.API_URL,
    /* Prefer the new-style publishable/secret keys; fall back to the legacy JWT pair so
     * this keeps working on an older CLI. */
    VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY || status.ANON_KEY,
    SUPABASE_SECRET_KEY: status.SECRET_KEY || status.SERVICE_ROLE_KEY,
  };
  if (!managed.VITE_SUPABASE_URL || !managed.SUPABASE_SECRET_KEY) {
    die("  `supabase status` did not report an API URL and a secret key.");
  }

  const extras = Object.entries(existing).filter(([k]) => !MANAGED_KEYS.includes(k));
  /* Retired by multi-league (`/l/<id>` chooses the league now) and still honoured, so
   * the bare http://localhost:5173 lands in the demo league instead of a chooser. */
  if (!existing.VITE_LEAGUE_NAME) extras.push(["VITE_LEAGUE_NAME", "Pigskin Poker (Demo League)"]);

  /* Local development reads the RECORDED feed by default (server/feed/fixture/), so a
   * pool refresh does the same thing on every machine and works with no network - and
   * so the demo league's seeded provenance cases mean something. Set it to `live` here
   * to check the real depth charts; the value is preserved across runs either way. It
   * cannot leak: server/feed/index.js refuses the fixture unless the database is local. */
  if (!existing.PIGSKIN_FEED) extras.push(["PIGSKIN_FEED", "fixture"]);

  const body =
    "# GENERATED by `npm run dev` from the running local Supabase stack.\n" +
    "# Local-only throwaway credentials. Git-ignored. Safe to delete - it is rewritten.\n" +
    "#\n" +
    "# SUPABASE_SECRET_KEY has NO VITE_ prefix on purpose: Vite inlines VITE_ variables\n" +
    "# into the browser bundle and this key bypasses RLS. Never rename it.\n\n" +
    Object.entries(managed).map(([k, v]) => k + "=" + v).join("\n") + "\n" +
    (extras.length ? "\n# Preserved from your existing .env.local\n" +
      extras.map(([k, v]) => k + "=" + v).join("\n") + "\n" : "");

  const changed = body !== existingText;
  fs.writeFileSync(ENV_PATH, body);
  say("  .env.local: " + (changed ? "written" : "already current"));
  return managed;
}

/* ------------------------------------------------------------------ data -- */

async function ensureSeeded(managed) {
  const { leagueId } = planAccounts();
  const db = createClient(managed.SUPABASE_URL, managed.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let needsReset = FORCE_RESET;
  if (!needsReset) {
    const { data, error } = await db.from("leagues").select("id").eq("id", leagueId).maybeSingle();
    /* An error here means no schema yet (fresh volume) as often as it means a real
     * fault, and a reset fixes both. */
    needsReset = !!error || !data;
  }

  if (needsReset) {
    step(FORCE_RESET ? "Resetting the database (--reset)" : "Database is empty - applying migrations and seeding");
    const r = sh("npx", ["supabase", "db", "reset"]);
    if (r.status !== 0) die("  `supabase db reset` failed. The output above says why.");
  } else {
    say("  database: demo league present (use `npm run dev -- --reset` to start over)");
    applyPendingMigrations();
  }

  await seedAccounts({ log: say });
}

/** Say which feed a pool refresh will read, because "why did nothing change?" is the
 * question a silent default produces. */
function sayFeed(managed) {
  const { feed, why } = feedChoice({ ...process.env, ...managed, PIGSKIN_FEED: readFeedSetting() });
  say("  feed: " + (feed === "fixture" ? "recorded fixture" : "LIVE nflverse") + " (" + why + ")");
}

/** Whatever .env.local now says - it was just written. */
function readFeedSetting() {
  const env = fs.existsSync(ENV_PATH) ? parseEnv(fs.readFileSync(ENV_PATH, "utf8")) : {};
  return env.PIGSKIN_FEED || "";
}

/**
 * Apply migrations that exist in the repo but not in the local database.
 *
 * THE CASE THIS EXISTS FOR: you pull, somebody else's branch added a migration, and
 * nothing tells you. The app then fails against a schema that is a version behind, and
 * it fails as a confusing runtime error rather than as "you are out of date". A reset
 * would fix it and would also throw away whatever you were in the middle of, so this
 * rolls forward instead - which is what forward-only migrations are for.
 */
function applyPendingMigrations() {
  const r = sh("npx", ["supabase", "migration", "list", "--local"], { capture: true });

  /* EVERY path below says what it decided, including the boring one.
   *
   * This used to return silently in three places, which meant "there was nothing to
   * apply" and "the check itself failed" looked identical from the outside - both were
   * a blank line between "demo league present" and "accounts ready". That ambiguity is
   * expensive exactly when it matters: a run that skipped a pending migration is
   * indistinguishable from a run that was up to date, the app then fails against a
   * schema a version behind, and the failure surfaces somewhere else entirely as
   * confusing test failures or 500s. Neither of the two swallowed cases is fatal - the
   * reset path and `db:reset` still work - so this reports and carries on rather than
   * dying. It just refuses to be silent about it. */

  if (r.status !== 0) {
    const how = r.error ? r.error.code : "exit " + r.status;
    say("  migrations: could not read the list (" + how + ") - skipping the check");
    const why = (r.stderr || "").trim().split("\n").pop();
    if (why) say("              " + why);
    say("              if the app misbehaves, `npm run dev -- --reset` starts clean");
    return;
  }

  let pending = [];
  try {
    const line = r.stdout.split("\n").find((l) => l.trim().startsWith("{"));
    pending = (JSON.parse(line).migrations ?? []).filter((m) => m.local && !m.remote);
  } catch (err) {
    /* An output format we do not recognise is not worth guessing at - but it is worth
     * naming, because it means this check has quietly stopped working. */
    say("  migrations: could not parse the list - skipping the check (" + err.message + ")");
    say("              if the app misbehaves, `npm run dev -- --reset` starts clean");
    return;
  }
  if (!pending.length) {
    say("  migrations: up to date");
    return;
  }

  step("Applying " + pending.length + " new migration(s) from the repo");
  for (const m of pending) say("    " + m.local);
  const up = sh("npx", ["supabase", "migration", "up", "--local"]);
  if (up.status !== 0) {
    die(
      "  A migration failed to apply. The output above says why.\n\n" +
      "  If your local database has drifted, start clean:\n\n" +
      "      npm run dev -- --reset"
    );
  }
}

/* ---------------------------------------------------------------- banner -- */

function banner(status) {
  const { leagueId, plan, unclaimed } = planAccounts();
  const mail = status.MAILPIT_URL || status.INBUCKET_URL || "http://127.0.0.1:54324";
  const managers = plan.filter((a) => a.role === "manager");
  const leagueUrl = "http://localhost:5173/l/" + leagueId;

  say(
    "\n" +
    "  ------------------------------------------------------------------\n" +
    "   Pigskin Poker - local development\n" +
    "  ------------------------------------------------------------------\n" +
    "   App        http://localhost:5173\n" +
    "   Mail       " + mail + "   (magic links land here)\n" +
    "   Studio     " + (status.STUDIO_URL || "http://127.0.0.1:54323") + "\n" +
    "\n" +
    "   SIGN IN WITH AN ACCOUNT - the production path\n" +
    "     Sign In on the front page. The link is PRINTED HERE the moment it is sent -\n" +
    "     no need to open the mail catcher. `npm run link -- --open` also works.\n" +
    "       " + COMMISSIONER_EMAIL + "   commissioner\n" +
    "       " + managers[0].email + "     manager, " + managers[0].teamName + "\n" +
    "       ... through " + managers[managers.length - 1].email + "\n" +
    "     Password for scripts and curl: " + DEV_PASSWORD + "\n" +
    "\n" +
    "   THE DEMO LEAGUE\n" +
    "     " + leagueUrl + "\n" +
    "\n" +
    "   TRY THE NEW-MEMBER PATH - one team is deliberately unclaimed\n" +
    "     Sign in as ANY address you like (nobody@pigskin.test), then\n" +
    "     \"I Have An Invite Code\" and paste:\n" +
    "       " + DEMO_INVITE_CODE + "   ->  " + (unclaimed ? unclaimed.name : "a team") + "\n" +
    "     Reissued on every start, so it works again after you redeem it.\n" +
    "  ------------------------------------------------------------------\n"
  );
}

/* ------------------------------------------------------------------ vite -- */

function runVite() {
  /* Resolved through vite's own package.json rather than `require.resolve` on the bin
   * script: Vite 6 has an `exports` map that does not expose ./bin, so resolving the
   * script directly throws ERR_PACKAGE_PATH_NOT_EXPORTED. Going via the manifest works
   * whatever the export map says, and finding the real file means the child is a plain
   * `node <script>` - no shell, no npx, and Ctrl-C reaches Vite directly. */
  const require = createRequire(import.meta.url);
  let bin;
  try {
    bin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
  } catch {
    die("  Vite is not installed. Run `npm install`.");
  }
  if (!fs.existsSync(bin)) die("  Found the vite package but not its bin script. Run `npm install`.");

  const child = spawn(process.execPath, [bin], { stdio: "inherit" });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
}

/* ------------------------------------------------------------------ main -- */

step("Checking Docker");
requireDocker();
say("  docker: running");

step("Checking the Supabase stack");
const status = ensureStack();

step("Writing .env.local");
const managed = writeEnvLocal(status);

step("Checking the demo league and development accounts");
await ensureSeeded(managed);
sayFeed(managed);

banner(status);

/* Watch the mailbox before Vite starts, so a link requested during startup is not
 * missed. It prints each new sign-in link to this console as it arrives. */
watchLinks({ log: say });

runVite();
