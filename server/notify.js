/* The outbox: who gets told, what is written down, and what is actually sent.
 *
 * Issue #57, OQ-6. Three steps, and they are deliberately separate:
 *
 *   1. RECIPIENTS  - who, in this league, is owed this kind of message (pure-ish: one
 *                    query, then a rule)
 *   2. ENQUEUE     - render it and write one row per person, unique per (period, kind,
 *                    person). Nothing has been sent yet.
 *   3. DRAIN       - send whatever is owed, and record what happened.
 *
 * ---------------------------------------------------------------------------
 * WHY ENQUEUE AND SEND ARE NOT ONE STEP.
 *
 * Because a deal must not depend on an email provider. `runLifecycle` has already
 * rewritten the league's rows by the time anything is enqueued; if Resend is slow, rate
 * limited or down, the week has still happened and the commissioner is still waiting on
 * an HTTP response. Writing the rows is one local insert that either works or does not,
 * and everything after it is retryable from the hourly cycle that already runs.
 *
 * So: the caller enqueues, then asks for a drain, and IGNORES the result of the drain.
 * What it must not ignore is the enqueue, because a row that was never written is a
 * message nobody will ever notice is missing.
 * ---------------------------------------------------------------------------
 *
 * WHY A SKIP IS A SUCCESS, repeated from server/autoCycle.js because it applies here
 * twice over. A member who opted out, a league with email switched off, a development
 * machine with no key: none of those is a failure and none should colour a log line
 * red. The failures worth seeing are a provider that refused the message and an address
 * that does not exist.
 */

import { factsFor } from "./notifyFacts.js";
import { render } from "./email/templates.js";
import { sendEmail, siteUrl, transportChoice } from "./email/resend.js";
import { ALL, isSigningConfigured, listUnsubscribeHeaders, unsubscribeUrl } from "./email/unsubscribe.js";

/** The three kinds, and the `notification_prefs` column each one is switched by. */
export const KINDS = ["week_dealt", "scheme_reminder", "schemes_processed"];

/**
 * How many times a message is retried before it is left alone.
 *
 * Five hourly attempts is most of a day, which covers a provider outage and the free
 * plan's daily cap resetting. Past that the message is stale anyway - a reminder about
 * a deadline that has since passed is worse than silence - and a row that retries
 * forever is a row nobody ever looks at.
 */
export const MAX_ATTEMPTS = 5;

/** Absence means yes: somebody who has never opted out of anything has no row. */
const ALL_ON = { week_dealt: true, scheme_reminder: true, schemes_processed: true };

/* ------------------------------------------------------------ 1. who gets it -- */

/**
 * The managers of this league, with their team, for a given kind.
 *
 * A PERSON, NOT A TEAM. Two people sharing a team get one message each - they are two
 * inboxes - and the unique key is (period, kind, person) for exactly that reason. A
 * commissioner who also manages a team is a manager here like anybody else; a
 * commissioner with no team gets nothing, because every one of these three messages is
 * about a roster.
 *
 * OPT-OUTS ARE APPLIED HERE AS WELL AS AT SEND TIME. Here, so an opted-out member
 * leaves no row and the table stays a record of intent rather than of noise; at send
 * time as well, because the hourly drain may run long after the row was written and the
 * person may have clicked unsubscribe in between. The second check is the one that
 * actually protects the sending domain.
 */
export async function recipientsFor(db, leagueId, kind) {
  if (!KINDS.includes(kind)) throw new Error("unknown notification kind: " + kind);

  const { data: members, error } = await db
    .from("league_members")
    .select("user_id, team_id")
    .eq("league_id", leagueId)
    .not("team_id", "is", null);
  if (error) return { error: "Could not list members: " + error.message };

  const people = members ?? [];
  if (!people.length) return { recipients: [] };

  const prefs = await prefsFor(db, people.map((m) => m.user_id));
  if (prefs.error) return { error: prefs.error };

  return {
    recipients: people
      .filter((m) => prefs.byUser.get(m.user_id)[kind])
      .map((m) => ({ userId: m.user_id, teamId: m.team_id })),
  };
}

/** Everyone's switches, defaulted on. One query, keyed by user id. */
export async function prefsFor(db, userIds) {
  const ids = [...new Set(userIds)];
  const byUser = new Map(ids.map((id) => [id, { ...ALL_ON }]));
  if (!ids.length) return { byUser };

  const { data, error } = await db
    .from("notification_prefs")
    .select("user_id, week_dealt, scheme_reminder, schemes_processed")
    .in("user_id", ids);
  if (error) return { error: "Could not read notification preferences: " + error.message, byUser };

  for (const row of data ?? []) {
    byUser.set(row.user_id, {
      week_dealt: row.week_dealt,
      scheme_reminder: row.scheme_reminder,
      schemes_processed: row.schemes_processed,
    });
  }
  return { byUser };
}

/* -------------------------------------------------------------- 2. write it -- */

/**
 * Write one row per recipient, rendered and ready to send.
 *
 * RENDERED NOW, NOT AT SEND TIME. The retry an hour later must send what this moment
 * would have sent: by then the league may have been dealt again, a scheme may have been
 * resolved, and a message rebuilt from live rows would describe a different week. It
 * also means a message somebody says they never got can be read back exactly as it was.
 *
 * DUPLICATES ARE NOT AN ERROR. `ignoreDuplicates` turns the unique key into the thing
 * that makes a replayed cycle harmless - the second enqueue for the same (period, kind,
 * person) simply writes nothing. That is the property issue #57 asks for in so many
 * words, and it is enforced by the database rather than by this function being careful.
 *
 * @param {object[]} recipients  [{ userId, teamId, facts }] - facts as templates.js wants
 * @returns {Promise<{queued: number, ids: string[]} | {error: string}>}
 */
export async function enqueue(db, { leagueId, periodId, kind, leagueName, recipients, env = process.env }) {
  if (!KINDS.includes(kind)) throw new Error("unknown notification kind: " + kind);
  if (!recipients?.length) return { queued: 0, ids: [] };

  const site = siteUrl(env);
  const rows = [];
  for (const r of recipients) {
    /* The footer's two links are per person - they carry a signed token naming them -
     * so rendering cannot happen once for the league. */
    const facts = {
      ...r.facts,
      leagueName,
      site,
      unsubscribeUrl: unsubscribeUrl(site, r.userId, kind, env),
      unsubscribeAllUrl: unsubscribeUrl(site, r.userId, ALL, env),
    };
    rows.push({
      league_id: leagueId,
      period_id: periodId,
      kind,
      user_id: r.userId,
      team_id: r.teamId ?? null,
      payload: render(kind, facts),
    });
  }

  const { data, error } = await db
    .from("notifications")
    .upsert(rows, { onConflict: "period_id,kind,user_id", ignoreDuplicates: true })
    .select("id");
  if (error) return { error: "Could not queue notifications: " + error.message };

  const ids = (data ?? []).map((row) => row.id);
  return { queued: ids.length, ids };
}

/* --------------------------------------------------------------- 3. send it -- */

/**
 * Send what is owed.
 *
 * Called twice over, on purpose:
 *
 *   - immediately after an enqueue, with the ids just written, so a deal on a Tuesday
 *     morning reaches people while it is still Tuesday morning;
 *   - from the hourly cycle with no ids at all, which picks up anything the first
 *     attempt could not deliver - a cold start, a 429, a provider having a bad hour.
 *
 * NEVER THROWS, and never reports a failure the caller should act on: what it returns
 * is a count, for a log line. The place a failure lives is the row.
 *
 * @param {string[]|null} ids  restrict to these rows, or null for everything owed
 */
export async function drain(db, { ids = null, limit = 50, env = process.env } = {}) {
  let query = db
    .from("notifications")
    .select("id, user_id, kind, payload, attempts")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (ids) query = query.in("id", ids);

  const { data, error } = await query;
  if (error) return { ok: false, sent: 0, skipped: 0, failed: 0, why: "Could not read the outbox: " + error.message };

  const owed = data ?? [];
  if (!owed.length) return { ok: true, sent: 0, skipped: 0, failed: 0, why: "nothing owed" };

  /* Checked once for the whole drain rather than per row: it is the same answer every
   * time, and it is the single most useful thing in the log line when mail is missing. */
  const transport = transportChoice(env);
  const prefs = await prefsFor(db, owed.map((n) => n.user_id));

  const site = siteUrl(env);
  let sent = 0, skipped = 0, failed = 0;

  for (const row of owed) {
    /* The second opt-out check. The first one ran when the row was written, which may
     * have been days ago in a league nobody finalized. */
    if (prefs.byUser.get(row.user_id)?.[row.kind] === false) {
      await mark(db, row, { status: "skipped", why: "the member has turned this email off" });
      skipped += 1;
      continue;
    }

    const who = await addressOf(db, row.user_id);
    if (!who.email) {
      /* A member with no address is a real state - an account deleted out from under a
       * membership - and it is permanent, so it is a skip rather than a retry. */
      await mark(db, row, { status: "skipped", why: who.why });
      skipped += 1;
      continue;
    }

    const result = await sendEmail(
      {
        to: who.email,
        subject: row.payload.subject,
        text: row.payload.text,
        html: row.payload.html,
        headers: listUnsubscribeHeaders(site, row.user_id, row.kind, env),
      },
      { idempotencyKey: row.id, env }
    );

    if (result.ok && result.skipped) {
      await mark(db, row, { status: "skipped", why: result.why });
      skipped += 1;
    } else if (result.ok) {
      await mark(db, row, { status: "sent", why: result.why, providerId: result.id });
      sent += 1;
    } else if (result.retryable && row.attempts + 1 < MAX_ATTEMPTS) {
      /* Left as `pending` with the attempt counted, so the next hourly drain tries
       * again and the row still reads as owed rather than as abandoned. */
      await mark(db, row, { status: "pending", why: result.why, count: true });
      failed += 1;
    } else {
      await mark(db, row, { status: "failed", why: result.why, count: true });
      failed += 1;
    }
  }

  return {
    ok: failed === 0,
    sent,
    skipped,
    failed,
    why: transport.mode === "capture" ? "not sending: " + transport.why : transport.why,
  };
}

/** One row's outcome, written down. Errors here are logged, never thrown. */
async function mark(db, row, { status, why, providerId = null, count = false }) {
  const patch = {
    status,
    last_error: status === "sent" ? null : why,
    attempts: count ? row.attempts + 1 : row.attempts + (status === "sent" ? 1 : 0),
  };
  if (status === "sent") {
    patch.sent_at = new Date().toISOString();
    patch.provider_id = providerId;
  }
  const { error } = await db.from("notifications").update(patch).eq("id", row.id);
  if (error) console.error("[notify] could not record the outcome of", row.id, "-", error.message);
}

/**
 * Somebody's email address, from auth.users.
 *
 * READ AT SEND TIME, never stored here. Addresses belong to the auth provider - the
 * same reason `profiles` does not keep one - and reading it late means a person who
 * corrected their address gets the retry rather than a second failure.
 */
async function addressOf(db, userId) {
  try {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error) return { email: null, why: "no address on file: " + error.message };
    const email = data?.user?.email ?? null;
    return email ? { email, why: "" } : { email: null, why: "this account has no email address" };
  } catch (e) {
    return { email: null, why: "could not read the account: " + (e?.message ?? String(e)) };
  }
}

/* ------------------------------------------------- what the lifecycle calls -- */

/**
 * Tell this league's managers that something happened to their week.
 *
 * THE ONE ENTRY POINT FROM `runLifecycle`, which is the single path both the
 * commissioner's buttons and the scheduled cycle take. That is the whole design: the
 * clock cannot send a message the button does not, because neither of them sends
 * anything - the step they share does.
 *
 * NEVER THROWS, AND NEVER FAILS THE WEEK. By the time this runs the deal has happened,
 * the rows are written and the standings have moved; an email provider having a bad
 * morning must not turn that into a 500 on the commissioner's screen. Everything that
 * goes wrong is logged and left in a row for the hourly drain to retry.
 *
 * @param {object} rows  the freshly-read league rows, for the league row and the teams
 * @param {object} view  the freshly-hydrated view - the same one the caller returns
 * @returns {Promise<{status: string, why: string, queued?: number}>} for a log line
 */
export async function notifyLeague(db, {
  rows,
  view,
  kind,
  env = process.env,
  now = Date.now(),
  /* Team UUIDs to leave out. Issue #57's reminder is the only caller: it goes ONLY to
   * managers with nothing on file, because a reminder to somebody who has already
   * picked is noise, and noise is how a league starts filtering the sender. */
  skipTeamIds = null,
  /* Anything the facts builder needs that the view cannot know - today just how many
   * hours are left before the deadline. */
  extra = {},
}) {
  try {
    const league = rows?.leagues?.[0];
    if (!league) return { status: "skipped", why: "no league row" };
    /* Default false, and this is where that default does its work: a league that never
     * asked for email is one query away from finding out, and no rows are written. */
    if (!notifyEnabled(league)) return { status: "skipped", why: "league email is off" };

    const periodId = view?._meta?.periodId;
    if (!periodId) return { status: "skipped", why: "no current week" };

    /* CHECKED UP FRONT, because every message's footer carries a signed unsubscribe
     * link and minting one without the secret throws. Left to fail per recipient it
     * surfaced as a stack trace in a function log, once per manager, with no row
     * written and nothing retried - a misconfiguration that silently loses league mail
     * is precisely the failure mode docs/EMAIL-SETUP.md exists to prevent. This is a
     * FAILURE rather than a skip so it shows up in the caller's log line: a league with
     * email switched on and no way to let anybody turn it off must be fixed, not
     * quietly tolerated. */
    if (!isSigningConfigured(env)) {
      return { status: "failed", why: "NOTIFY_SIGNING_SECRET is not set - no message can carry an unsubscribe link" };
    }

    const { recipients, error } = await recipientsFor(db, league.id, kind);
    if (error) return { status: "failed", why: error };
    if (!recipients.length) return { status: "skipped", why: "nobody to tell" };

    /* league_members holds team UUIDs; the whole view is written against legacy ids. */
    const legacyOf = new Map((rows.teams ?? []).map((t) => [t.id, t.legacy_id]));

    const skip = skipTeamIds ? new Set(skipTeamIds) : null;

    const withFacts = [];
    for (const r of recipients) {
      if (skip?.has(r.teamId)) continue;
      const teamId = legacyOf.get(r.teamId);
      if (!teamId) continue;
      const facts = factsFor(kind, view, teamId, now, extra);
      /* Null means this team has nothing to be told - not dealt into this period, which
       * in the playoffs means knocked out. Issue #57: they hear nothing further. */
      if (!facts) continue;
      withFacts.push({ userId: r.userId, teamId: r.teamId, facts });
    }
    if (!withFacts.length) return { status: "skipped", why: "no team in this week has a manager to tell" };

    const queued = await enqueue(db, {
      leagueId: league.id,
      periodId,
      kind,
      leagueName: view.leagueName || league.name,
      recipients: withFacts,
      env,
    });
    if (queued.error) return { status: "failed", why: queued.error };
    if (!queued.queued) return { status: "skipped", why: "already sent for this week" };

    /* Sent now so a Tuesday morning deal reaches people on Tuesday morning; anything
     * that does not go out is picked up by the hourly cycle. The result is logged
     * rather than returned as a failure - see the note at the top. */
    const sent = await drain(db, { ids: queued.ids, env });
    if (!sent.ok) console.error("[notify]", kind, "for", league.name, "-", sent.failed, "failed:", sent.why);

    return { status: "queued", why: sent.why, queued: queued.queued };
  } catch (e) {
    /* A crash here would roll a successful deal back into a 500. */
    console.error("[notify] unexpected while telling the league about", kind, "-", e?.stack || e);
    return { status: "failed", why: "unexpected: " + (e?.message ?? String(e)) };
  }
}

/* ------------------------------------------------------------- the switches -- */

/** Does this league send email at all? Default false; the commissioner turns it on. */
export function notifyEnabled(league) {
  return Boolean(league?.notify_members);
}

/**
 * Turn a kind off for one person - the unsubscribe endpoint's only write.
 *
 * Upsert rather than update: absence means yes, so the first opt-out is also the first
 * time this person has a row at all.
 */
export async function setPrefs(db, userId, patch) {
  const { error } = await db
    .from("notification_prefs")
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return { error: "Could not save that preference: " + error.message };
  return { ok: true };
}
