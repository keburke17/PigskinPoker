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
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { drain, enqueue, prefsFor, recipientsFor, setPrefs } from "../server/notify.js";

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

  const { data: period } = await db
    .from("periods").select("id").eq("league_id", leagueId).order("number").limit(1).maybeSingle();
  if (!period) {
    skipReason = "the demo league has no periods - run `npm run db:reset`";
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

async function accountFor(email) {
  const { data: created } = await db.auth.admin.createUser({
    email, password: "test-password-123", email_confirm: true,
  });
  const userId = created?.user?.id;
  if (userId) createdUserIds.push(userId);
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
