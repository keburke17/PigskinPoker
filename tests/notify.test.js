/**
 * League email, everything that can be proven without a database or a network.
 *
 * Issue #57. The three things this file is actually guarding:
 *
 *   1. EVERY MESSAGE CARRIES ITS OWN OFF SWITCH. A league email that cannot be stopped
 *      becomes a spam complaint against the sending domain, and that domain also carries
 *      the magic links that are the only way into this app. So "the footer has a working
 *      unsubscribe link" is not a cosmetic assertion.
 *   2. A DEVELOPMENT MACHINE NEVER SENDS. The gate in server/email/resend.js is the
 *      reason nobody can mail twelve real people by replaying a season locally, and a
 *      gate nobody tests is a gate someone deletes.
 *   3. A FAILED SEND IS RECORDED, NOT LOST. The retry rules decide whether a message
 *      arrives an hour late or never, and they are the part of this feature most likely
 *      to be wrong in a way nobody notices.
 *
 * The database half - enqueue, dedupe, the unique key - is in tests/notifyDb.test.js,
 * which needs the local stack.
 */

import { describe, it, expect, vi } from "vitest";
import { render, renderWeekDealt, renderSchemeReminder, renderSchemesProcessed, esc } from "../server/email/templates.js";
import { transportChoice, sendEmail, siteUrl } from "../server/email/resend.js";
import {
  ALL,
  KINDS,
  kindWords,
  listUnsubscribeHeaders,
  mintToken,
  prefUpdateFor,
  readToken,
  unsubscribeUrl,
} from "../server/email/unsubscribe.js";
import { drain, notifyEnabled, MAX_ATTEMPTS } from "../server/notify.js";

const ENV = {
  NOTIFY_SIGNING_SECRET: "a-secret-long-enough-to-be-accepted",
  SUPABASE_URL: "https://project.supabase.co",
  RESEND_API_KEY: "re_test",
  NOTIFY_FROM: "Pigskin Poker <league@notify.example.org>",
};

const FACTS = {
  teamName: "Gridiron Gamblers",
  leagueName: "Ball So Hard League",
  site: "https://pigskin.example.org",
  unsubscribeUrl: "https://pigskin.example.org/unsubscribe?t=tok",
  unsubscribeAllUrl: "https://pigskin.example.org/unsubscribe?t=all",
  periodLabel: "Week 7",
};

describe("what the emails say", () => {
  it("puts last week's finish and the new roster in one message", () => {
    const m = renderWeekDealt({
      ...FACTS,
      recap: {
        periodLabel: "Week 6",
        rank: 3,
        teamCount: 6,
        standingsPoints: 4,
        rawScore: 96.4,
        best: { name: "Bijan Robinson", points: "24.1" },
      },
      roster: ["QB - Jalen Hurts (PHI) at NYG"],
      deadline: "Schemes close Thursday 3am EST.",
    });
    expect(m.subject).toContain("Week 7");
    expect(m.text).toContain("Week 6 is final");
    expect(m.text).toContain("3rd of 6");
    expect(m.text).toContain("4 standings points");
    expect(m.text).toContain("Jalen Hurts");
    expect(m.html).toContain("Jalen Hurts");
  });

  /* Week 1, and any league whose previous week nobody finalized. An empty recap line
   * reads as "you finished nowhere", which is worse than not mentioning it. */
  it("says nothing about last week when there was no last week", () => {
    const m = renderWeekDealt({ ...FACTS, recap: null, roster: [], deadline: "Ask your commissioner." });
    expect(m.text).not.toContain("is final");
    expect(m.subject).toContain("Week 7");
  });

  /* The deadline sentence is handed in, never composed here, precisely so a league that
   * has not switched the clock on is never told that 3am Thursday is a deadline. */
  it("repeats the deadline it was handed, whatever it says", () => {
    const hand = "Your commissioner will process schemes when everyone is in.";
    const m = renderWeekDealt({ ...FACTS, recap: null, roster: [], deadline: hand });
    expect(m.text).toContain(hand);
    expect(m.html).toContain("commissioner will process schemes");
    expect(m.text).not.toContain("3am");
  });

  it("nudges without telling anybody off, and says what silence costs", () => {
    const m = renderSchemeReminder({ ...FACTS, hoursLeft: 12, deadline: "schemes close Thursday 3am EST." });
    expect(m.subject).toContain("12 hours");
    expect(m.subject).toContain("Gridiron Gamblers");
    expect(m.text).toContain("runs as it was dealt");
    /* No Action is a legitimate decision, so the message has to leave room for it. */
    expect(m.text).toContain("If that is what you wanted, ignore this");
  });

  it("tells you what the schemes did and when your lineup locks", () => {
    const m = renderSchemesProcessed({
      ...FACTS,
      events: ["Puka Nacua was stolen by Team Chaos."],
      lock: "Each player locks at his own kickoff.",
    });
    expect(m.text).toContain("Puka Nacua was stolen");
    expect(m.text).toContain("locks at his own kickoff");
    expect(m.subject).toContain("set your lineup");
  });

  it("says so plainly when the schemes moved nothing", () => {
    const m = renderSchemesProcessed({ ...FACTS, events: [], lock: "Everything locks Thursday." });
    expect(m.text).toContain("Nothing moved on or off");
  });

  /* Team names are typed by people and land in markup. */
  it("escapes what people typed", () => {
    const m = renderSchemesProcessed({
      ...FACTS,
      teamName: 'Team "<script>" & Sons',
      events: [],
      lock: "Locks Thursday.",
    });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(esc("a & b")).toBe("a &amp; b");
  });

  it("carries an unsubscribe link in both parts of every message", () => {
    for (const kind of KINDS) {
      const m = render(kind, {
        ...FACTS,
        recap: null,
        roster: [],
        events: [],
        hoursLeft: 12,
        deadline: "x",
        lock: "y",
      });
      expect(m.text, kind).toContain(FACTS.unsubscribeUrl);
      expect(m.html, kind).toContain(FACTS.unsubscribeUrl);
      expect(m.html, kind).toContain(FACTS.unsubscribeAllUrl);
      /* A plain-text alternative is one of the things spam filters weigh, and it is
       * what a screen reader reads out. */
      expect(m.text.length, kind).toBeGreaterThan(40);
    }
  });

  it("has only three kinds", () => {
    expect(() => render("nudge_the_commissioner", FACTS)).toThrow(/unknown notification kind/);
  });
});

describe("the unsubscribe token", () => {
  it("names one person and one kind, and survives a round trip", () => {
    const token = mintToken("user-123", "week_dealt", ENV);
    expect(readToken(token, ENV)).toEqual({ ok: true, userId: "user-123", kind: "week_dealt" });
  });

  it("refuses a token that has been edited", () => {
    const token = mintToken("user-123", "week_dealt", ENV);
    const [payload] = token.split(".");
    const forged = payload + "." + "x".repeat(43);
    expect(readToken(forged, ENV).ok).toBe(false);
  });

  /* Rotating the secret is the only way to revoke these links, so it has to work. */
  it("refuses a token signed with a different secret", () => {
    const token = mintToken("user-123", "week_dealt", ENV);
    const rotated = { ...ENV, NOTIFY_SIGNING_SECRET: "a-different-secret-entirely-ok" };
    expect(readToken(token, rotated).ok).toBe(false);
  });

  it("will not mint anything without a real secret", () => {
    expect(() => mintToken("user-123", "week_dealt", {})).toThrow(/NOTIFY_SIGNING_SECRET/);
    expect(() => mintToken("user-123", "week_dealt", { NOTIFY_SIGNING_SECRET: "short" })).toThrow();
  });

  it("can silence one kind or all of them", () => {
    expect(prefUpdateFor("scheme_reminder")).toEqual({ scheme_reminder: false });
    expect(prefUpdateFor(ALL)).toEqual({
      week_dealt: false,
      scheme_reminder: false,
      schemes_processed: false,
    });
  });

  it("offers the mail client its own one-click button", () => {
    const headers = listUnsubscribeHeaders("https://site", "user-1", "week_dealt", ENV);
    expect(headers["List-Unsubscribe"]).toMatch(/^<https:\/\/site\/unsubscribe\?t=.+>$/);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("says which emails are being stopped, in words", () => {
    expect(kindWords("scheme_reminder")).toContain("deadline");
    expect(kindWords(ALL)).toContain("all league email");
  });

  it("puts the token in a link the footer can use", () => {
    expect(unsubscribeUrl("https://site", "user-1", "week_dealt", ENV)).toContain("/unsubscribe?t=");
  });
});

describe("which transport, and why", () => {
  /* THE GATE. A key in a .env.local must not be enough to mail a league from a laptop. */
  it("never sends from a machine talking to a local database", () => {
    const choice = transportChoice({ ...ENV, SUPABASE_URL: "http://127.0.0.1:54321" });
    expect(choice.mode).toBe("capture");
    expect(choice.why).toContain("development machine");
  });

  it("captures rather than failing when nothing is configured", () => {
    expect(transportChoice({ SUPABASE_URL: "https://project.supabase.co" }).mode).toBe("capture");
    expect(transportChoice({ SUPABASE_URL: "https://project.supabase.co", RESEND_API_KEY: "re_x" }).why)
      .toContain("NOTIFY_FROM");
  });

  it("sends when a hosted database, a key and a from address all line up", () => {
    expect(transportChoice(ENV).mode).toBe("resend");
  });

  it("uses Netlify's own address for links when SITE_URL is unset", () => {
    expect(siteUrl({ URL: "https://pigskin.example.org/" })).toBe("https://pigskin.example.org");
    expect(siteUrl({ SITE_URL: "https://other.example" })).toBe("https://other.example");
  });
});

describe("sending one message", () => {
  const message = { to: "a@b.test", subject: "s", text: "t", html: "<p>t</p>", headers: { "List-Unsubscribe": "<x>" } };

  it("hands Resend the row id as an idempotency key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "provider-1" }) });
    const res = await sendEmail(message, { idempotencyKey: "row-7", env: ENV, fetchImpl });
    expect(res).toMatchObject({ ok: true, id: "provider-1" });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers["idempotency-key"]).toBe("row-7");
    expect(JSON.parse(init.body)).toMatchObject({ from: ENV.NOTIFY_FROM, to: ["a@b.test"], subject: "s" });
  });

  /* 429 is the free plan's daily cap, which magic links share. Dropping the message
   * would be the wrong answer - it is worth sending an hour later. */
  it("retries a rate limit and a server error, but not a rejection", async () => {
    const reply = (status, body) => ({ ok: false, status, json: async () => body });
    const limited = await sendEmail(message, {
      idempotencyKey: "r", env: ENV, fetchImpl: async () => reply(429, { message: "Too many requests" }),
    });
    expect(limited).toMatchObject({ ok: false, retryable: true });

    const broken = await sendEmail(message, {
      idempotencyKey: "r", env: ENV, fetchImpl: async () => reply(502, {}),
    });
    expect(broken.retryable).toBe(true);

    const refused = await sendEmail(message, {
      idempotencyKey: "r", env: ENV, fetchImpl: async () => reply(403, { message: "Domain is not verified" }),
    });
    expect(refused).toMatchObject({ ok: false, retryable: false, why: "Domain is not verified" });
  });

  it("treats a dead connection as worth retrying rather than as a crash", async () => {
    const res = await sendEmail(message, {
      idempotencyKey: "r", env: ENV, fetchImpl: async () => { throw new Error("ECONNRESET"); },
    });
    expect(res).toMatchObject({ ok: false, retryable: true });
    expect(res.why).toContain("ECONNRESET");
  });

  it("captures instead of sending when the transport says so", async () => {
    const fetchImpl = vi.fn();
    const res = await sendEmail(message, { idempotencyKey: "r", env: { SUPABASE_URL: "http://localhost:54321" }, fetchImpl });
    expect(res).toMatchObject({ ok: true, skipped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------------
 * The drain, against a fake client.
 *
 * WORTH FAKING RATHER THAN LEAVING TO tests/notifyDb.test.js, because these branches
 * decide whether a message arrives late or never, and the stack-backed suite SKIPS
 * ITSELF when Docker is not running - which is exactly the run in which somebody
 * "tidies" a retry rule and sees green.
 * --------------------------------------------------------------------------- */
function fakeDb({ rows, prefs = [], email = "manager@example.test" }) {
  const updates = [];
  const table = (name) => {
    if (name === "notifications") {
      const q = {
        select: () => q, in: () => q, lt: () => q, order: () => q,
        limit: async () => ({ data: rows, error: null }),
        update: (patch) => ({ eq: async (_col, id) => { updates.push({ id, patch }); return { error: null }; } }),
      };
      return q;
    }
    const p = { select: () => p, in: async () => ({ data: prefs, error: null }) };
    return p;
  };
  return {
    from: table,
    auth: { admin: { getUserById: async () => ({ data: { user: { email } }, error: null }) } },
    updates,
  };
}

const owed = (over = {}) => ({
  id: "row-1", user_id: "user-1", kind: "week_dealt", attempts: 0,
  payload: { subject: "s", text: "t", html: "<p>t</p>" }, ...over,
});

describe("draining the outbox", () => {
  const hosted = { ...ENV };

  it("records a send, with the provider's id", async () => {
    const db = fakeDb({ rows: [owed()] });
    const fetchImpl = async () => ({ ok: true, json: async () => ({ id: "provider-9" }) });
    vi.stubGlobal("fetch", fetchImpl);
    const out = await drain(db, { env: hosted });
    vi.unstubAllGlobals();
    expect(out).toMatchObject({ ok: true, sent: 1 });
    expect(db.updates[0].patch).toMatchObject({ status: "sent", provider_id: "provider-9" });
  });

  /* The second opt-out check. The first ran when the row was written, which may have
   * been days ago - this is the one that protects the sending domain. */
  it("does not send to somebody who unsubscribed after the row was written", async () => {
    const db = fakeDb({
      rows: [owed()],
      prefs: [{ user_id: "user-1", week_dealt: false, scheme_reminder: true, schemes_processed: true }],
    });
    const out = await drain(db, { env: hosted });
    expect(out).toMatchObject({ sent: 0, skipped: 1, ok: true });
    expect(db.updates[0].patch.status).toBe("skipped");
  });

  it("leaves a retryable failure owed, and counts the attempt", async () => {
    const db = fakeDb({ rows: [owed()] });
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 429, json: async () => ({ message: "slow down" }) }));
    const out = await drain(db, { env: hosted });
    vi.unstubAllGlobals();
    expect(out).toMatchObject({ ok: false, failed: 1 });
    expect(db.updates[0].patch).toMatchObject({ status: "pending", attempts: 1 });
  });

  /* A reminder about a deadline that has since passed is worse than silence, so a row
   * stops being retried rather than filling a log forever. */
  it("gives up after the last attempt", async () => {
    const db = fakeDb({ rows: [owed({ attempts: MAX_ATTEMPTS - 1 })] });
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await drain(db, { env: hosted });
    vi.unstubAllGlobals();
    expect(db.updates[0].patch).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
  });

  it("skips a member with no address rather than retrying forever", async () => {
    const db = fakeDb({ rows: [owed()], email: null });
    const out = await drain(db, { env: hosted });
    expect(out).toMatchObject({ skipped: 1, ok: true });
    expect(db.updates[0].patch.status).toBe("skipped");
  });

  it("captures every message when nothing is configured, and calls that a success", async () => {
    const db = fakeDb({ rows: [owed()] });
    const out = await drain(db, { env: { ...ENV, SUPABASE_URL: "http://127.0.0.1:54321" } });
    expect(out).toMatchObject({ ok: true, skipped: 1 });
    expect(out.why).toContain("not sending");
  });
});

describe("the league's own switch", () => {
  /* Default false, like every other automation switch here: a league that is already
   * being played must never start emailing because we deployed something. */
  it("is off unless the commissioner turned it on", () => {
    expect(notifyEnabled({ notify_members: true })).toBe(true);
    expect(notifyEnabled({ notify_members: false })).toBe(false);
    expect(notifyEnabled({})).toBe(false);
    expect(notifyEnabled(null)).toBe(false);
  });
});
