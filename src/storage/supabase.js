/* Supabase adapter. Implements the same interface as the in-memory store.
 *
 * SPLIT ON PURPOSE:
 *   READS  go straight to PostgREST with the PUBLISHABLE key. That key is public and
 *          ships to every browser; RLS is what makes that safe, and reading directly
 *          is also what lets Realtime work.
 *   WRITES go to a Netlify Function holding the SECRET key, which authenticates the
 *          session and enforces the commissioner/manager rules server-side. The
 *          publishable key has no write grant on any table, so a client cannot route
 *          around that function even if it tries.
 *
 * The session token lives in localStorage and travels in an Authorization header.
 */

import { createClient } from "@supabase/supabase-js";
import { hydrateLeague } from "./hydrate.js";

const SESSION_KEY = "pigskin_session_v1";

/* schemes must be selected by explicit columns: the column-level grant withholds
 * submitted_at, and `*` would fail outright with 42501 rather than omitting it. */
const SCHEME_COLS = "id,period_id,team_id,type,position,player_id,resolved_at,outcome";

export function loadSessionToken() {
  try {
    return globalThis.localStorage?.getItem(SESSION_KEY) || null;
  } catch {
    return null;
  }
}
export function saveSessionToken(token) {
  try {
    if (token) globalThis.localStorage?.setItem(SESSION_KEY, token);
    else globalThis.localStorage?.removeItem(SESSION_KEY);
  } catch {
    /* private mode - the person just logs in again next visit */
  }
}

export function createSupabaseStore(config) {
  const { url, publishableKey, apiPath = "/api", leagueName = "Pigskin Poker" } = config;
  const sb = createClient(url, publishableKey, { auth: { persistSession: false } });

  let leagueId = null;
  let listeners = new Set();
  let channel = null;

  async function call(action, params) {
    const token = loadSessionToken();
    let res;
    try {
      res = await fetch(apiPath, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify({ action, params: { ...params, leagueId } }),
      });
    } catch (e) {
      // Network-shaped failures are retryable; the write queue will back off.
      return { ok: false, reason: "network", message: e?.message || "Network error" };
    }
    let body;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: "network", message: "Server returned a non-JSON response" };
    }
    // Pass the whole body through. Returning only { ok, view } silently dropped the
    // session token on login, so the app looked signed in while every privileged write
    // would have 401'd. Found by driving the real login in the browser.
    if (res.ok && body.ok) return { ...body, ok: true };
    if (res.status === 409) {
      return { ok: false, reason: body.reason || "stale", view: body.view, key: body.key, message: body.error };
    }
    if (res.status === 401) return { ok: false, reason: "unauthorized", message: body.error };
    if (res.status === 403) return { ok: false, reason: "forbidden", message: body.error };
    if (res.status >= 500) return { ok: false, reason: "network", message: body.error };
    return { ok: false, reason: "invalid", message: body.error, view: body.view };
  }

  async function fetchRows() {
    const league = await sb.from("leagues").select("*").eq("name", leagueName).maybeSingle();
    if (league.error) throw new Error("Couldn't read the league: " + league.error.message);
    if (!league.data) return null; // no league yet - safe to start fresh
    leagueId = league.data.id;

    const seasons = await sb.from("seasons").select("*").eq("league_id", leagueId);
    if (seasons.error) throw new Error("Couldn't read seasons: " + seasons.error.message);
    const seasonIds = (seasons.data ?? []).map((s) => s.id);

    const [teams, players, periods] = await Promise.all([
      sb.from("teams").select("*").eq("league_id", leagueId),
      sb.from("players").select("*").eq("league_id", leagueId),
      sb.from("periods").select("*").in("season_id", seasonIds),
    ]);
    const periodIds = (periods.data ?? []).map((p) => p.id);
    const inPeriods = (t, cols = "*") =>
      periodIds.length ? sb.from(t).select(cols).in("period_id", periodIds) : Promise.resolve({ data: [] });

    const [totals, slots, stats, schemes, results, events] = await Promise.all([
      sb.from("team_totals").select("*").in("season_id", seasonIds),
      inPeriods("roster_slots"),
      inPeriods("stat_lines"),
      inPeriods("schemes", SCHEME_COLS),
      inPeriods("period_results"),
      sb.from("events").select("*").in("season_id", seasonIds),
    ]);

    for (const r of [teams, players, periods, totals, slots, stats, schemes, results, events]) {
      if (r.error) throw new Error("Couldn't read the league: " + r.error.message);
    }
    return {
      leagues: [league.data],
      seasons: seasons.data ?? [],
      teams: teams.data ?? [],
      players: players.data ?? [],
      periods: periods.data ?? [],
      team_totals: totals.data ?? [],
      roster_slots: slots.data ?? [],
      stat_lines: stats.data ?? [],
      schemes: schemes.data ?? [],
      period_results: results.data ?? [],
      events: events.data ?? [],
    };
  }

  async function readView() {
    const rows = await fetchRows();
    return rows ? hydrateLeague(rows) : null;
  }

  return {
    /* ------------------------------- reads ------------------------------- */
    async loadLeague() {
      // Throws on a genuine failure and resolves null only for "no league yet".
      // That distinction is what keeps the app from starting blank and saving
      // emptiness over real data.
      return readView();
    },

    /** Live updates so a manager watching on Sunday sees stats without refreshing. */
    subscribe(fn) {
      listeners.add(fn);
      if (!channel) {
        const push = async () => {
          try {
            const v = await readView();
            if (v) listeners.forEach((l) => l(v));
          } catch {
            /* a dropped refresh is not fatal; the next event will retry */
          }
        };
        channel = sb.channel("league");
        // Realtime respects RLS, so this leaks nothing beyond the read policies.
        // `schemes` is deliberately NOT in the publication - a change event would
        // reveal that a scheme was submitted, mid-week.
        for (const table of [
          "periods", "roster_slots", "stat_lines", "period_results", "team_totals", "events", "teams",
        ]) {
          channel.on("postgres_changes", { event: "*", schema: "public", table }, push);
        }
        channel.subscribe();
      }
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0 && channel) {
          sb.removeChannel(channel);
          channel = null;
        }
      };
    },

    /* ------------------------------- auth -------------------------------- */
    async loginCommissioner(code) {
      const r = await call("loginCommissioner", { code });
      if (r.ok && r.token) saveSessionToken(r.token);
      return r;
    },
    async loginManager(teamLegacyId, code) {
      const r = await call("loginManager", { teamLegacyId, code });
      if (r.ok && r.token) saveSessionToken(r.token);
      return r;
    },
    async logout() {
      const r = await call("logout", {});
      saveSessionToken(null);
      return r;
    },

    /* ------------------------------- writes ------------------------------ */
    setStatLine: (teamId, slot, line, expect) => call("setStatLine", { teamId, slot, line, expect }),
    swapLineupSlot: (teamId, slot, benchIndex, expect) =>
      call("swapLineupSlot", { teamId, slot, benchIndex, expect }),
    submitScheme: (teamId, scheme, expect) => call("submitScheme", { teamId, scheme, expect }),
    toggleSlotLock: (teamId, playerId) => call("toggleSlotLock", { teamId, playerId }),
    toggleRosterLock: (expect) => call("toggleRosterLock", { expect }),
    dealPeriod: (expect) => call("dealPeriod", { expect }),
    processSchemes: (expect) => call("processSchemes", { expect }),
    finalizePeriod: (expect) => call("finalizePeriod", { expect }),
    startPlayoffs: (bracketSize, advancement) => call("startPlayoffs", { bracketSize, advancement }),
    setTeamJoinCode: (teamId, code) => call("setTeamJoinCode", { teamId, code }),

    async mutateLeague(fn) {
      const view = await readView();
      const blob = JSON.parse(JSON.stringify(view));
      delete blob._meta;
      fn(blob);
      return call("replaceLeague", { blob });
    },
  };
}
