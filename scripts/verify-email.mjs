#!/usr/bin/env node
/* Prove that magic-link email actually WORKS against a real project.
 *
 *   npm run verify:email -- you@your-address.com
 *
 * WHY THIS EXISTS. Supabase's built-in email sender is rate limited and explicitly not
 * intended for production. It does not fail loudly when it throttles - it just stops
 * delivering - and the symptom is a manager saying "I never got the email" days later,
 * with nothing in any log to look at. That is the worst failure mode a login can have,
 * and it is invisible until someone is locked out.
 *
 * So this is the check you run ONCE after configuring Resend in the dashboard, and again
 * any time email seems off. It sends one real message to an address you name and reports
 * what the auth server actually said.
 *
 * It sends REAL EMAIL, so it refuses to run without an explicit address argument. There
 * is no default and no prompt: nobody should ever be able to trigger this by accident.
 *
 * Read-only apart from that one message. It uses the PUBLISHABLE key - the same one the
 * browser uses - because the point is to exercise the path a real person takes, not a
 * privileged shortcut that might succeed where theirs fails.
 */

import fs from "node:fs";
import path from "node:path";

const email = process.argv[2];

if (!email || !email.includes("@")) {
  console.error(`
  Usage:  npm run verify:email -- you@your-address.com

  Sends ONE real sign-in email to the address you name, and reports what happened.
  Use an inbox you can actually check - the whole point is to confirm it arrives.
`);
  process.exit(2);
}

/* .env.local is where the deployed project's URL and publishable key live locally.
 * Parsed by hand rather than adding a dotenv dependency for one script - this project
 * keeps its dependencies boring on purpose. */
function readEnvLocal() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...readEnvLocal(), ...process.env };
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error("\n  Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
  console.error("  Put them in .env.local - see .env.example.\n");
  process.exit(2);
}

const isLocal = /127\.0\.0\.1|localhost/.test(url);
const redirectTo = env.VERIFY_EMAIL_REDIRECT || (isLocal ? "http://localhost:5173" : null);

console.log("\n  Project:   " + url + (isLocal ? "  (LOCAL - mail is captured, not sent)" : "  (HOSTED - this sends real email)"));
console.log("  Sending to: " + email);
if (redirectTo) console.log("  Redirect:   " + redirectTo);
console.log("");

const started = Date.now();
const res = await fetch(url.replace(/\/$/, "") + "/auth/v1/otp", {
  method: "POST",
  headers: { apikey: key, "content-type": "application/json" },
  body: JSON.stringify({
    email,
    create_user: true,
    ...(redirectTo ? { gotrue_meta_security: {}, redirect_to: redirectTo } : {}),
  }),
});
const elapsed = Date.now() - started;
const body = await res.json().catch(() => ({}));

const fail = (headline, detail) => {
  console.error("  FAILED - " + headline + "\n");
  if (detail) console.error("    " + detail + "\n");
  process.exit(1);
};

if (res.status === 429) {
  fail(
    "rate limited (HTTP 429).",
    "This is the exact failure this script exists to catch. If SMTP is NOT configured,\n" +
    "    the built-in sender's low limit is being hit and real sign-ins are already\n" +
    "    failing silently. Configure Resend in the dashboard - docs/EMAIL-SETUP.md."
  );
}

if (!res.ok) {
  const msg = body.msg || body.error_description || body.error || JSON.stringify(body);
  if (/redirect/i.test(String(msg))) {
    fail(
      "the redirect URL was rejected: " + msg,
      "Add it under Authentication -> URL Configuration in the dashboard. An\n" +
      "    unlisted address is refused outright, which looks like a broken link."
    );
  }
  fail("HTTP " + res.status + ": " + msg);
}

console.log("  OK - the auth server accepted the request (" + elapsed + "ms).\n");

if (isLocal) {
  console.log("  Local stack: the message was CAPTURED, not sent.");
  console.log("  Open it at http://127.0.0.1:54324\n");
} else {
  console.log("  A real email is on its way. Now go and check that inbox - this script");
  console.log("  can only prove the request was ACCEPTED, not that mail was delivered.");
  console.log("  If nothing arrives within a minute or two:");
  console.log("    - check the Resend dashboard's logs for a bounce or a rejection");
  console.log("    - confirm the sending domain's DNS records are verified");
  console.log("    - check spam\n");
}
