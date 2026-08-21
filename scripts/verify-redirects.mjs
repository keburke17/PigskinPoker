#!/usr/bin/env node
/* Prove where a sign-in link will actually SEND somebody.
 *
 *   VITE_SUPABASE_URL=https://<ref>.supabase.co \
 *     npm run verify:redirects -- https://pigskin.ballsohard.org
 *
 * WHY THIS EXISTS. Two dashboard settings decide whether a magic link lands on the app
 * or somewhere useless, and neither one announces that it is wrong:
 *
 *   Redirect URLs  an allow-list. An address that is not on it is REJECTED, and the
 *                  person is sent to the Site URL instead - so the link "works" and
 *                  quietly drops them somewhere they did not ask to be. The wildcard
 *                  matters: without `/**` every link back to /join/<code> or
 *                  /l/<leagueId> loses the page it was returning to.
 *   Site URL       the fallback for exactly that case. Supabase ships it as
 *                  http://localhost:3000, and a project that has never had it changed
 *                  sends people to a dead address on their own machine.
 *
 * Both were true of this project's hosted stack after Phase 3 shipped: the allow-list
 * had been done, the Site URL had not, and nothing anywhere said so.
 *
 * SENDS NO EMAIL. It asks the auth server to verify a token that was never valid, and
 * reads the Location header off the rejection. Where the failure is sent is the same
 * decision the server makes for a real link, so the answer is real - and unlike
 * verify:email it costs nothing and can be run against production whenever.
 */

import fs from "node:fs";
import path from "node:path";

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
const authUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const site = (process.argv[2] || env.SITE_URL || "").replace(/\/+$/, "");

if (!authUrl || !site) {
  console.error(`
  Usage:  npm run verify:redirects -- https://your-site.example

  Checks the Supabase project named by .env.local (VITE_SUPABASE_URL) and reports where
  its sign-in links will send people. Sends no email.

  To check the HOSTED project rather than your local stack:

    VITE_SUPABASE_URL=https://<ref>.supabase.co npm run verify:redirects -- https://your-site.example
`);
  process.exit(2);
}

/* WHICH PROJECT IS THIS ACTUALLY ASKING?
 *
 * `.env.local` is written by `npm run dev` from the LOCAL stack. So this command, run
 * exactly as the docs give it but with a production site, would probe 127.0.0.1 and
 * print a report that reads precisely like a production report: the local stack's own
 * site_url reported as WRONG, a correct hosted allow-list reported as missing. Every
 * line of it true, about the wrong project.
 *
 * A configuration check that answers confidently about the wrong stack is worse than no
 * check at all, because it gets believed - and this one exists to be believed about a
 * setting nothing else in the repo can see. So refuse the combination rather than guess
 * which half was meant. */
const isLocal = (u) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/.test(u);

if (isLocal(authUrl) !== isLocal(site)) {
  const why = isLocal(authUrl)
    ? `The auth server is your LOCAL stack - .env.local is written by \`npm run dev\` - so
  nothing it reports applies to ${site}.`
    : `The auth server is a HOSTED project, but the site given is a local address.`;
  console.error(`
  These are not the same stack:

    Auth server : ${authUrl}
    Site        : ${site}

  ${why}

  To check the HOSTED project:

    VITE_SUPABASE_URL=https://<ref>.supabase.co npm run verify:redirects -- ${site}

  To check the local stack:

    npm run verify:redirects -- http://localhost:5173
`);
  process.exit(2);
}

/* Where does a rejected verification go? For an ALLOWED redirect_to, back to that
 * address carrying an error fragment. For one that is not allowed, to the Site URL -
 * so the same request answers both questions. */
async function landsOn(redirectTo) {
  const u = `${authUrl}/auth/v1/verify?token=never-valid&type=magiclink&redirect_to=${encodeURIComponent(redirectTo)}`;
  const res = await fetch(u, { redirect: "manual" });
  return res.headers.get("location") || "";
}

const probes = [
  { label: "the front door", to: `${site}/` },
  { label: "an invite link", to: `${site}/join/PGSKN2-EXAMPLE1234` },
  { label: "a league page", to: `${site}/l/00000000-0000-0000-0000-000000000000/comm` },
];

console.log(`\n  Auth server : ${authUrl}`);
console.log(`  Site        : ${site}\n`);

let bad = 0;

/* The Site URL is whatever an address nobody allowed falls back to. */
const fallback = await landsOn("https://not-allowed.invalid/x");
const siteUrl = fallback.split("#")[0] || "(none)";
if (siteUrl.replace(/\/+$/, "") === site) {
  console.log(`  OK    Site URL is ${siteUrl}`);
} else {
  bad++;
  console.log(`  WRONG Site URL is ${siteUrl}`);
  console.log(`        Expected ${site}. Anyone whose link cannot be honoured is sent`);
  console.log(`        there instead. Fix: Authentication -> URL Configuration.`);
}

for (const p of probes) {
  const got = await landsOn(p.to);
  if (got.split("#")[0] === p.to) {
    console.log(`  OK    ${p.label} is allowed`);
  } else {
    bad++;
    console.log(`  WRONG ${p.label} is NOT allowed - ${p.to}`);
    console.log(`        It falls back to ${got.split("#")[0] || "(nothing)"}.`);
    console.log(`        Add ${site}/** to Redirect URLs - WITH the wildcard.`);
  }
}

console.log(
  bad === 0
    ? "\n  Sign-in links will land where they should.\n"
    : `\n  ${bad} problem(s). docs/EMAIL-SETUP.md section 3 has the dashboard steps.\n`
);
process.exit(bad === 0 ? 0 : 1);
