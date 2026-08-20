#!/usr/bin/env node
/* Pigskin Poker - LOCAL DEVELOPMENT ACCOUNTS.
 *
 * Seeds real Supabase Auth users into the local stack and gives each one a real
 * `league_members` row in the demo league.
 *
 * WHY THIS EXISTS
 * `supabase/seed.sql` can express the game and the join codes, but it cannot create an
 * account - so without this, local development could only ever exercise the join-code
 * half of `verifySession()`. Everything added from Phase 3b onwards - JWTs, memberships,
 * league-scoped RLS, invitations, multi-league - lived only in production and in tests.
 * That is the wrong way round: the newest code should be the easiest to run.
 *
 * WHY A SCRIPT RATHER THAN MORE SQL
 * Users live in Supabase's own `auth` schema and the supported way to make one is the
 * admin API. Hand-inserting into `auth.users` works right up until GoTrue changes a
 * column, and then it fails looking exactly like an application bug. `tests/rls.test.js`
 * already creates users with this same call, so this is a path the suite keeps honest.
 *
 * WHY THE ACCOUNTS ARE NOT FAKED IN THE APP
 * These are genuine users signing in through genuine Supabase Auth. Magic links are
 * captured by the local mail catcher instead of being sent, which is the only
 * difference from production. There is deliberately no "dev sign-in" bypass in the
 * client: a bypass is how a login path ends up unenforced in production.
 *
 * Idempotent - it runs on every `npm run dev`, and re-running changes nothing.
 *
 *   npm run seed:accounts
 */

import { createClient } from "@supabase/supabase-js";
import { createDemoLeague } from "../src/storage/demoLeague.js";
import { decomposeLeague } from "../src/storage/decompose.js";
import { hashInviteSecret, parseInviteCode } from "../server/invites.js";
import { loadEnvLocal, assertLocal, isLocalUrl } from "./local-env.mjs";

/* Local-only by construction: `.test` is reserved by RFC 2606 and can never resolve, so
 * these addresses cannot receive mail even by accident. The password exists so scripts
 * and curl can sign in without the mail round trip; the APP still uses magic links, the
 * same as production. */
export const DEV_PASSWORD = "pigskin-local-dev";
export const COMMISSIONER_EMAIL = "commish@pigskin.test";
export const managerEmail = (n) => "team" + n + "@pigskin.test";

/* THE LAST TEAM IS DELIBERATELY UNCLAIMED, and carries a standing invitation instead.
 *
 * Five seeded managers cover "sign in and play". None of them cover the path that every
 * real member now takes to get here for the first time: be sent a code, sign in with an
 * address nobody has seen before, redeem, and land on a team. That path had no way to be
 * tried locally without hand-issuing a code first, which is exactly the kind of setup
 * step that stops people from testing something.
 *
 * The code is FIXED rather than random so it can be printed in the banner and written in
 * the README. It uses the real alphabet and the real scrypt hashing - only its
 * unpredictability is given up, and only on a database that refuses to hold real data. */
export const UNCLAIMED_TEAM_INDEX = 6;
export const DEMO_INVITE_CODE = "PGSKN2-DEMTEAM234";
/* No O, I, L, U, 0 or 1 - the alphabet in server/invites.js excludes the confusable
 * characters, so a "memorable" code with an O in it is rejected. It is validated below
 * rather than trusted, because getting this wrong is easy and silent. */

/* The demo league's ids are derived, not random - so they can be computed here from the
 * SAME definition that generates seed.sql, rather than pasted out of it. Pasting is how
 * the two drift. */
function demoLeague() {
  const rows = decomposeLeague(createDemoLeague(), {
    leagueKey: "demo",
    year: 2026,
    hashCode: () => "unused-here",
  });
  return { leagueId: rows.leagues[0].id, teams: rows.teams };
}

/** The membership each seeded account should end up with. */
export function planAccounts() {
  const { leagueId, teams } = demoLeague();
  const plan = [
    {
      email: COMMISSIONER_EMAIL,
      displayName: "Demo Commissioner",
      role: "commissioner",
      teamId: null,
      teamName: null,
    },
  ];
  teams.forEach((t, i) => {
    if (i + 1 === UNCLAIMED_TEAM_INDEX) return; // left for the invite flow
    plan.push({
      email: managerEmail(i + 1),
      displayName: t.name + " manager",
      role: "manager",
      teamId: t.id,
      teamName: t.name,
    });
  });
  const unclaimed = teams[UNCLAIMED_TEAM_INDEX - 1] ?? null;
  return { leagueId, plan, unclaimed };
}

/**
 * @param {object}   [opts]
 * @param {Function} [opts.log]       where the one-line summary goes
 * @param {boolean}  [opts.optional]  return null instead of exiting when there is no
 *                                    local stack to seed. `npm test` uses this: it
 *                                    restores the accounts afterwards when a database
 *                                    is there, and says nothing at all when one is not.
 */
export async function seedAccounts({ log = console.log, optional = false } = {}) {
  const env = loadEnvLocal();
  const url = env.SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY;

  if (optional && (!isLocalUrl(url) || !secret)) return null;

  assertLocal(url, "Seeding development accounts");
  if (!secret) {
    console.error("\n  SUPABASE_SECRET_KEY is not set. Run `npm run dev`, which writes .env.local.\n");
    process.exit(1);
  }

  const db = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { leagueId, plan, unclaimed } = planAccounts();

  /* The league has to exist first. Seeding memberships into a database with no demo
   * league would half-succeed - users created, nothing to belong to - which is a more
   * confusing state than refusing. */
  const { data: league, error: leagueErr } = await db
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .maybeSingle();
  if (leagueErr) {
    if (optional) return null;
    console.error("\n  Could not read the leagues table: " + leagueErr.message +
      "\n  Is the local stack running and migrated? `npx supabase db reset`\n");
    process.exit(1);
  }
  if (!league) {
    if (optional) return null;
    console.error("\n  The demo league is not in this database yet.\n" +
      "  Run `npm run db:reset` (or `npm run dev`, which does it for you).\n");
    process.exit(1);
  }

  /* One listing rather than a lookup per account - the local user table is tiny, and
   * createUser on an existing address returns an error that is awkward to tell apart
   * from a real failure. */
  const existing = new Map();
  const { data: listed, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) {
    if (optional) return null;
    console.error("\n  Could not list auth users: " + listErr.message + "\n");
    process.exit(1);
  }
  for (const u of listed.users) existing.set((u.email || "").toLowerCase(), u.id);

  /* Memberships are counted separately from users because they disappear separately.
   * `npm test` resets the demo league, which cascades every membership away while the
   * auth users survive - so "7 already present" would be true and useless. */
  const { data: haveMembers } = await db
    .from("league_members").select("user_id").eq("league_id", leagueId);
  const memberOf = new Set((haveMembers ?? []).map((m) => m.user_id));

  let created = 0;
  let restored = 0;
  for (const acct of plan) {
    let userId = existing.get(acct.email);

    if (!userId) {
      const { data, error } = await db.auth.admin.createUser({
        email: acct.email,
        password: DEV_PASSWORD,
        /* Skips the confirmation mail. The magic-link path is still exercised whenever
         * you actually sign in through the app - this only means a freshly reset
         * database is usable without first clearing seven confirmation emails. */
        email_confirm: true,
        user_metadata: { display_name: acct.displayName },
      });
      if (error) {
        console.error("\n  Could not create " + acct.email + ": " + error.message + "\n");
        process.exit(1);
      }
      userId = data.user.id;
      created++;
    }

    const { error: pErr } = await db
      .from("profiles")
      .upsert({ user_id: userId, display_name: acct.displayName }, { onConflict: "user_id" });
    if (pErr) {
      console.error("\n  Could not write profile for " + acct.email + ": " + pErr.message + "\n");
      process.exit(1);
    }

    /* `unique (league_id, user_id)` is what makes this an upsert rather than a
     * check-then-insert, and it is the same guarantee that makes redeeming an invitation
     * twice a no-op in production. */
    const { error: mErr } = await db
      .from("league_members")
      .upsert(
        { league_id: leagueId, user_id: userId, role: acct.role, team_id: acct.teamId },
        { onConflict: "league_id,user_id" }
      );
    if (mErr) {
      console.error("\n  Could not write membership for " + acct.email + ": " + mErr.message + "\n");
      process.exit(1);
    }
    if (!memberOf.has(userId)) restored++;
  }

  /* The standing invitation for the unclaimed team. Re-created from scratch each run so
   * a reset - or a redemption during testing - leaves it usable again. */
  let invite = null;
  if (unclaimed) {
    const parsed = parseInviteCode(DEMO_INVITE_CODE);
    if (!parsed) {
      console.error("\n  DEMO_INVITE_CODE is not a valid invite code. Check the alphabet in server/invites.js.\n");
      process.exit(1);
    }
    await db.from("invites").delete().eq("league_id", leagueId).eq("code_ref", parsed.ref);
    const { error: invErr } = await db.from("invites").insert({
      league_id: leagueId,
      team_id: unclaimed.id,
      role: "manager",
      code_ref: parsed.ref,
      code_hash: hashInviteSecret(parsed.secret),
    });
    if (invErr) {
      if (optional) return null;
      console.error("\n  Could not create the demo invite: " + invErr.message + "\n");
      process.exit(1);
    }
    invite = { code: DEMO_INVITE_CODE, teamName: unclaimed.name };
  }

  log(
    "  accounts: " + plan.length + " ready" +
    (created ? " (" + created + " created)"
      : restored ? " (" + restored + " membership(s) restored)"
      : " (all already present)")
  );
  return { leagueId, plan, created, restored, invite };
}

/* Run directly, rather than imported by scripts/dev.mjs. */
if (process.argv[1] && process.argv[1].endsWith("seed-accounts.mjs")) {
  await seedAccounts();
}
