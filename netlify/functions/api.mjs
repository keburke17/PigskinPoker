/* The HTTP boundary. Deliberately thin.
 *
 * All the logic lives in server/operations.js, which is plain async functions taking a
 * Supabase client - so it is unit-tested directly against a real Postgres
 * (tests/server.test.js) without needing the Netlify runtime. This file only maps HTTP
 * to those functions. Keep it that way: anything with a decision in it belongs in
 * server/, where it can be tested.
 *
 * THE SECRET KEY IS READ HERE AND NEVER LEAVES. It comes from Netlify's environment
 * variables (and .env.local in development). It is not prefixed VITE_, so Vite cannot
 * expose it to the browser even by accident.
 */

import { createSecretClient } from "../../server/supabase.js";
import * as ops from "../../server/operations.js";

const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

/** action -> handler. Anything not listed here is not reachable. */
const ROUTES = {
  loginCommissioner: (db, p) => ops.loginCommissioner(db, p),
  loginManager: (db, p) => ops.loginManager(db, p),
  logout: (db, p) => ops.logout(db, p),

  setStatLine: (db, p) => ops.setStatLine(db, p),
  swapLineupSlot: (db, p) => ops.swapLineupSlot(db, p),
  submitScheme: (db, p) => ops.submitScheme(db, p),
  toggleSlotLock: (db, p) => ops.toggleSlotLock(db, p),
  toggleRosterLock: (db, p) => ops.toggleRosterLock(db, p),

  dealPeriod: (db, p) => ops.dealPeriod(db, p),
  processSchemes: (db, p) => ops.processSchemes(db, p),
  finalizePeriod: (db, p) => ops.finalizePeriod(db, p),
  startPlayoffs: (db, p) => ops.startPlayoffs(db, p),

  replaceLeague: (db, p) => ops.replaceLeague(db, p),
  setTeamJoinCode: (db, p) => ops.setTeamJoinCode(db, p),
  signOutTeam: (db, p) => ops.signOutTeam(db, p),
};

/* The client's address, for login rate limiting ONLY.
 *
 * Netlify sets x-nf-client-connection-ip from the edge connection itself, so it cannot
 * be spoofed by a client header. x-forwarded-for CAN be, and is only consulted as a
 * fallback for other hosts and `netlify dev` - its FIRST entry is used, and it is
 * treated as a hint rather than a fact. That is acceptable precisely because the
 * per-target bucket does not depend on it: someone forging addresses defeats their own
 * IP bucket and still meets the target slowdown.
 *
 * The address is never stored. server/throttle.js hashes it with a pepper before it
 * reaches the database, so the throttle table is a counter and not a visitor log. */
function clientIp(headers = {}) {
  const get = (name) => headers[name] || headers[name.toLowerCase()] || null;
  const direct = get("x-nf-client-connection-ip");
  if (direct) return String(direct).trim();
  const forwarded = get("x-forwarded-for");
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return null;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Use POST." });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "Body is not valid JSON." });
  }

  const route = ROUTES[payload.action];
  if (!route) return json(404, { ok: false, error: "Unknown action." });

  /* The session token travels in the Authorization header, not the body, so it never
   * ends up in a URL, a log line, or a browser history entry. */
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  let db;
  try {
    db = createSecretClient();
  } catch (e) {
    // Misconfiguration, not a user error - say so plainly rather than 500-ing blankly.
    return json(500, { ok: false, error: "Server is not configured: " + e.message });
  }

  try {
    const result = await route(db, { ...(payload.params || {}), token, ip: clientIp(event.headers) });
    /* A throttled login answers with Retry-After so a browser - and anything else
     * speaking HTTP - is told how long to wait, rather than being left to guess. */
    if (result.status === 429 && result.body?.retryAfter) {
      return {
        ...json(429, result.body),
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "retry-after": String(result.body.retryAfter),
        },
      };
    }
    return json(result.status, result.body);
  } catch (e) {
    return json(500, { ok: false, error: e?.message || "Unexpected server error." });
  }
}
