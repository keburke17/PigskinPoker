/* Invite codes: how a person gets INTO a league.
 *
 * THE INVERSION, in one line: a join code authenticates every session forever; an invite
 * authorizes one join and is then spent. Everything else here follows from that.
 *
 * Because it no longer grants standing access, an invite can be reissued freely - and
 * that fixes a real workflow cost of the join-code design, where rotating a code was
 * indistinguishable from locking somebody out. Here, revoking an invite affects only
 * future joins. Nobody who has already redeemed one notices.
 *
 * WHY THE CODE HAS TWO HALVES. Codes are scrypt-hashed, and scrypt salts randomly, so a
 * stored hash cannot be looked up BY. Join codes dodge this because you choose your team
 * first and only one hash is then checked; an invite arrives with no context at all -
 * someone pastes a code and nothing else - so its row has to be findable.
 *
 * The obvious fix, an extra fast deterministic hash to index on, would quietly make that
 * fast hash the weakest link and defeat the point of scrypt. So a code reads
 * REFERENCE-SECRET: the reference is public and indexed and proves nothing; the secret is
 * what scrypt protects. Nothing fast ever guards anything.
 */

import crypto from "node:crypto";
import { hashSecret, verifySecret } from "./hash.js";

/* No 0/O, 1/I/L, or U. These codes get read aloud, texted, and retyped from a photo of a
 * whiteboard, and every one of those characters is a support conversation waiting to
 * happen. U is dropped as well, which removes most accidental profanity. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const REF_LEN = 6;
const SECRET_LEN = 10;

/* Rejection sampling rather than `% ALPHABET.length`, which would bias the low end of
 * the alphabet. The bias would be small and completely invisible; it is also entirely
 * avoidable, so it is avoided. */
function randomChars(n) {
  const out = [];
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < n) {
    for (const byte of crypto.randomBytes(n * 2)) {
      if (byte >= limit) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === n) break;
    }
  }
  return out.join("");
}

/**
 * @returns {{code, ref, secret}} `code` is shown to a human ONCE and never stored.
 */
export function generateInviteCode() {
  const ref = randomChars(REF_LEN);
  const secret = randomChars(SECRET_LEN);
  // Hyphenated for reading aloud and for line breaks in a group chat. The hyphen is
  // cosmetic - parseInviteCode strips every separator before doing anything.
  return { code: ref + "-" + secret, ref, secret };
}

/**
 * Split what a person typed back into its two halves.
 *
 * Generous about FORM, strict about CONTENT: hyphens, spaces and case are all noise
 * introduced by phones, autocorrect and people reading codes out. What is not forgiven is
 * a wrong character - the alphabet excludes the confusable ones precisely so that a
 * character outside it means a genuine mistake rather than a transcription artefact.
 *
 * @returns {{ref, secret}|null}
 */
export function parseInviteCode(input) {
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
  if (cleaned.length !== REF_LEN + SECRET_LEN) return null;
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  return { ref: cleaned.slice(0, REF_LEN), secret: cleaned.slice(REF_LEN) };
}

export const hashInviteSecret = (secret) => hashSecret(secret);
export const verifyInviteSecret = (secret, stored) => verifySecret(secret, stored);

/**
 * Is this invite usable right now, and if not, why not?
 *
 * The reasons are distinct on purpose. "Expired" and "already used up" are things the
 * person can act on - ask for another - while a wrong code is their own typo. Collapsing
 * them into one message would leave someone retyping a code that was never going to work.
 *
 * @returns {string|null} a message fit to show, or null if the invite is good.
 */
export function inviteProblem(invite, now = Date.now()) {
  if (!invite) return "That invite code is not valid.";
  if (invite.revoked_at) return "That invite has been withdrawn - ask for a new one.";
  if (invite.expires_at && new Date(invite.expires_at).getTime() < now) {
    return "That invite has expired - ask for a new one.";
  }
  if (invite.max_uses != null && invite.uses >= invite.max_uses) {
    return "That invite has already been used as many times as it allows.";
  }
  return null;
}
