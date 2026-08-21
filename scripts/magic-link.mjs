#!/usr/bin/env node
/* Pigskin Poker - fish the sign-in link out of the local mail catcher.
 *
 * Magic links are the production sign-in path, so local development uses the real one:
 * the app asks Supabase for a link, Supabase sends it, and the local stack captures the
 * message at http://127.0.0.1:54324 instead of delivering it. That is correct and worth
 * keeping - but "go and open the mail catcher, find the newest message, click the
 * button" is four steps of friction on every single sign-in.
 *
 * So the link comes to you instead:
 *
 *   - `npm run dev` watches the mailbox and prints each new link as it arrives.
 *   - `npm run link` prints the newest one on demand.
 *   - `npm run link -- --open` opens it, signing that browser in.
 *
 * Nothing here touches the app. There is no dev-only sign-in bypass in the client, and
 * adding one would defeat the point of developing against the real auth flow - this
 * just reads the mailbox a human would otherwise read.
 */

import { spawn } from "node:child_process";

export const MAIL_URL = process.env.MAILPIT_URL || "http://127.0.0.1:54324";

/** Mailpit escapes the URL for HTML; `&amp;` in a query string is not a parameter. */
const unescapeUrl = (u) => u.replace(/&amp;/g, "&");

async function api(path) {
  const r = await fetch(MAIL_URL + path);
  if (!r.ok) throw new Error("mail catcher returned " + r.status);
  return r.json();
}

/** Newest first. */
export async function listMessages(limit = 25) {
  const data = await api("/api/v1/messages?limit=" + limit);
  return data.messages || [];
}

/** The first link in a message body - which is the verify URL in every template here. */
export async function linkFor(messageId) {
  const full = await api("/api/v1/message/" + messageId);
  const body = full.HTML || full.Text || "";
  const found = body.match(/https?:\/\/[^"'<>\s]+/);
  return found ? unescapeUrl(found[0]) : null;
}

/**
 * The newest sign-in link, optionally for one address.
 * @returns {{email: string, link: string, created: string}|null}
 */
export async function latestLink(email = null) {
  const wanted = email ? String(email).trim().toLowerCase() : null;
  for (const m of await listMessages(50)) {
    const to = (m.To?.[0]?.Address || "").toLowerCase();
    if (wanted && to !== wanted) continue;
    const link = await linkFor(m.ID);
    if (link) return { email: to, link, created: m.Created };
  }
  return null;
}

/**
 * Print each NEW sign-in link as it arrives, for as long as the dev server runs.
 *
 * Messages already in the mailbox are marked seen at startup rather than replayed -
 * dumping a backlog of dead links (each one works once) would train you to ignore the
 * output, which is the opposite of the point.
 *
 * Every failure is swallowed. This is a convenience attached to `npm run dev`, and it
 * must never be the reason the dev server appears broken.
 */
export function watchLinks({ log = console.log, intervalMs = 1500 } = {}) {
  const seen = new Set();
  let started = false;

  const tick = async () => {
    let messages;
    try {
      messages = await listMessages(25);
    } catch {
      return; // catcher not up yet, or restarting
    }
    const fresh = messages.filter((m) => !seen.has(m.ID));
    for (const m of messages) seen.add(m.ID);
    if (!started) {
      started = true; // first pass only establishes the baseline
      return;
    }
    // Oldest first, so a burst reads in the order the requests were made.
    for (const m of fresh.reverse()) {
      try {
        const link = await linkFor(m.ID);
        if (!link) continue;
        log(
          "\n  >> SIGN-IN LINK for " + (m.To?.[0]?.Address || "someone") + "\n" +
          "     " + link + "\n" +
          "     (works once - open it in the browser you want signed in)\n"
        );
      } catch {
        /* ignore - a message that cannot be read is not worth a stack trace here */
      }
    }
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.(); // never hold the process open on its own
  tick();
  return () => clearInterval(timer);
}

/* ------------------------------------------------------------------- cli -- */

if (process.argv[1] && process.argv[1].endsWith("magic-link.mjs")) {
  const args = process.argv.slice(2);
  const open = args.includes("--open");
  const email = args.find((a) => !a.startsWith("--")) || null;

  let found;
  try {
    found = await latestLink(email);
  } catch (e) {
    console.error(
      "\n  Could not reach the mail catcher at " + MAIL_URL + " (" + e.message + ").\n" +
      "  Is the local stack running? `npm run dev`\n"
    );
    process.exit(1);
  }

  if (!found) {
    console.error(
      "\n  No sign-in email" + (email ? " for " + email : "") + " in the mailbox yet.\n" +
      "  Ask for one on the app's Sign In screen, then run this again.\n"
    );
    process.exit(1);
  }

  console.log("\n  Sign-in link for " + found.email + ":\n\n  " + found.link + "\n");

  if (open) {
    const cmd = process.platform === "darwin" ? "open"
      : process.platform === "win32" ? "start" : "xdg-open";
    spawn(cmd, [found.link], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
    console.log("  Opening it now - that consumes the link.\n");
  }
}
