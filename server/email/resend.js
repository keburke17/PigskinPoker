/* The one thing in this project that puts a message in somebody else's inbox.
 *
 * Issue #57. Deliberately small and deliberately boring: one HTTP POST, no SDK, no
 * queue library, no templating engine. Resend's API is a JSON endpoint and
 * `@resend/node` would be a dependency to maintain for a fetch call - CLAUDE.md's rule
 * is that dependencies stay boring, and this is being handed to a hobbyist.
 *
 * ---------------------------------------------------------------------------
 * THE GATE: A DEVELOPMENT MACHINE MUST NEVER SEND REAL EMAIL.
 *
 * This is the same shape as server/feed/index.js and for a sharper reason. There the
 * mistake is a stale player pool; here it is twelve real people receiving "your Week 6
 * roster is dealt" because somebody was replaying a season locally with a .env.local
 * that still had a key in it. So the key alone is NOT enough: the database this process
 * is talking to must also be hosted. Local database, no send, no exceptions - the
 * message is rendered, recorded and printed, which is all local development needs.
 *
 * It is a gate rather than a warning because a warning is read after the mail has gone.
 * ---------------------------------------------------------------------------
 *
 * WHY A SEPARATE SENDING DOMAIN (docs/EMAIL-SETUP.md). Magic links are the ONLY way
 * into this app. League mail is the kind of mail people eventually mark as spam, and a
 * complaint lands on the sending domain's reputation - so league mail sends from
 * notify.ballsohard.org and sign-in mail keeps mail.ballsohard.org to itself. Nothing in
 * this file enforces that; `NOTIFY_FROM` is where it is decided.
 */

import { isLocalUrl } from "../localUrl.js";

const ENDPOINT = "https://api.resend.com/emails";

/** Where a link in an email should point. Netlify sets `URL` to the site's own address. */
export function siteUrl(env = process.env) {
  const url = env.SITE_URL || env.URL || "https://pigskin.ballsohard.org";
  return String(url).replace(/\/+$/, "");
}

/**
 * Real sends, or captured ones - and the reason, in words a human can act on.
 *
 * Returned rather than logged, so the caller can put it in the row it writes and in the
 * line it logs. "Nothing arrived" is the hardest email failure to diagnose, and every
 * one of these answers is a different fix.
 *
 * @returns {{ mode: "resend"|"capture", why: string }}
 */
export function transportChoice(env = process.env) {
  const dbUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  if (isLocalUrl(dbUrl)) {
    return { mode: "capture", why: "the database is local - nothing is sent from a development machine" };
  }
  if (!env.RESEND_API_KEY) return { mode: "capture", why: "RESEND_API_KEY is not set" };
  if (!env.NOTIFY_FROM) return { mode: "capture", why: "NOTIFY_FROM is not set" };
  return { mode: "resend", why: "sending as " + env.NOTIFY_FROM };
}

/**
 * Send one message.
 *
 * ONE AT A TIME RATHER THAN RESEND'S BATCH ENDPOINT, on purpose. A league is a dozen
 * people, so batching saves a rounding error of latency, and it would cost the thing
 * that matters: the batch endpoint takes ONE idempotency key for the whole call, while
 * this project's guarantee is per-row - the id of the `notifications` row is the key, so
 * a retry after a response we never saw is recognised by the provider person by person.
 * Anyone opting out mid-batch would also be a rebuild of the whole request.
 *
 * NEVER THROWS. Everything comes back as a result the caller can write into a row:
 * a job that crashes on a bad address is a job that stops delivering the other eleven.
 *
 * @param {object} message   { to, subject, text, html, headers }
 * @param {string} idempotencyKey  the notifications row id
 * @returns {Promise<{ok: boolean, id: string|null, skipped?: boolean, retryable?: boolean, why: string}>}
 */
export async function sendEmail(message, { idempotencyKey, env = process.env, fetchImpl = fetch } = {}) {
  const choice = transportChoice(env);
  if (choice.mode === "capture") {
    /* Printed whole, because this IS the local inbox. Magic links are captured at
     * 127.0.0.1:54324 by the Supabase stack; league mail has no such mailbox, so the
     * dev console is where you read it. */
    console.log(
      "\n[notify] CAPTURED (" + choice.why + ")\n" +
        "  to:      " + message.to + "\n" +
        "  subject: " + message.subject + "\n" +
        message.text.split("\n").map((l) => "  | " + l).join("\n") + "\n"
    );
    return { ok: true, id: null, skipped: true, why: choice.why };
  }

  let res;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: "Bearer " + env.RESEND_API_KEY,
        "content-type": "application/json",
        /* Resend remembers this for 24 hours. The window that matters is much shorter -
         * the hourly cycle retrying a send whose response was lost to a cold start. */
        "idempotency-key": String(idempotencyKey),
      },
      body: JSON.stringify({
        from: env.NOTIFY_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers || {},
      }),
    });
  } catch (e) {
    /* DNS, TLS, a timeout: the message may or may not have been accepted, which is
     * exactly what the idempotency key is for. Retry it. */
    return { ok: false, id: null, retryable: true, why: "network: " + (e?.message ?? String(e)) };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* A body we cannot parse is not worth failing over if the status was fine. */
  }

  if (res.ok) return { ok: true, id: body?.id ?? null, why: "accepted by Resend" };

  const detail = body?.message || body?.error?.message || ("HTTP " + res.status);

  /* 429 is the daily cap or the per-second limit, and BOTH are worth retrying rather
   * than dropping: the free plan's 100-a-day is shared with magic links, so a busy
   * Tuesday can hit it, and the answer is to send later rather than not at all.
   * 5xx is theirs. Every other 4xx is ours - a bad address, an unverified domain, a
   * revoked key - and retrying it hourly forever would just bury the real error. */
  const retryable = res.status === 429 || res.status >= 500;
  return { ok: false, id: null, retryable, why: detail };
}
