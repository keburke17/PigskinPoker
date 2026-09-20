#!/usr/bin/env node
/* Prove league email works - and show Scott what it looks like before anybody gets one.
 *
 *   npm run verify:notify -- you@your-address.com     sends all three, for real
 *   npm run verify:notify -- --preview                writes them to files, sends nothing
 *
 * Issue #57. Two jobs, and both are the ones `npm run verify:email` does for magic links:
 *
 *   1. THE CONFIGURATION IS ONLY PROVEN BY A DELIVERED MESSAGE. A verified domain, a key
 *      with the right scope and a `from` address that survives DMARC are three separate
 *      things, and every one of them fails silently - the API returns 200 and the message
 *      is quietly dropped somewhere downstream. So this sends real mail to an address you
 *      name and then tells you to go and look.
 *   2. THE WORDING IS SCOTT'S, so he needs to read one without a league being emailed.
 *      --preview renders the same three messages to HTML files and sends nothing at all.
 *
 * IT SENDS REAL EMAIL, so it refuses to run without an explicit address. No default, no
 * prompt: nobody should be able to trigger this by accident.
 *
 * WHY IT BYPASSES THE LOCAL-DATABASE GATE in server/email/resend.js, which is the one
 * thing in here worth arguing about. That gate exists so an UNATTENDED job on a
 * developer's machine - a replayed season, a test, a cron that should not be running -
 * cannot mail twelve real people. This is the opposite situation: one message, to one
 * address, typed by the person running it, in order to test the sender. So the transport
 * is handed an environment with no database in it, and what remains in force is the part
 * that matters - no key, no send.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { render } from "../server/email/templates.js";
import { sendEmail } from "../server/email/resend.js";
import { mintToken } from "../server/email/unsubscribe.js";

const args = process.argv.slice(2);
const preview = args.includes("--preview");
const email = args.find((a) => a.includes("@"));

if (!preview && !email) {
  console.error(`
  Usage:  npm run verify:notify -- you@your-address.com
          npm run verify:notify -- --preview

  The first sends all three league emails to the address you name - use an inbox you
  can actually check. The second renders them to files and sends nothing.
`);
  process.exit(2);
}

/* Hand-parsed, for the same reason verify-email.mjs does it: one script is not worth a
 * dotenv dependency in a project that keeps them boring. */
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

const file = { ...readEnvLocal(), ...process.env };
/* No SUPABASE_URL: see the note at the top. Nothing here reads the database anyway -
 * the sample facts below stand in for a league. */
const env = {
  RESEND_API_KEY: file.RESEND_API_KEY,
  NOTIFY_FROM: file.NOTIFY_FROM,
  NOTIFY_SIGNING_SECRET: file.NOTIFY_SIGNING_SECRET || "preview-only-secret-not-for-sending",
  SITE_URL: file.SITE_URL || "https://pigskin.ballsohard.org",
};

if (!preview) {
  const missing = ["RESEND_API_KEY", "NOTIFY_FROM"].filter((k) => !file[k]);
  if (missing.length) {
    console.error(
      "\n  " + missing.join(" and ") + " not set, so nothing can be sent.\n" +
      "  Put them in .env.local (or the environment) - docs/EMAIL-SETUP.md has the setup.\n" +
      "  To see the messages without sending, run:  npm run verify:notify -- --preview\n"
    );
    process.exit(2);
  }
  if (!file.NOTIFY_SIGNING_SECRET) {
    console.error(
      "\n  NOTIFY_SIGNING_SECRET is not set. The unsubscribe link in the footer would be\n" +
      "  signed with a placeholder and would not work. Generate one:\n\n" +
      "      openssl rand -hex 32\n"
    );
    process.exit(2);
  }
}

/* One league, invented, with enough going on that every branch of every template shows:
 * a recap, a full starting six, a clock deadline, three things the schemes did. */
const site = env.SITE_URL;
const USER = "00000000-0000-4000-8000-00000000cafe";
const common = {
  teamName: "Gridiron Gamblers",
  leagueName: "Ball So Hard League",
  site,
};
const unsub = (kind) => ({
  unsubscribeUrl: site + "/unsubscribe?t=" + mintToken(USER, kind, env),
  unsubscribeAllUrl: site + "/unsubscribe?t=" + mintToken(USER, "all", env),
});

const SAMPLES = {
  week_dealt: {
    ...common,
    ...unsub("week_dealt"),
    periodLabel: "Week 7",
    recap: {
      periodLabel: "Week 6",
      rank: 3,
      teamCount: 6,
      standingsPoints: 4,
      rawScore: 96.4,
      best: { name: "Bijan Robinson (ATL)", points: "24.1" },
    },
    roster: [
      "Coach - Dan Campbell (DET) vs CHI",
      "QB - Jalen Hurts (PHI) at NYG",
      "RB - Bijan Robinson (ATL) vs CAR",
      "WR - Puka Nacua (LAR) at SEA",
      "TE - Trey McBride (ARI) vs SF",
      "FLEX - De'Von Achane (MIA) vs BUF",
    ],
    deadline: "Schemes close Thursday 3am EST, on the clock - nothing in by then runs as dealt.",
  },
  scheme_reminder: {
    ...common,
    ...unsub("scheme_reminder"),
    periodLabel: "Week 7",
    hoursLeft: 12,
    deadline: "schemes close Thursday 3am EST.",
  },
  schemes_processed: {
    ...common,
    ...unsub("schemes_processed"),
    periodLabel: "Week 7",
    events: [
      "Your block on Bijan Robinson held - Hog Mollies could not take him.",
      "Puka Nacua was stolen by Team Chaos.",
      "Your redraw turned Trey McBride into George Kittle (SF).",
    ],
    lock: "Each player locks at his own kickoff. The first game is Thursday 8:15pm EST.",
  },
};

const rendered = Object.entries(SAMPLES).map(([kind, facts]) => [kind, render(kind, facts)]);

if (preview) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pigskin-email-"));
  console.log("\n  Rendered, not sent:\n");
  for (const [kind, message] of rendered) {
    const out = path.join(dir, kind + ".html");
    fs.writeFileSync(out, message.html);
    console.log("  " + kind);
    console.log("    subject: " + message.subject);
    console.log("    html:    " + out);
  }
  console.log("\n  Open those in a browser to read them. Nothing was sent.\n");
  process.exit(0);
}

console.log("\n  Sending as: " + env.NOTIFY_FROM);
console.log("  Sending to: " + email + "   (THREE real emails)\n");

let failed = 0;
for (const [kind, message] of rendered) {
  /* A fresh key each run, so re-running this actually re-sends rather than being
   * silently deduplicated by Resend's 24-hour idempotency window. */
  const result = await sendEmail(
    {
      to: email,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: {
        "List-Unsubscribe": "<" + SAMPLES[kind].unsubscribeUrl + ">",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    },
    { idempotencyKey: "verify-" + kind + "-" + Date.now(), env }
  );
  if (result.ok && !result.skipped) console.log("  OK      " + kind + "  (" + result.id + ")");
  else if (result.skipped) console.log("  SKIPPED " + kind + "  - " + result.why);
  else {
    failed += 1;
    console.log("  FAILED  " + kind + "  - " + result.why);
  }
}

console.log(
  failed
    ? "\n  " + failed + " failed. A 403 usually means the domain in NOTIFY_FROM is not verified\n" +
      "  at Resend, or the key is scoped to a different one. A 429 is the daily cap -\n" +
      "  which magic links share, so check Resend before sending more.\n"
    : "\n  All three accepted. Now go and look in the inbox - acceptance is not delivery.\n" +
      "  If nothing arrives: check Resend's logs for a bounce, check DNS is still verified,\n" +
      "  and check spam. docs/EMAIL-SETUP.md has the rest.\n"
);
process.exit(failed ? 1 : 0);
