/* Turning league email off, from an inbox, with no way to sign in.
 *
 * Issue #57. THIS IS NOT A NICE-TO-HAVE. Every address in this league belongs to
 * somebody who can reach for "mark as spam" instead, and a complaint is recorded against
 * the sending domain rather than against the message - which is why league mail sends
 * from its own subdomain. An unsubscribe link that works on the first click is the
 * cheapest insurance there is against it.
 *
 * ---------------------------------------------------------------------------
 * WHY A SIGNED TOKEN RATHER THAN A ROW IN A TABLE.
 *
 * The link has to work for somebody who cannot sign in - that is the whole point; a
 * person who could sign in would use the account screen. So the link must carry its own
 * authority. Two ways to do that:
 *
 *   - store a random token per person and look it up. A table, a migration, a lifetime
 *     question, and a row that must exist before the first email is sent;
 *   - sign the user id with a secret nobody else has, and verify the signature.
 *
 * The second is stateless, needs nothing written in advance, and is revocable in one
 * step by rotating NOTIFY_SIGNING_SECRET. It is the same idea as a magic link, for a far
 * smaller privilege: the token can ONLY silence email for the person it names. It cannot
 * sign anybody in, cannot read anything, and cannot turn email back ON - that takes a
 * session, which is the asymmetry you want. A leaked link is a stranger doing you the
 * favour of stopping your email.
 *
 * NO EXPIRY, deliberately. An email from October is still a reason to unsubscribe in
 * January, and a link that has quietly expired sends the person to "mark as spam"
 * instead, which is the exact outcome this exists to avoid.
 * ---------------------------------------------------------------------------
 *
 * THE ONE-CLICK PATH, AND WHY THE PAGE HAS A BUTTON ON IT. RFC 8058 - which Gmail and
 * Yahoo expect from anyone sending bulk mail - is a POST made by the MAIL CLIENT, and
 * that is handled by `List-Unsubscribe-Post` in the headers. A human clicking the link
 * in the footer arrives with a GET, and a GET must not change anything: corporate link
 * scanners and mail previewers fetch every URL in a message before a person sees it, and
 * an unsubscribe-on-GET would silently opt half a league out. So the GET shows a page,
 * and the button on it POSTs.
 */

import crypto from "node:crypto";

/** The three kinds, plus the "everything" scope the page offers. */
export const KINDS = ["week_dealt", "scheme_reminder", "schemes_processed"];
export const ALL = "all";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function secretOf(env) {
  const secret = env.NOTIFY_SIGNING_SECRET;
  if (!secret || String(secret).length < 16) {
    /* Refused rather than defaulted. A default secret is a public secret, and the
     * failure it would cause - anybody able to mint a link that silences anybody - is
     * worse than an email going out without a footer link. */
    throw new Error("NOTIFY_SIGNING_SECRET is not set (needs at least 16 characters)");
  }
  return String(secret);
}

function sign(payload, env) {
  return crypto.createHmac("sha256", secretOf(env)).update(payload).digest("base64url");
}

/**
 * The token that rides in an unsubscribe link.
 *
 * @param {string} userId  auth.users id
 * @param {string} kind    one of KINDS, or ALL
 */
export function mintToken(userId, kind, env = process.env) {
  if (kind !== ALL && !KINDS.includes(kind)) throw new Error("unknown notification kind: " + kind);
  const payload = b64url(String(userId) + ":" + kind);
  return payload + "." + sign(payload, env);
}

/**
 * Read a token back, or say why it cannot be trusted.
 *
 * `crypto.timingSafeEqual` rather than `===` - comparing signatures with a short-circuit
 * comparison leaks how much of a guess was right, one byte at a time. It is a small
 * risk here and a free fix.
 *
 * @returns {{ ok: true, userId: string, kind: string } | { ok: false, why: string }}
 */
export function readToken(token, env = process.env) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return { ok: false, why: "malformed link" };
  const [payload, sig] = parts;

  let expected;
  try {
    expected = sign(payload, env);
  } catch (e) {
    return { ok: false, why: e.message };
  }

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, why: "this link has been altered, or the signing secret was rotated" };
  }

  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const at = decoded.lastIndexOf(":");
  if (at < 0) return { ok: false, why: "malformed link" };
  const userId = decoded.slice(0, at);
  const kind = decoded.slice(at + 1);
  if (kind !== ALL && !KINDS.includes(kind)) return { ok: false, why: "unknown notification kind" };
  if (!userId) return { ok: false, why: "malformed link" };
  return { ok: true, userId, kind };
}

/** The link that goes in an email footer. */
export function unsubscribeUrl(site, userId, kind, env = process.env) {
  return site + "/unsubscribe?t=" + encodeURIComponent(mintToken(userId, kind, env));
}

/**
 * The headers that make a mail client offer its own unsubscribe button.
 *
 * Gmail and Yahoo both want these on bulk mail, and the client-rendered button is the
 * one people actually use - it sits next to the sender's name, where the alternative
 * button says "report spam". `List-Unsubscribe-Post` is what promises the POST needs no
 * confirmation page, which is the whole of RFC 8058.
 */
export function listUnsubscribeHeaders(site, userId, kind, env = process.env) {
  return {
    "List-Unsubscribe": "<" + unsubscribeUrl(site, userId, kind, env) + ">",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Which columns a token turns off.
 *
 * Pure, so the endpoint stays a thin wrapper and the rule is testable without a
 * database - the same split every other decision in server/ has.
 */
export function prefUpdateFor(kind) {
  if (kind === ALL) return { week_dealt: false, scheme_reminder: false, schemes_processed: false };
  return { [kind]: false };
}

/** "the scheme reminder", for a sentence on the confirmation page. */
export function kindWords(kind) {
  switch (kind) {
    case "week_dealt":
      return "emails about your new roster";
    case "scheme_reminder":
      return "reminders that the scheme deadline is coming";
    case "schemes_processed":
      return "emails telling you the schemes have run";
    default:
      return "all league email";
  }
}
