/**
 * The outbox, against the real local Postgres.
 *
 * Issue #57. What is proven here is the half tests/notify.test.js deliberately cannot
 * touch, and it is the half the issue warns is "most likely to be skipped and most
 * likely to hurt":
 *
 *   - ONE MESSAGE PER PERSON PER WEEK PER KIND, enforced by a unique key rather than by
 *     the job being careful. The hourly cycle is built so that a retried or duplicated
 *     run is harmless; that property does not survive contact with an email sender
 *     unless the database refuses the second row;
 *   - AN OPT-OUT IS HONOURED BEFORE A ROW IS EVEN WRITTEN;
 *   - THE SEND LOG IS NOT READABLE FROM A BROWSER. It is a record of who is in which
 *     league and what they were told, keyed on account ids.
 *
 * Skips itself when the local stack isn't running:  npx supabase start
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { drain, enqueue, notifyLeague, prefsFor, recipientsFor, setPrefs } from "../server/notify.js";
import * as ops from "../server/operations.js";
import { fetchLeagueRows, hydrate } from "../server/league.js";

const ENV = {
  /* No RESEND_API_KEY on purpose: the transport captures, so this suite exercises every
   * step up to the send without one line of mail leaving the machine. */
  NOTIFY_SIGNING_SECRET: "a-test-secret-long-enough-to-pass",
  SITE_URL: "https://pigskin.test",
  SUPABASE_URL: "http://127.0.0.1:54321",
};

let db, available = false, skipReason = "", leagueId = null, periodId = null;
let dbUrl = null, dbPublishable = null;
const createdUserIds = [];

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

  const { data: league, error } = await db
    .from("leagues").select("id").eq("name", "Pigskin Poker (Demo League)").maybeSingle();
  if (error || !league) {
    skipReason = "demo league not seeded - run `npx supabase db reset`";
    return;
  }
  leagueId = league.id;

  /* The migration that creates these tables is the thing being tested, and a stack
   * started before it was pulled has never seen it. That failure reads as a pile of
   * confusing assertion errors, so name it instead - CLAUDE.md has the whole story. */
  const { error: missing } = await db.from("notifications").select("id").limit(1);
  if (missing) {
    skipReason = "the notifications table is missing - run `npm run dev` or `npm run db:reset`";
    return;
  }

  /* A period belongs to a SEASON, not to a league - `periods.season_id` is the only
   * link, and asking for a league_id here silently returns nothing rather than an
   * error, which reads as "the seed is broken". */
  const { data: season } = await db
    .from("seasons").select("id").eq("league_id", leagueId).order("year", { ascending: false })
    .limit(1).maybeSingle();
  const { data: period } = season
    ? await db.from("periods").select("id").eq("season_id", season.id).order("number").limit(1).maybeSingle()
    : { data: null };
  if (!period) {
    skipReason = "the demo league has no season or periods - run `npm run db:reset`";
    return;
  }
  periodId = period.id;
  available = true;
}
await setup();
if (!available) {
  console.warn("\n[notifyDb.test.js] SKIPPED: " + skipReason + "\n  Run: npx supabase start && npm run db:reset\n");
}
const gate = () => (available ? describe : describe.skip);

/* The lifecycle reads `process.env` rather than the ENV object above - it is called
 * from deep inside an operation, not handed a config - so this file gives the process a
 * signing secret. There is still no RESEND_API_KEY, so the transport captures and
 * nothing leaves the machine. */
process.env.NOTIFY_SIGNING_SECRET = process.env.NOTIFY_SIGNING_SECRET || ENV.NOTIFY_SIGNING_SECRET;

/* Cached by address, and it has to be: `createUser` on an address that already exists
 * returns an ERROR rather than the existing user, so a second test asking for the same
 * manager used to get `undefined` back and then write a membership with no user on it.
 * The symptom was four unrelated assertions failing with empty results. */
const accountCache = new Map();
async function accountFor(email) {
  if (accountCache.has(email)) return accountCache.get(email);

  const { data: created, error } = await db.auth.admin.createUser({
    email, password: "test-password-123", email_confirm: true,
  });
  let userId = created?.user?.id;
  if (!userId) {
    /* Left behind by an earlier run that failed before its cleanup. Adopt it rather
     * than failing - it is deleted with the others at the end. */
    const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    userId = (list?.users ?? []).find((u) => u.email === email)?.id;
  }
  if (!userId) throw new Error("no test account for " + email + (error ? ": " + error.message : ""));

  createdUserIds.push(userId);
  accountCache.set(email, userId);
  return userId;
}

/** A manager of one of the demo league's teams, with an account behind them. */
async function managerOf(legacyId, email) {
  const { data: team } = await db
    .from("teams").select("id").eq("league_id", leagueId).eq("legacy_id", legacyId).maybeSingle();
  const userId = await accountFor(email);
  await db.from("league_members").upsert(
    { league_id: leagueId, user_id: userId, role: "manager", team_id: team.id },
    { onConflict: "league_id,user_id" }
  );
  return { userId, teamId: team.id };
}

const FACTS = (teamName) => ({
  teamName,
  periodLabel: "Week 1",
  recap: null,
  roster: ["QB - Somebody (BUF) at MIA"],
  deadline: "Schemes close Thursday 3am EST.",
});

const queueOne = (recipients, kind = "week_dealt") =>
  enqueue(db, { leagueId, periodId, kind, leagueName: "Demo", recipients, env: ENV });

async function clearOutbox() {
  await db.from("notifications").delete().eq("league_id", leagueId);
}

afterAll(async () => {
  if (!available) return;
  await clearOutbox();
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    await db.auth.admin.deleteUser(id).catch(() => {});
  }
});

gate()("the send log", () => {
  beforeEach(clearOutbox);

  it("writes one rendered row per manager", async () => {
    const one = await managerOf("demo_team_1", "notify-one@example.test");
    const two = await managerOf("demo_team_2", "notify-two@example.test");

    const out = await queueOne([
      { ...one, facts: FACTS("Team One") },
      { ...two, facts: FACTS("Team Two") },
    ]);
    expect(out.queued).toBe(2);

    const { data } = await db.from("notifications").select("*").eq("league_id", leagueId);
    expect(data).toHaveLength(2);
    /* The MESSAGE is stored, not the facts to rebuild it from: a retry an hour later
     * must send what this moment would have sent. */
    expect(data[0].payload.subject).toContain("Week 1");
    expect(data[0].payload.text).toContain("unsubscribe?t=");
    expect(data[0].status).toBe("pending");
    /* And no address anywhere in the row - auth.users owns those. */
    expect(JSON.stringify(data[0])).not.toContain("@example.test");
  });

  /* THE POINT OF THE WHOLE TABLE. The hourly cycle may run the same enqueue twice over
   * a deploy or a retry; the database is what makes the second one a no-op. */
  it("refuses a second row for the same person, week and kind", async () => {
    const one = await managerOf("demo_team_1", "notify-one@example.test");
    expect((await queueOne([{ ...one, facts: FACTS("Team One") }])).queued).toBe(1);
    expect((await queueOne([{ ...one, facts: FACTS("Team One") }])).queued).toBe(0);

    const { count } = await db
      .from("notifications").select("id", { count: "exact", head: true }).eq("league_id", leagueId);
    expect(count).toBe(1);
  });

  it("keeps the three kinds apart", async () => {
    const one = await managerOf("demo_team_1", "notify-one@example.test");
    await queueOne([{ ...one, facts: FACTS("Team One") }], "week_dealt");
    await enqueue(db, {
      leagueId, periodId, kind: "schemes_processed", leagueName: "Demo", env: ENV,
      recipients: [{ ...one, facts: { ...FACTS("Team One"), events: [], lock: "Locks Thursday." } }],
    });
    const { count } = await db
      .from("notifications").select("id", { count: "exact", head: true }).eq("league_id", leagueId);
    expect(count).toBe(2);
  });
});

gate()("who is owed a message", () => {
  beforeEach(clearOutbox);

  it("is every member with a team", async () => {
    await managerOf("demo_team_1", "notify-one@example.test");
    const { recipients } = await recipientsFor(db, leagueId, "week_dealt");
    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients.every((r) => r.teamId)).toBe(true);
  });

  /* Absence means yes: nothing writes a prefs row when somebody joins, so the table
   * only ever holds decisions people actually made. */
  it("defaults to on for somebody who has never opted out", async () => {
    const one = await managerOf("demo_team_1", "notify-one@example.test");
    const prefs = await prefsFor(db, [one.userId]);
    expect(prefs.byUser.get(one.userId)).toEqual({
      week_dealt: true, scheme_reminder: true, schemes_processed: true,
    });
  });

  it("drops somebody who turned that kind off, and only that kind", async () => {
    const one = await managerOf("demo_team_1", "notify-one@example.test");
    await setPrefs(db, one.userId, { week_dealt: false });

    const dealt = await recipientsFor(db, leagueId, "week_dealt");
    expect(dealt.recipients.some((r) => r.userId === one.userId)).toBe(false);

    const processed = await recipientsFor(db, leagueId, "schemes_processed");
    expect(processed.recipients.some((r) => r.userId === one.userId)).toBe(true);

    await db.from("notification_prefs").delete().eq("user_id", one.userId);
  });
});

gate()("draining it", () => {
  beforeEach(clearOutbox);

  /* A development machine captures rather than sends, and a capture is a SUCCESS - the
   * same way a league the cycle passed over is. What must not happen is a row left
   * pending forever, retried every hour against a transport that will never send. */
  it("marks a captured message as skipped rather than leaving it owed", async () => {
    const one = await managerOf("demo_team_1", "notify-one@example.test");
    const { ids } = await queueOne([{ ...one, facts: FACTS("Team One") }]);

    const out = await drain(db, { ids, env: ENV });
    expect(out).toMatchObject({ ok: true, skipped: 1, sent: 0 });

    const { data } = await db.from("notifications").select("status").in("id", ids);
    expect(data[0].status).toBe("skipped");

    /* And a second drain finds nothing owed, which is what stops the hourly job from
     * re-examining every message ever sent. */
    expect((await drain(db, { env: ENV })).why).toBe("nothing owed");
  });
});

/* ---------------------------------------------------------------------------
 * The hook, driven through the commissioner's own button.
 *
 * THE POINT IS THAT NOBODY WIRED IT TWICE. `runLifecycle` is the single path both the
 * button and the scheduled cycle take, so proving the button sends is proving the clock
 * sends - and a regression here is silent, because a deal that quietly tells nobody
 * still looks like a perfectly successful deal.
 *
 * EACH TEST STARTS FROM THE SEED and then does what a commissioner does: finalize the
 * week that is in `stats`, which opens the next one in `pre-deal`, then deal it. Forcing
 * a phase backwards instead looks like it works and is not the same thing - the week
 * keeps its activity log, and re-dealing it collides on the deal's own log entry.
 * --------------------------------------------------------------------------- */
const SEED_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "seed.sql"
);

let dbContainer = null;
async function resetDemo() {
  /* The demo seed refuses to run where other leagues exist - a deliberate safety on a
   * file that deletes and rebuilds. */
  if (leagueId) await db.from("leagues").delete().neq("id", leagueId);
  if (!dbContainer) {
    dbContainer = spawnSync("docker", ["ps", "--filter", "name=supabase_db_", "--format", "{{.Names}}"], {
      encoding: "utf8",
    }).stdout.trim().split("\n")[0];
  }
  const r = spawnSync(
    "docker",
    ["exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: readFileSync(SEED_PATH), stdio: ["pipe", "ignore", "pipe"], encoding: "utf8" }
  );
  if (r.status !== 0) throw new Error("resetDemo: seeding failed - " + (r.stderr || r.error));
}

async function setNotify(on) {
  await db.from("leagues").update({ notify_members: on }).eq("id", leagueId);
}

/* Memberships are minted after every reset, because the seed rebuilds the league row
 * and league_members cascades away with it. */
async function commissionerToken() {
  const userId = await accountFor("notify-commish@example.test");
  await db.from("league_members").upsert(
    { league_id: leagueId, user_id: userId, role: "commissioner", team_id: null },
    { onConflict: "league_id,user_id" }
  );
  const browser = createClient(dbUrl, dbPublishable, { auth: { persistSession: false } });
  const { data, error } = await browser.auth.signInWithPassword({
    email: "notify-commish@example.test", password: "test-password-123",
  });
  if (error) throw new Error("could not sign in the test commissioner: " + error.message);
  return data.session.access_token;
}

/** Finalize the seeded week and deal the next one, the way a commissioner would. */
async function finalizeAndDeal(token) {
  const fin = await ops.finalizePeriod(db, { leagueId, token });
  expect(fin.status).toBe(200);
  const dealt = await ops.dealPeriod(db, { leagueId, token, refresh: false });
  expect(dealt.status).toBe(200);
  return dealt;
}

const outboxCount = async () => {
  const { count } = await db
    .from("notifications").select("id", { count: "exact", head: true }).eq("league_id", leagueId);
  return count;
};

gate()("dealing a week tells the league", () => {
  beforeEach(async () => {
    await resetDemo();
    await clearOutbox();
  });

  it("queues a rendered message for each manager when the switch is on", async () => {
    await setNotify(true);
    const token = await commissionerToken();
    await managerOf("demo_team_1", "notify-one@example.test");

    await finalizeAndDeal(token);

    const { data } = await db
      .from("notifications").select("kind, payload").eq("league_id", leagueId);
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((n) => n.kind === "week_dealt")).toBe(true);
    /* The real roster, rendered - the join between the facts builder, the templates and
     * the lifecycle actually holding, rather than a placeholder. */
    expect(data[0].payload.text).toMatch(/QB - /);
    /* And last week's result rode along with it, which is why there is one email here
     * and not two. */
    expect(data[0].payload.text).toMatch(/Week 2 is final/);
  });

  /* DEFAULT OFF IS THE WHOLE SAFETY STORY. A league that never asked for email must not
   * start receiving it because we deployed something. */
  it("queues nothing at all when the switch is off", async () => {
    await setNotify(false);
    const token = await commissionerToken();
    await managerOf("demo_team_1", "notify-one@example.test");

    await finalizeAndDeal(token);
    expect(await outboxCount()).toBe(0);
  });

  /* A replayed hourly cycle, or a commissioner pressing twice: the second pass must
   * write nothing. The unique key is what guarantees it; this is the path that actually
   * exercises it. */
  it("does not tell anybody twice about the same week", async () => {
    await setNotify(true);
    const token = await commissionerToken();
    await managerOf("demo_team_1", "notify-one@example.test");

    await finalizeAndDeal(token);
    const first = await outboxCount();
    expect(first).toBeGreaterThan(0);

    const rows = await fetchLeagueRows(db, leagueId);
    const again = await notifyLeague(db, { rows, view: hydrate(rows), kind: "week_dealt", env: ENV });
    expect(again.status).toBe("skipped");
    expect(await outboxCount()).toBe(first);
  });

  /* A mail problem must never undo a week. By the time anything is sent the rosters are
   * dealt and the standings have moved. */
  it("leaves the week dealt even when the message cannot be built", async () => {
    await setNotify(true);
    const token = await commissionerToken();
    await managerOf("demo_team_1", "notify-one@example.test");

    /* No signing secret: nothing can carry an unsubscribe link, so nothing is sent -
     * and the week still has to happen. */
    const secret = process.env.NOTIFY_SIGNING_SECRET;
    delete process.env.NOTIFY_SIGNING_SECRET;
    try {
      const dealt = await finalizeAndDeal(token);
      expect(dealt.body.view.currentPeriod.phase).toBe("dealt");
      expect(await outboxCount()).toBe(0);
    } finally {
      if (secret) process.env.NOTIFY_SIGNING_SECRET = secret;
    }
  });

  it("tells everybody again when the schemes have run", async () => {
    await setNotify(true);
    const token = await commissionerToken();
    await managerOf("demo_team_1", "notify-one@example.test");

    await finalizeAndDeal(token);
    await clearOutbox();

    const processed = await ops.processSchemes(db, { leagueId, token });
    expect(processed.status).toBe(200);

    const { data } = await db
      .from("notifications").select("kind, payload").eq("league_id", leagueId);
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((n) => n.kind === "schemes_processed")).toBe(true);
    expect(data[0].payload.subject).toContain("set your lineup");
  });
});

gate()("what a browser can see", () => {
  /* The send log is server-only: RLS with no policy, and no grant to either browser
   * role. scripts/verify-grants.mjs asserts the same thing against the HOSTED project,
   * where every new table is born with GRANT ALL to anon. */
  it("cannot read the send log with the publishable key", async () => {
    const browser = createClient(dbUrl, dbPublishable, { auth: { persistSession: false } });
    const { data, error } = await browser.from("notifications").select("id").limit(1);
    expect(error || (data ?? []).length === 0).toBeTruthy();
    expect(data ?? []).toHaveLength(0);
  });

  it("cannot read anybody's preferences without signing in", async () => {
    const browser = createClient(dbUrl, dbPublishable, { auth: { persistSession: false } });
    const { data } = await browser.from("notification_prefs").select("user_id").limit(1);
    expect(data ?? []).toHaveLength(0);
  });
});
