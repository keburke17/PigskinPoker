/* Supabase adapter - the store. (It had a sibling: an in-memory adapter, deleted
 * once local development moved to the real stack. See src/storage/index.js.)
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
import { authLinkErrorForThisPageLoad } from "./authCallback.js";

/* schemes must be selected by explicit columns: the column-level grant withholds
 * submitted_at, and `*` would fail outright with 42501 rather than omitting it. */
const SCHEME_COLS = "id,period_id,team_id,type,position,player_id,resolved_at,outcome";

export function createSupabaseStore(config) {
  const { url, publishableKey, apiPath = "/api", leagueName = null } = config;
  /* Phase 3d. WHICH league this store is looking at, set from the URL by the router.
   * Before multi-league there was only ever one, discovered by scanning; now the route
   * is the authority and the scan is a fallback for a single-league deployment that has
   * not been given an id. */
  let pinnedLeagueId = config.leagueId ?? null;
  /* Phase 3c turns the auth half of this client ON.
   *
   * `persistSession` is what makes an account worth having: without it a magic-link
   * session would evaporate on reload and people would be signing in every visit, which
   * is strictly worse than the join code they already have.
   *
   * `detectSessionInUrl` is how a magic link completes - Supabase puts the tokens in
   * the URL fragment on the way back, and this is what picks them up and then cleans
   * the address bar.
   *
   * Reads are unaffected. Once someone is signed in, PostgREST sees `authenticated`
   * rather than `anon`, and every read policy and grant in the schema names both roles
   * deliberately. */
  const sb = createClient(url, publishableKey, {
    auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
  });

  let leagueId = null;
  let listeners = new Set();
  let channel = null;
  /* The access token of a signed-in account, mirrored here so `call` stays synchronous.
   * Kept current by onAuthStateChange below, which also fires on token refresh - so a
   * long session does not start sending a stale token an hour in. */
  let accountToken = null;
  sb.auth.getSession().then(({ data }) => { accountToken = data?.session?.access_token ?? null; });
  sb.auth.onAuthStateChange((_event, session) => {
    accountToken = session?.access_token ?? null;
  });

  /* For operations that identify an ACCOUNT rather than a league session: creating a
   * league, listing your leagues, redeeming an invite. The token goes in the BODY,
   * because the Authorization header means "this league session" to the server. */
  async function callWithAccount(action, params) {
    if (!accountToken) {
      return { ok: false, reason: "unauthorized", message: "Sign in first." };
    }
    let res;
    try {
      res = await fetch(apiPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, params: { ...params, accountToken } }),
      });
    } catch (e) {
      return { ok: false, reason: "network", message: e?.message || "Network error" };
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) return { ...body, ok: true };
    return { ok: false, reason: res.status === 401 ? "unauthorized" : "invalid", message: body.error };
  }

  async function call(action, params) {
    /* The account's access token, and there is no other kind. Supabase refreshes it;
     * nothing of ours is stored in localStorage for the server to trust. */
    const token = accountToken;
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
    if (res.status === 429) {
      // Rate limited. `retryAfter` is seconds, and the login screen shows it rather
      // than telling someone to "try again later" with no idea how much later.
      return { ok: false, reason: "throttled", message: body.error, retryAfter: body.retryAfter ?? null };
    }
    if (res.status === 401) return { ok: false, reason: "unauthorized", message: body.error };
    if (res.status === 403) return { ok: false, reason: "forbidden", message: body.error };
    if (res.status >= 500) return { ok: false, reason: "network", message: body.error };
    return { ok: false, reason: "invalid", message: body.error, view: body.view };
  }

  async function fetchRows() {
    /* WHICH LEAGUE.
     *
     * The URL decides, when it says. `/l/<id>` is now the normal way to reach a league,
     * so the id arrives from the route and nothing has to be guessed.
     *
     * The scan below is what happens without one - a single-league deployment opened at
     * `/`, which is every deployment that existed before this phase. It stays because
     * taking it away would mean the existing league's bookmarks stop working.
     *
     * Note what the scan now returns: reads are league-scoped, so `select *` returns
     * only leagues this visitor may see. "More than one" therefore means genuinely
     * ambiguous FOR THEM, not merely that the database holds several. */
    let chosen = null;

    if (pinnedLeagueId) {
      const one = await sb.from("leagues").select("*").eq("id", pinnedLeagueId).maybeSingle();
      if (one.error) throw new Error("Couldn't read the league: " + one.error.message);
      /* Null here is indistinguishable from "exists but you may not see it", and that
       * is deliberate: telling a stranger a private league exists is the leak the read
       * policies were rewritten to prevent. */
      if (!one.data) return null;
      chosen = one.data;
    } else {
      const all = await sb.from("leagues").select("*");
      if (all.error) throw new Error("Couldn't read the league: " + all.error.message);

      const leagues = all.data ?? [];
      if (leagues.length === 0) return null; // nothing bootstrapped, or nothing visible

      if (leagueName) {
        // VITE_LEAGUE_NAME is retired by multi-league but still honoured, so an existing
        // deployment that sets it does not break on upgrade.
        chosen = leagues.find((l) => l.name === leagueName);
        if (!chosen) {
          throw new Error(
            'No league named "' + leagueName + '". This database has: ' +
            leagues.map((l) => '"' + l.name + '"').join(", ") +
            ". Fix VITE_LEAGUE_NAME, or remove it to use the only league."
          );
        }
      } else if (leagues.length === 1) {
        chosen = leagues[0];
      } else {
        // Ambiguous. The landing page's league picker is the answer, not an error.
        return { ambiguous: leagues.map((l) => ({ id: l.id, name: l.name })) };
      }
    }

    leagueId = chosen.id;
    const league = { data: chosen };

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
    if (!rows) return null;
    // More than one visible league and nothing chosen - the caller shows a picker.
    if (rows.ambiguous) return { _ambiguous: rows.ambiguous };
    return hydrateLeague(rows);
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

    /**
     * Why the magic link that brought us here failed, if it did.
     *
     * detectSessionInUrl consumes the URL fragment. When the link WORKED that is
     * exactly right; when it did not, that fragment held the only explanation anyone
     * was ever going to get, and it went in the bin - which is what turned one
     * expired link into a sign-in loop nobody could see the cause of. The reading is
     * taken in authCallback.js before React starts; this just hands it over.
     */
    getAuthLinkError() {
      return authLinkErrorForThisPageLoad();
    },

    async logout() {
      /* Nothing server-side to destroy any more - Supabase owns the session, and
       * signOut revokes it there. The local variable is cleared first so an in-flight
       * request cannot use a token that is on its way out. */
      accountToken = null;
      try {
        await sb.auth.signOut();
      } catch {
        /* already signed out, or offline: the local token is gone either way */
      }
      return { ok: true };
    },

    /* ----------------------------- accounts ------------------------------ */

    /**
     * Send a magic link. Chosen over passwords deliberately: nothing to store, no reset
     * flow to build, and it suits a dozen people who sign in a few times a season.
     */
    async signInWithEmail(email, redirectTo = null) {
      const { error } = await sb.auth.signInWithOtp({
        email: String(email || "").trim(),
        options: {
          /* COME BACK TO THE PAGE THEY LEFT, not to the front door.
           *
           * This matters most on `/join/<code>`: sending them to the origin would
           * discard the invite code, and the screen has just promised them it would be
           * waiting. They would have to go and find the text message again.
           *
           * The hosted project's redirect allow-list must therefore permit paths -
           * `https://your-site/**`, not just the bare origin - or these are rejected
           * outright and look like broken links. docs/EMAIL-SETUP.md says so. */
          emailRedirectTo: redirectTo || globalThis.location?.href || globalThis.location?.origin,
          /* Typing an address creates an ACCOUNT and nothing else. An account only
           * becomes a member of a league by redeeming an invitation, so a stray
           * sign-up is inert - it can see nothing and act on nothing.
           *
           * NOTE FOR ANYONE DEBUGGING EMAIL: this is what decides which template
           * Supabase sends. A brand new address gets "Confirm signup"; one that
           * already exists gets "Magic Link". Both must be branded in the hosted
           * dashboard or first-time members get the unbranded default - see
           * tests/config.test.js and docs/EMAIL-SETUP.md. */
          shouldCreateUser: true,
        },
      });
      if (error) return { ok: false, reason: "invalid", message: error.message };
      return { ok: true };
    },

    /** @returns {{email, userId}|null} - the signed-in account, if any. */
    async getAccount() {
      const { data } = await sb.auth.getUser();
      if (!data?.user) return null;
      return { email: data.user.email, userId: data.user.id };
    },


    /** What the server says this credential is - the only authority on an account's role. */
    whoami: () => call("whoami", {}),

    /* --------------------- leagues, invites, membership ------------------ */

    /** Point this store at a league. The router calls it; nothing else should. */
    setLeagueId(id) {
      if (id === pinnedLeagueId) return false;
      pinnedLeagueId = id ?? null;
      leagueId = id ?? null;
      return true; // changed - the caller reloads
    },
    getLeagueId: () => pinnedLeagueId || leagueId,

    /* These three are about an ACCOUNT rather than a league, so they carry the account
     * token in the body. `call` would send it as the Authorization header, which the
     * server reads as a league session - correct everywhere else, wrong here. */
    createLeague: (name, year, visibility) =>
      callWithAccount("createLeague", { name, year, visibility }),
    myLeagues: () => callWithAccount("myLeagues", {}),
    redeemInvite: (code) => callWithAccount("redeemInvite", { code }),

    createInvite: (teamId, role, opts = {}) =>
      call("createInvite", { teamId, role, expiresAt: opts.expiresAt ?? null, maxUses: opts.maxUses ?? null }),
    listInvites: () => call("listInvites", {}),
    revokeInvite: (inviteId) => call("revokeInvite", { inviteId }),
    listMembers: () => call("listMembers", {}),
    setMemberRole: (userId, role) => call("setMemberRole", { userId, role }),
    setLeagueVisibility: (visibility) => call("setLeagueVisibility", { visibility }),

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

    async mutateLeague(fn) {
      const view = await readView();
      const blob = JSON.parse(JSON.stringify(view));
      delete blob._meta;
      fn(blob);
      return call("replaceLeague", { blob });
    },
  };
}
