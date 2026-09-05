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
  whoami: (db, p) => ops.whoami(db, p),

  /* Phase 3d. `createLeague`, `myLeagues` and `redeemInvite` take an ACCOUNT rather than
   * a league session, so they are the only routes that work with no leagueId at all. */
  createLeague: (db, p) => ops.createLeague(db, p),
  myLeagues: (db, p) => ops.myLeagues(db, p),
  redeemInvite: (db, p) => ops.redeemInvite(db, p),
  createInvite: (db, p) => ops.createInvite(db, p),
  listInvites: (db, p) => ops.listInvites(db, p),
  revokeInvite: (db, p) => ops.revokeInvite(db, p),
  listMembers: (db, p) => ops.listMembers(db, p),
  setMemberRole: (db, p) => ops.setMemberRole(db, p),
  setLeagueVisibility: (db, p) => ops.setLeagueVisibility(db, p),

  setStatLine: (db, p) => ops.setStatLine(db, p),
  swapLineupSlot: (db, p) => ops.swapLineupSlot(db, p),
  submitScheme: (db, p) => ops.submitScheme(db, p),
  schemeStatus: (db, p) => ops.schemeStatus(db, p),
  toggleSlotLock: (db, p) => ops.toggleSlotLock(db, p),
  toggleRosterLock: (db, p) => ops.toggleRosterLock(db, p),

  dealPeriod: (db, p) => ops.dealPeriod(db, p),
  processSchemes: (db, p) => ops.processSchemes(db, p),
  finalizePeriod: (db, p) => ops.finalizePeriod(db, p),
  startPlayoffs: (db, p) => ops.startPlayoffs(db, p),

  replaceLeague: (db, p) => ops.replaceLeague(db, p),
  refreshPlayerPool: (db, p) => ops.refreshPlayerPool(db, p),
  pullStats: (db, p) => ops.pullStats(db, p),
  setNflWeek: (db, p) => ops.setNflWeek(db, p),
  setLineupLock: (db, p) => ops.setLineupLock(db, p),
  refreshKickoffs: (db, p) => ops.refreshKickoffs(db, p),
};

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
    const result = await route(db, { ...(payload.params || {}), token });
    return json(result.status, result.body);
  } catch (e) {
    return json(500, { ok: false, error: e?.message || "Unexpected server error." });
  }
}
