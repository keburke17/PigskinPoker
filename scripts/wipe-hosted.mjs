#!/usr/bin/env node
/* Pigskin Poker - WIPE THE HOSTED LEAGUE DATA.
 *
 *   npm run db:wipe
 *
 * The one-time cutover from "everything in there is test data" to "everything in there
 * is a season people are playing". It deletes every league and (unless told otherwise)
 * every account, leaves the schema exactly as the migrations built it, and leaves the
 * two things that are configuration rather than data: `site_admins` and `player_pool`.
 *
 * WHY A SCRIPT AND NOT A LINE IN THE SQL EDITOR
 * Because `delete from leagues;` is a correct answer that is also a loaded gun. The
 * whole value here is in what surrounds it: showing what is about to die BEFORE asking,
 * refusing to run against the local stack (where `db:reset` is the right tool), refusing
 * to run without a typed project ref, and saying afterwards what still has to be done by
 * hand. None of that survives being remembered.
 *
 * WHY NOT `supabase db reset --linked`
 * That rebuilds the hosted schema from the migrations, which sounds like the more
 * thorough answer and is the more dangerous one. Three reasons it is not used here:
 *
 *   1. It runs `supabase/seed.sql` unless you remember `--no-seed`, and on a database it
 *      has just emptied the seed's safety guard passes - so the obvious invocation
 *      plants the six-team DEMO LEAGUE into production and reports success.
 *   2. Rebuilding-from-migrations is already proven every single day. `npm run db:reset`
 *      does exactly that locally, and `npm test` runs against the result. There is
 *      nothing left to learn from doing it to the live project.
 *   3. It re-creates every table, and on hosted Supabase a newly created table is born
 *      with GRANT ALL to `anon`. That is the failure mode
 *      `20260818020000_revoke_default_grants.sql` exists for. Deleting rows cannot
 *      reintroduce it; recreating tables can.
 *
 * The schema is not the thing that is wrong. The data is.
 *
 * WHAT IT DELETES
 *   leagues            -> and, by ON DELETE CASCADE, everything below it: seasons,
 *                         teams, team_totals, players, periods, roster_slots,
 *                         stat_lines, schemes, period_results, events, league_members,
 *                         invites. One statement, because the foreign keys already
 *                         encode the shape of the graph and a hand-written order would
 *                         only ever be a worse copy of it.
 *   auth.users         -> every account, through the admin API (profiles cascade).
 *                         Skipped with --keep-accounts.
 *
 * WHAT IT LEAVES, ON PURPOSE
 *   site_admins        -> keyed on EMAIL, not user_id. Deleting the accounts does not
 *                         demote anybody; they sign in again and are still admins.
 *   player_pool        -> the TEMPLATE every new league is copied from. It is repo
 *                         state (a migration built it), not league data. Refresh it by
 *                         writing a new migration - see the notes this prints at the end.
 *
 * FLAGS
 *   --dry-run          show the inventory and stop. Nothing is deleted.
 *   --keep-accounts    leave auth.users alone. Sign-ins keep working; everybody still
 *                      loses their membership rows with the league, so they land on
 *                      "You are not in a league yet" until re-invited.
 *   --yes              skip the typed confirmation. For a second run, not a first.
 *
 * CREDENTIALS
 * Environment first, `.env.local` second - the same precedence as verify:email. The
 * intended invocation does not disturb `.env.local` at all:
 *
 *   SUPABASE_URL=https://YOUR_REF.supabase.co \
 *   SUPABASE_SECRET_KEY=sb_secret_... \
 *   npm run db:wipe
 */

import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, isLocalUrl } from "./local-env.mjs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const KEEP_ACCOUNTS = args.includes("--keep-accounts");
const ASSUME_YES = args.includes("--yes");

const say = (s) => console.log(s);
const die = (msg) => {
  console.error("\n" + msg + "\n");
  process.exit(1);
};

/* ----------------------------------------------------------------- target -- */

const env = loadEnvLocal();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  die(
    "  Missing SUPABASE_URL or SUPABASE_SECRET_KEY.\n\n" +
    "  Both are in the Supabase dashboard under Settings -> API Keys. Pass them on the\n" +
    "  command line rather than editing .env.local, so your local stack stays wired up:\n\n" +
    "      SUPABASE_URL=https://YOUR_REF.supabase.co \\\n" +
    "      SUPABASE_SECRET_KEY=sb_secret_... \\\n" +
    "      npm run db:wipe"
  );
}

/* THE MIRROR IMAGE OF `assertLocal`. Every other script in this directory refuses to
 * touch anything but the local stack; this one refuses to touch the local stack. Running
 * it there would work and would be the wrong tool - `npm run db:reset` rebuilds local
 * from the migrations AND re-seeds the demo league, which this deliberately does not. */
if (isLocalUrl(url)) {
  die(
    "  REFUSING: " + url + " is the LOCAL stack.\n\n" +
    "  This command is for the hosted project. To start local over:\n\n" +
    "      npm run db:reset"
  );
}

/* The ref is the first label of the project hostname - wzzrxoslcwpyopdvvxmn in
 * https://wzzrxoslcwpyopdvvxmn.supabase.co. It is what the operator has to type back,
 * so a wipe cannot be confirmed by a reflex `y`. */
const ref = new URL(url).hostname.split(".")[0];

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* -------------------------------------------------------------- inventory -- */

async function countOf(table, apply = (q) => q) {
  const { count, error } = await apply(db.from(table).select("*", { count: "exact", head: true }));
  if (error) throw new Error(table + ": " + error.message);
  return count ?? 0;
}

/** Every account, paged - listUsers caps a page and silently returns the first one. */
async function allUsers() {
  const out = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error("auth.users: " + error.message);
    const users = data?.users ?? [];
    out.push(...users);
    if (users.length < 200) return out;
  }
}

async function inventory() {
  const { data: leagues, error } = await db
    .from("leagues")
    .select("id, name, created_at")
    .order("created_at");
  if (error) throw new Error("leagues: " + error.message);

  const users = await allUsers();

  const rows = [];
  for (const l of leagues) {
    rows.push({
      ...l,
      teams: await countOf("teams", (q) => q.eq("league_id", l.id)),
      members: await countOf("league_members", (q) => q.eq("league_id", l.id)),
    });
  }

  return {
    leagues: rows,
    users,
    /* Not per-league: these are the totals that go with them, and the point of showing
     * them is the size of the blast radius, not its distribution. */
    periods: await countOf("periods"),
    finalized: await countOf("periods", (q) => q.eq("phase", "finalized")),
    events: await countOf("events"),
    invites: await countOf("invites"),
    /* Kept. Counted anyway, so "it left them alone" is something you can see rather than
     * something this file claims. */
    admins: await countOf("site_admins"),
    pool: await countOf("player_pool"),
  };
}

function report(inv) {
  say("\n  TARGET  " + url);
  say("  ref     " + ref + "\n");

  say("  WILL BE DELETED");
  if (!inv.leagues.length) {
    say("    (no leagues)");
  } else {
    for (const l of inv.leagues) {
      say(
        "    league  " + l.name +
        "  (" + l.teams + " team(s), " + l.members + " member(s))" +
        "  created " + String(l.created_at).slice(0, 10)
      );
      say("            " + l.id);
    }
  }
  say("    periods       " + inv.periods + "   of which FINALIZED: " + inv.finalized);
  say("    events        " + inv.events);
  say("    invites       " + inv.invites);
  say(
    "    accounts      " + inv.users.length +
    (KEEP_ACCOUNTS ? "   KEPT (--keep-accounts)" : "")
  );
  if (!KEEP_ACCOUNTS && inv.users.length) {
    for (const u of inv.users.slice(0, 12)) say("                  " + u.email);
    if (inv.users.length > 12) say("                  ... and " + (inv.users.length - 12) + " more");
  }

  say("\n  WILL BE LEFT ALONE");
  say("    site_admins   " + inv.admins + " row(s)   keyed on email, so admin survives a wipe");
  say("    player_pool   " + inv.pool + " row(s)   the template new leagues are copied from");
  say("    schema        every table, index, policy and grant as the migrations built it");

  /* The one number worth stopping on. Everything else here is recoverable by playing the
   * season again; a finalized week is a result somebody was told about. */
  if (inv.finalized > 0) {
    say(
      "\n  NOTE  " + inv.finalized + " period(s) are FINALIZED - weeks that were scored and\n" +
      "        published. If any of those are real results rather than test runs, stop."
    );
  }
}

/* ------------------------------------------------------------------ wipe -- */

async function wipe() {
  say("\n> Deleting leagues (cascades through the whole league graph)");
  /* PostgREST refuses an unfiltered DELETE, which is a good rule that this is the
   * legitimate exception to. `not id is null` is the narrowest way to say "all of them"
   * and is deliberately obvious about it. */
  const { error } = await db.from("leagues").delete().not("id", "is", null);
  if (error) die("  Deleting leagues failed: " + error.message);
  say("  leagues: gone");

  if (KEEP_ACCOUNTS) {
    say("\n> Accounts kept (--keep-accounts)");
  } else {
    say("\n> Deleting accounts");
    const users = await allUsers();
    let n = 0;
    for (const u of users) {
      const { error: delErr } = await db.auth.admin.deleteUser(u.id);
      /* Report and carry on. A single account that will not delete is worth naming, and
       * is not a reason to leave the other forty in place. */
      if (delErr) say("  could not delete " + u.email + ": " + delErr.message);
      else n++;
    }
    say("  accounts deleted: " + n + " of " + users.length);
  }
}

/* ---------------------------------------------------------------- confirm -- */

async function confirm() {
  if (ASSUME_YES) return true;
  if (!stdin.isTTY) {
    die(
      "  Not a terminal, so the confirmation cannot be typed.\n\n" +
      "  Re-run interactively, or pass --yes if you are certain."
    );
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(
    "\n  This cannot be undone. There is no backup unless you took one.\n" +
    "  Type the project ref (" + ref + ") to proceed, or anything else to stop: "
  );
  rl.close();
  return answer.trim() === ref;
}

/* ------------------------------------------------------- what happens next -- */

const NEXT_STEPS =
  "\n" +
  "  ------------------------------------------------------------------\n" +
  "   The hosted database is empty of league data. NOTHING ELSE HAPPENED\n" +
  "   automatically - these are the steps that make it a season:\n" +
  "  ------------------------------------------------------------------\n" +
  "\n" +
  "   1. Sign in at https://pigskin.ballsohard.org and press Create A\n" +
  "      League. Whoever creates it is its commissioner. There is no\n" +
  "      bootstrap script and no code to type.\n" +
  "\n" +
  "   2. Commissioner -> Player Pool -> REFRESH PLAYER POOL, before dealing.\n" +
  "      Creating a league copies `player_pool`, which is the depth charts as\n" +
  "      of the migration that built it - stale by definition. One button\n" +
  "      reconciles this league against the live feed: adds, retires, and\n" +
  "      updates injury status. It is only allowed in `pre-deal`, so do it\n" +
  "      before Week 1 is dealt.\n" +
  "\n" +
  "      Regenerating the TEMPLATE is a separate, optional job - it only\n" +
  "      affects leagues created later, and it is a migration:\n" +
  "          PIGSKIN_FEED=live npm run pool:sql:feed && npm run db:push\n" +
  "\n" +
  "   3. Add the teams, then Commissioner -> Invite each manager. An\n" +
  "      account nobody invited is nobody.\n" +
  "\n" +
  "   4. Decide the two per-league settings, because both default and the\n" +
  "      defaults are not announced anywhere:\n" +
  "        - lineup lock: `gametime` (each player at his own kickoff) or\n" +
  "          `weekly` (everybody at the week's first).\n" +
  "        - auto_pull_stats: off unless you turn it on.\n" +
  "\n" +
  "   5. `npm run db:backup` before Week 1 kicks off. There is no undo on\n" +
  "      this database and the free tier takes no snapshots for you.\n" +
  "  ------------------------------------------------------------------\n";

/* ------------------------------------------------------------------ main -- */

/* Everything below talks to a database over the network, and every failure there is
 * worth a sentence rather than a stack trace - the likeliest ones are a mistyped ref and
 * a secret key from the wrong project, both of which read as "fetch failed" or a bare
 * 401 if this is left to Node. */
async function main() {
  const inv = await inventory();
  report(inv);

  if (DRY_RUN) {
    say("\n  --dry-run: nothing was deleted.\n");
    return 0;
  }

  if (!(await confirm())) {
    say("\n  Stopped. Nothing was deleted.\n");
    return 1;
  }

  await wipe();

  const after = await inventory();
  say("\n> Verifying");
  say("  leagues remaining   " + after.leagues.length);
  say("  accounts remaining  " + after.users.length);
  say("  site_admins         " + after.admins + "   (untouched)");
  say("  player_pool         " + after.pool + "   (untouched)");
  say(NEXT_STEPS);
  return 0;
}

try {
  process.exit(await main());
} catch (err) {
  die(
    "  " + err.message + "\n\n" +
    "  Target was " + url + "\n" +
    "  A network failure here usually means the ref is wrong; a 401 or an empty result\n" +
    "  usually means SUPABASE_SECRET_KEY belongs to a different project."
  );
}

