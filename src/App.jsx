/* Pigskin Poker - application root.
 *
 * Originally LegacyProject/PigskinPokerCode.jsx lines 2102-2529. The RENDER half is
 * unchanged from that file; what changed is everything above it.
 *
 * PHASE 1 replaced window.storage with a storage interface.
 * PHASE 2b replaced the write path. The artifact's `update(s => ...)` cloned and
 * re-saved the ENTIRE league on every change; each handler below now calls one named
 * operation that writes only what it touches. That is the fix for P1 (two people
 * editing at once silently clobbering each other) and P3 (a full league write per
 * keystroke). The mechanics live in hooks/useLeague.js and storage/writeQueue.js.
 *
 * DELIBERATELY UNCHANGED - see docs/DATA-MODEL.md "Do not change":
 *   - the refusal to silently start blank on a load error (the blocking screen below);
 *   - the save guarantee: aggressive saving, retries, the status bar, and Save Now;
 *   - the commissioner-driven weekly flow.
 */

import { useEffect, useMemo, useState } from "react";
import { createStore } from "./storage/index.js";
import { useRoute } from "./routing/useRoute.js";
import { LandingScreen } from "./components/LandingScreen.jsx";
import { saveSessionToken } from "./storage/supabase.js";
import { useLeague } from "./hooks/useLeague.js";
import { validateBackup } from "./storage/backup.js";
import {
  emptyCumulative,
  nowStamp,
  periodLabel,
  uid,
  POSITIONS,
  SUIT_CH,
} from "./engine/index.js";
import { AccountBar, EmptyState, ErrorBanner, SaveStatusBar } from "./components/atoms.jsx";
import { LoginScreen } from "./components/LoginScreen.jsx";
import { LeagueHomeTab } from "./components/LeagueHomeTab.jsx";
import { MyTeamTab } from "./components/MyTeamTab.jsx";
import { RosterHubTab } from "./components/RosterHubTab.jsx";
import { WeeklyResultsTab } from "./components/WeeklyResultsTab.jsx";
import { RulesTab } from "./components/RulesTab.jsx";
import { CommissionerTab } from "./components/commissioner.jsx";

function errText(e) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e.message) return e.message;
  try {
    return JSON.stringify(e);
  } catch (x) {
    return String(e);
  }
}


/* A rejected login now has THREE shapes, not one, and they want different words.
 *
 *   throttled     - too many attempts. The code may well be right; saying "incorrect
 *                   code" here would send someone hunting for a typo that is not there.
 *                   Says how long to wait when the server told us.
 *   unauthorized  - genuinely the wrong code.
 *   network       - the request never got an answer. Also not a wrong code.
 */
function loginFailureText(result, fallback) {
  if (result?.reason === "throttled") {
    const secs = result.retryAfter;
    if (!secs) return result.message || "Too many sign-in attempts. Wait a moment and try again.";
    const wait = secs < 60
      ? secs + " second" + (secs === 1 ? "" : "s")
      : Math.ceil(secs / 60) + " minute" + (Math.ceil(secs / 60) === 1 ? "" : "s");
    return "Too many sign-in attempts. Try again in about " + wait + ".";
  }
  if (result?.reason === "network") {
    return "Could not reach the server - check your connection and try again.";
  }
  return result?.message || fallback;
}

export default function App() {
  /* THE URL DECIDES WHICH LEAGUE, from Phase 3d.
   *
   * The store is built once with whatever league the initial URL named. Moving between
   * leagues afterwards goes through store.setLeagueId + retryLoad rather than a new
   * store, so the realtime channel and the write queue are not torn down and rebuilt on
   * every navigation. */
  const [route, go] = useRoute();
  const routeLeagueId = route.name === "league" ? route.leagueId : null;
  const store = useMemo(() => createStore(undefined, { leagueId: routeLeagueId }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const league = useLeague(store);

  const {
    view: state,
    identity,
    setIdentity,
    loading,
    loadFailed,
    noLeague,
    loadErrorDetail,
    retryLoad,
    saveState,
    saveNow,
    conflict,
    dismissConflict,
    opError,
    dismissOpError,
    ops,
  } = league;

  const [loginError, setLoginError] = useState(null);
  const [restoreError, setRestoreError] = useState(null);
  /* The tab lives in the URL now, so it is shareable and the back button works - which
   * is the whole of what P6 was about. Local state would immediately disagree with the
   * address bar the first time someone pressed back. */
  const tab = route.name === "league" ? route.tab : "home";
  const setTab = (next) => go({ name: "league", leagueId: routeLeagueId ?? store.getLeagueId?.(), tab: next });
  /* The signed-in ACCOUNT, if there is one. Separate from `identity` on purpose:
   * identity is "what may this device do here", which a join code can answer on its
   * own; this is "who is the person", which only an account can. */
  const [account, setAccount] = useState(null);
  const [accountChecked, setAccountChecked] = useState(false);
  const [linkNotice, setLinkNotice] = useState(null);

  /* Pick up an account session on load - either restored from a previous visit, or
   * just arrived from a magic link, which the Supabase client strips out of the URL.
   *
   * The ROLE is asked of the server rather than remembered locally. A join code answers
   * "which team" by itself, because the code was for exactly one team; an account is
   * just a person until league_members is consulted, and that answer is the server's to
   * give. Getting this wrong would mean a stale localStorage identity deciding what UI
   * someone sees. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!store.getAccount) { setAccountChecked(true); return; }
      try {
        const acct = await store.getAccount();
        if (cancelled) return;
        setAccount(acct);
        if (acct && store.whoami) {
          let me = await store.whoami();
          if (cancelled) return;

          /* Signed in with an account that is not a member of this league yet. The
           * ordinary way to arrive here is having JUST come back from a magic link that
           * was requested by pressing "Connect" - so finish the job that was already
           * asked for, rather than showing the same prompt again to someone who has
           * done everything right.
           *
           * linkAccount needs a join-code session on this device and refuses without
           * one, so a stranger who signs in with an address nobody invited still gets
           * nothing. Failure here is not an error worth showing: it just means there is
           * no membership to connect, and the login screen already explains that. */
          if ((!me?.ok || !me.role) && store.linkAccount) {
            const linked = await store.linkAccount();
            if (cancelled) return;
            if (linked?.ok) me = await store.whoami();
            if (cancelled) return;
          }
          if (me?.ok && me.role) setIdentity({ role: me.role, teamId: me.teamId ?? null });
        }
      } catch {
        /* Offline, or auth unreachable. The join-code path still works, so this must
         * never block the app - it just means no account was detected. */
      } finally {
        if (!cancelled) setAccountChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [store, setIdentity, routeLeagueId]);

  /* Signed in by code, with an account attached, but not yet joined up. This is the
   * "migration by invitation" moment: it is offered, never forced, and declining it
   * costs nothing. */
  const onLinkAccount = async () => {
    setLinkNotice(null);
    const r = await store.linkAccount?.();
    if (!r || r.ok === false) {
      setLinkNotice({ bad: true, text: r?.message || "Could not connect that account." });
      return;
    }
    setLinkNotice({
      bad: false,
      text: r.alreadyMember
        ? "That email is already connected to this league."
        : "Connected. Next time you can just sign in with your email - the join code still works too.",
    });
  };

  /* Following the URL to another league. Reuses the store rather than rebuilding it, so
   * the realtime channel and write queue survive the move. */
  useEffect(() => {
    if (!routeLeagueId || !store.setLeagueId) return;
    if (store.setLeagueId(routeLeagueId)) retryLoad();
  }, [routeLeagueId, store, retryLoad]);

  /* The landing page's data. Only fetched when actually on the landing page - there is
   * no reason to ask "which leagues am I in" while someone is looking at one. */
  const [myLeagues, setMyLeagues] = useState([]);
  const [leaguesLoading, setLeaguesLoading] = useState(false);
  useEffect(() => {
    if (route.name === "league" || !account || !store.myLeagues) return;
    let cancelled = false;
    setLeaguesLoading(true);
    store.myLeagues()
      .then((r) => { if (!cancelled && r?.ok) setMyLeagues(r.leagues ?? []); })
      .finally(() => { if (!cancelled) setLeaguesLoading(false); });
    return () => { cancelled = true; };
  }, [route.name, account, store]);

  const onOpenLeague = (id) => go({ name: "league", leagueId: id, tab: "home" });

  /* Invites, for the commissioner panel. Loaded only when that tab is open - it is an
   * administrative list, not something the weekly flow needs. */
  const [invites, setInvites] = useState([]);
  const refreshInvites = async () => {
    if (!store.listInvites) return;
    const r = await store.listInvites();
    if (r?.ok) setInvites(r.invites ?? []);
  };
  useEffect(() => {
    if (tab !== "comm" || identity.role !== "commissioner") return;
    refreshInvites();
  }, [tab, identity.role]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCreateInvite = async (teamId, role) => {
    const r = await store.createInvite?.(teamId, role);
    if (r?.ok) refreshInvites();
    return r;
  };
  const onRevokeInvite = async (inviteId) => {
    const r = await store.revokeInvite?.(inviteId);
    if (r?.ok) refreshInvites();
    return r;
  };

  const onRedeemInvite = async (code) => {
    setLoginError(null);
    const r = await store.redeemInvite?.(code);
    if (!r || r.ok === false) {
      setLoginError(r?.message || "Could not redeem that code.");
      return;
    }
    /* REPLACE rather than push. Pressing back from a league should not land someone
     * back on a code they have already spent. */
    go({ name: "league", leagueId: r.leagueId, tab: "home" }, { replace: true });
  };

  const onCreateLeague = async (name) => {
    setLoginError(null);
    const r = await store.createLeague?.(name);
    if (!r || r.ok === false) {
      setLoginError(r?.message || "Could not create that league.");
      return;
    }
    go({ name: "league", leagueId: r.leagueId, tab: "comm" });
  };

  const onSignInWithEmail = async (email) => {
    setLoginError(null);
    if (!store.signInWithEmail) {
      setLoginError("Email sign-in needs the hosted database - it is not available in the demo.");
      return { ok: false };
    }
    const r = await store.signInWithEmail(email);
    if (!r.ok) setLoginError(r.message || "Could not send that sign-in link.");
    return r;
  };

  const saveStatus = saveState.status;
  const lastSavedAt = saveState.lastSavedAt;
  const saveErrorDetail = saveState.error;

  /* Operation failures surface through the same banners the artifact used, so the
   * screens below did not change: a phase violation or a rejected write reads as a
   * deal/finalize error depending on which action raised it. */
  const dealError = opError && opError.headline ? opError.headline : null;
  const finalizeError = dealError;

  /* ---- login ----
   * The EXPERIENCE is unchanged: the league still just types a code. What changed is
   * that the code is no longer in the browser to compare against. Verification happens
   * server-side against a hash, and a successful login returns a session token that
   * every privileged write re-checks (fixes P2).
   *
   * Both adapters expose the same async surface, so this does not branch on which
   * store it is talking to. */
  const onCommissionerLogin = async (code) => {
    setLoginError(null);
    const r = await store.loginCommissioner(code);
    if (!r.ok) {
      setLoginError(loginFailureText(r, "Incorrect commissioner code."));
      return;
    }
    if (r.token) saveSessionToken(r.token);
    setIdentity({ role: "commissioner", teamId: null });
  };

  const onManagerLogin = async (teamId, joinCode) => {
    setLoginError(null);
    if (!teamId) {
      setLoginError("Select a team first.");
      return;
    }
    const r = await store.loginManager(teamId, joinCode);
    if (!r.ok) {
      setLoginError(loginFailureText(r, "Incorrect join code."));
      return;
    }
    if (r.token) saveSessionToken(r.token);
    setIdentity({ role: "manager", teamId });
  };

  const onLogout = async () => {
    try {
      await store.logout?.();
    } catch {
      /* logging out locally matters more than the round trip succeeding */
    }
    saveSessionToken(null);
    setIdentity({ role: null, teamId: null });
    setTab("home");
  };

  /* ---- manager actions: one row each, not the whole league ---- */
  const onSwap = (teamId, slot, benchIdx) => ops.swapLineupSlot(teamId, slot, benchIdx);
  const onSubmitScheme = (teamId, scheme) => ops.submitScheme(teamId, scheme);
  const onRenameMyTeam = (teamId, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    ops.mutate("renameTeam:" + teamId, (s) => {
      const t = s.teams.find((x) => x.id === teamId);
      if (t) t.name = trimmed;
    });
  };

  /* ---- commissioner: the weekly cycle ---- */
  const onDeal = () => ops.dealPeriod();
  const onProcessSchemes = () => ops.processSchemes();
  const onFinalize = () => ops.finalizePeriod();
  const onToggleRosterLock = () => ops.toggleRosterLock();

  /* Stat entry is the hot path: instant locally, coalesced and debounced on the wire. */
  const onStatChange = (teamId, slot, value) => {
    if (slot === "__togglelock__") {
      ops.toggleSlotLock(teamId, value);
      return;
    }
    ops.setStatLine(teamId, slot, value);
  };

  /* ---- commissioner: teams ---- */
  const onAddTeam = (name) =>
    ops.mutate("addTeam", (s) => {
      s.teams.push({
        id: uid("team"),
        name,
        roster: null,
        cumulative: emptyCumulative(),
        playoffCumulative: emptyCumulative(),
      });
    });
  const onRenameTeam = (id, name) => onRenameMyTeam(id, name);
  /* Returns the result rather than swallowing it. It used to route failures into
   * `loginError`, whose banner only renders on the login screen - so a commissioner who
   * was, by definition, already signed in never saw them. CommTeamRow shows the outcome
   * next to the field instead. */
  const onSetJoinCode = async (id, code) => store.setTeamJoinCode(id, code);
  const onSignOutTeam = async (id) =>
    (store.signOutTeam ? store.signOutTeam(id) : { ok: true, signedOut: 0 });
  const onRemoveTeam = (id) =>
    ops.mutate("removeTeam:" + id, (s) => {
      s.teams = s.teams.filter((t) => t.id !== id);
      delete s.schemes[id];
      delete s.statsEntry[id];
      s.playoffConfig.activeTeamIds = s.playoffConfig.activeTeamIds.filter((tid) => tid !== id);
    });

  /* ---- commissioner: player pool ---- */
  const onAddPlayer = (name, position, team) =>
    ops.mutate("addPlayer", (s) => {
      s.playerPool.push({ id: uid("pl"), name, position, team, status: "Active" });
    });
  const onSetStatus = (playerId, status) =>
    ops.mutate("playerStatus:" + playerId, (s) => {
      const p = s.playerPool.find((x) => x.id === playerId);
      if (p) p.status = status;
    });
  const onDeletePlayer = (playerId) =>
    ops.mutate("deletePlayer:" + playerId, (s) => {
      s.playerPool = s.playerPool.filter((p) => p.id !== playerId);
      s.teams.forEach((t) => {
        if (!t.roster) return;
        POSITIONS.concat(["FLEX"]).forEach((slot) => {
          if (t.roster.starters[slot] === playerId) t.roster.starters[slot] = null;
        });
        t.roster.bench = t.roster.bench.map((id) => (id === playerId ? null : id));
      });
      Object.keys(s.schemes).forEach((teamId) => {
        if (s.schemes[teamId] && s.schemes[teamId].playerId === playerId) delete s.schemes[teamId];
      });
    });

  /* ---- commissioner: scoring / standings / playoffs / reset ---- */
  const onSaveScoring = (cfg) => ops.mutate("scoring", (s) => { s.scoringConfig = cfg; });
  const onSaveStandingsCfg = (arr) =>
    ops.mutate("standingsCfg", (s) => { s.standingsPointsOverride = arr; });
  const onStartPlayoffs = (bracketSize, advancement) => ops.startPlayoffs(bracketSize, advancement);
  const onResetLeague = () =>
    ops.mutate("reset", (s) => {
      s.teams = [];
      s.schemes = {};
      s.statsEntry = {};
      s.weeklyResults = [];
      s.activityLog = [];
      s.lockedPlayerIds = {};
      s.rosterLocked = false;
      s.currentPeriod = { type: "week", number: 1, phase: "pre-deal" };
      s.playoffConfig = {
        bracketSize: 4, advancement: [4, 2, 1], started: false, completed: false,
        currentRoundIndex: 0, activeTeamIds: [], champion: null,
      };
      s.standingsPointsOverride = null;
    });

  /* ---- backup / restore ---- */
  const onDownloadBackup = () => {
    try {
      const payload = { ...state };
      delete payload._meta; // internal versioning, not part of the backup format
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        "pigskin-poker-backup-" +
        new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") +
        ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setRestoreError({ headline: "Couldn't create the backup file.", detail: errText(e) });
    }
  };

  const onRestoreBackup = (file) => {
    setRestoreError(null);
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        setRestoreError({ headline: "Restore failed - that file isn't valid JSON.", detail: errText(e) });
        return;
      }
      /* P9: the artifact checked only that teams and playerPool were arrays, then put
       * the file straight into app state. Validate the whole shape first, and refuse
       * rather than half-load. */
      const check = validateBackup(parsed);
      if (!check.ok) {
        setRestoreError({
          headline: "Restore failed - that file isn't a valid Pigskin Poker backup.",
          detail: check.problems.join(" "),
        });
        return;
      }
      ops.mutate("restore", (s) => {
        Object.keys(s).forEach((k) => {
          if (k !== "_meta") delete s[k];
        });
        Object.assign(s, check.state);
      });
    };
    reader.onerror = () =>
      setRestoreError({ headline: "Restore failed - couldn't read the file.", detail: errText(reader.error) });
    reader.readAsText(file);
  };

  /* ------------------------------- render ------------------------------- */

  /* THE LANDING PAGE COMES FIRST, before every league gate below.
   *
   * Those gates all reason about a league that failed to load, and on the landing route
   * there is no league to load - so without this, arriving at `/` would show "no league
   * here yet" rather than the front door. The multi-league store correctly reports
   * nothing when it has not been pointed at one.
   *
   * `accountsAvailable` is false for the in-memory demo, which has no auth provider and
   * exactly one league. There, `/` falls through to the ordinary join-code login, which
   * is what `npm run dev` should still do. */
  const accountsAvailable = !!store.signInWithEmail;
  if (route.name !== "league" && accountsAvailable) {
    return (
      <div className="pp-root">
        <LandingScreen
          account={account}
          leagues={myLeagues}
          leaguesLoading={leaguesLoading}
          initialCode={route.name === "join" ? route.code : ""}
          onSignInWithEmail={onSignInWithEmail}
          onRedeemInvite={onRedeemInvite}
          onCreateLeague={onCreateLeague}
          onOpenLeague={onOpenLeague}
          onSignOut={onLogout}
          error={loginError}
          setError={setLoginError}
        />
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="pp-root">
        <div className="pp-login-wrap">
          <div className="pp-login-card">
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div className="pp-eyebrow">Pigskin Poker</div>
              <h1 className="pp-h1" style={{ fontSize: 26 }}>Couldn't load your league</h1>
            </div>
            <div className="pp-card">
              <p className="pp-sub" style={{ marginBottom: 10 }}>
                Storage couldn't be reached, so nothing has been shown or changed - your saved league data is safe.
                This screen stays up on purpose rather than showing an empty league, since that could get saved
                over your real data by accident.
              </p>
              <ErrorBanner message={{ headline: "Storage read failed", detail: loadErrorDetail }} />
              <button className="pp-btn pp-btn-gold pp-btn-block" onClick={retryLoad}>Try Again</button>
              <p className="pp-sub" style={{ marginTop: 10 }}>
                If this keeps happening: check your connection, make sure you opened this app's actual published
                link (not just the chat that built it), and try refreshing the page.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* The database is reachable and correct, but nothing has been bootstrapped into it.
   * Without this the app renders the loading spinner indefinitely, which on a fresh
   * deployment looks like a hang rather than a step that has not been run. */
  if (noLeague) {
    return (
      <div className="pp-root">
        <div className="pp-login-wrap">
          <div className="pp-login-card">
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div className="pp-eyebrow">Pigskin Poker</div>
              <h1 className="pp-h1" style={{ fontSize: 26 }}>No league here yet</h1>
            </div>
            <div className="pp-card">
              <p className="pp-sub" style={{ marginBottom: 10 }}>
                The database is connected and working - it just doesn&apos;t contain a
                league. This is the one setup step that has to be run once, by hand,
                after deploying.
              </p>
              <p className="pp-sub">
                From a checkout of the repo, with this deployment&apos;s Supabase URL and
                secret key in the environment:
              </p>
              <div className="pp-input" style={{ margin: "10px 0", whiteSpace: "pre-wrap" }}>
                PIGSKIN_COMMISSIONER_CODE=&quot;choose-a-code&quot; npm run bootstrap -- --name &quot;Pigskin Poker&quot;
              </div>
              <p className="pp-sub">
                That creates the league, the season and the player pool, and sets the
                commissioner code. Then reload this page and log in.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !state) {
    return (
      <div className="pp-root">
        <div className="pp-login-wrap"><p className="pp-sub">Loading Pigskin Poker...</p></div>
      </div>
    );
  }

  if (!identity.role) {
    return (
      <div className="pp-root">
        <LoginScreen
          state={state}
          onCommissionerLogin={onCommissionerLogin}
          onManagerLogin={onManagerLogin}
          onSignInWithEmail={onSignInWithEmail}
          accountsAvailable={!!store.signInWithEmail}
          loginError={loginError}
          setLoginError={setLoginError}
        />
      </div>
    );
  }

  const isCommissioner = identity.role === "commissioner";
  const myTeam = identity.role === "manager" ? state.teams.find((t) => t.id === identity.teamId) : null;

  const NAV = [
    { key: "home", label: "League Home" },
    ...(identity.role === "manager" ? [{ key: "myteam", label: "My Team" }] : []),
    { key: "hub", label: "Rosters" },
    { key: "results", label: "Weekly Results" },
    { key: "rules", label: "Rules" },
    ...(isCommissioner ? [{ key: "comm", label: "Commissioner" }] : []),
  ];

  return (
    <div className="pp-root">
      
      <div className="pp-container">
        <div className="pp-header">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h1 className="pp-h1">{SUIT_CH.spade} Pigskin Poker {SUIT_CH.diamond}</h1>
              <span className="pp-badge-role">{isCommissioner ? "Commissioner" : myTeam ? myTeam.name : "Manager"}</span>
            </div>
            <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={onLogout}>Log Out</button>
          </div>
          <SaveStatusBar status={saveStatus} lastSavedAt={lastSavedAt} onSaveNow={saveNow} />
          <AccountBar
            account={account}
            accountChecked={accountChecked}
            available={!!store.signInWithEmail}
            notice={linkNotice}
            onLink={onLinkAccount}
            onSignInWithEmail={onSignInWithEmail}
            onDismissNotice={() => setLinkNotice(null)}
          />
          {conflict ? (
            <ErrorBanner
              message={{
                headline: conflict.message,
                detail: "Your change was not applied, so nobody's work was overwritten. The latest version is shown - make the change again if you still want it.",
              }}
              onDismiss={dismissConflict}
            />
          ) : null}
          {opError ? <ErrorBanner message={opError} onDismiss={dismissOpError} /> : null}
          {saveStatus === "error" && saveErrorDetail ? <ErrorBanner message={{ headline: "Save failed - retrying automatically. You can also tap Save Now.", detail: saveErrorDetail }} /> : null}
          <nav className="pp-nav">
            {NAV.map((n) => (
              <button key={n.key} className={"pp-nav-btn" + (tab === n.key ? " active" : "")} onClick={() => setTab(n.key)}>{n.label}</button>
            ))}
          </nav>
        </div>

        <div style={{ paddingTop: 14 }}>
          {tab === "home" && <LeagueHomeTab state={state} />}
          {tab === "myteam" && myTeam && (
            <MyTeamTab state={state} team={myTeam} onSwap={(slot, benchIdx) => onSwap(myTeam.id, slot, benchIdx)} onSubmitScheme={onSubmitScheme} onRename={(name) => onRenameMyTeam(myTeam.id, name)} />
          )}
          {tab === "myteam" && !myTeam && <EmptyState>Your team couldn't be found - ask your commissioner to check the team list.</EmptyState>}
          {tab === "hub" && (
            <RosterHubTab
              state={state} isCommissioner={isCommissioner}
              onStatChange={onStatChange} onToggleRosterLock={onToggleRosterLock}
              onFinalize={onFinalize} finalizeError={finalizeError}
            />
          )}
          {tab === "results" && <WeeklyResultsTab state={state} />}
          {tab === "rules" && <RulesTab state={state} />}
          {tab === "comm" && isCommissioner && (
            <CommissionerTab
              state={state}
              onAddTeam={onAddTeam} onRenameTeam={onRenameTeam} onSetJoinCode={onSetJoinCode} onSignOutTeam={onSignOutTeam} onRemoveTeam={onRemoveTeam}
              invites={invites} onCreateInvite={onCreateInvite} onRevokeInvite={onRevokeInvite}
              invitesAvailable={!!store.createInvite}
              onDeal={onDeal} onProcessSchemes={onProcessSchemes} dealError={dealError}
              onSwap={onSwap} onSubmitScheme={onSubmitScheme}
              onAddPlayer={onAddPlayer} onSetStatus={onSetStatus} onDeletePlayer={onDeletePlayer}
              onSaveScoring={onSaveScoring} onSaveStandingsCfg={onSaveStandingsCfg}
              onStartPlayoffs={onStartPlayoffs}
              onDownloadBackup={onDownloadBackup} onRestoreBackup={onRestoreBackup} restoreError={restoreError}
              onResetLeague={onResetLeague}
            />
          )}
        </div>
      </div>
    </div>
  );
}

