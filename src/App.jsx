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
    submittedTeamIds,
    poolReport,
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

  /* Why the last magic link failed, if it did - captured on the first render so that
   * dismissing the banner does not bring it straight back. */
  const [linkError] = useState(() => store.getAuthLinkError?.() ?? null);
  const [loginError, setLoginError] = useState(linkError);
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
    /* Not known yet - and this effect re-runs whenever the league in the URL changes, so
     * the flag has to go back to false each time. Left true from the first resolution, it
     * cannot say "still asking", which is what let the render below read an unanswered
     * question as a signed-out visitor and flash the sign-in screen on the way into a
     * league. */
    setAccountChecked(false);
    (async () => {
      try {
        const acct = await store.getAccount();
        if (cancelled) return;
        setAccount(acct);
        if (!acct) {
          /* A definite answer: no account, so no role. A role left in localStorage by a
           * previous visit is not evidence of one. */
          setIdentity({ role: null, teamId: null });
        } else if (store.whoami) {
          let me = await store.whoami();
          if (cancelled) return;

          /* An account with no membership in this league is correctly nobody here, and
           * gets the sign-in screen rather than a role. A call minting a membership
           * from a join-code session held on the same device used to sit at this point;
           * codes are gone, and an invitation is the only way in. */
          if (me?.ok && me.role) setIdentity({ role: me.role, teamId: me.teamId ?? null });
          /* "You are nobody HERE" has to CLEAR a role, because identity is one
           * localStorage key rather than one per league: a commissioner of another
           * league would otherwise walk in still holding the panel. Only on a definite
           * answer - a server error leaves what we had rather than signing someone out
           * over a blip. */
          else if (me?.ok) setIdentity({ role: null, teamId: null });
        }
      } catch {
        /* Offline, or auth unreachable. This must never block the app from rendering -
         * it just means no account was detected, and the sign-in screen is shown. */
      } finally {
        if (!cancelled) setAccountChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [store, setIdentity, routeLeagueId]);

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
    if (route.name === "league" || !account) return;
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

  const onLogout = async () => {
    try {
      await store.logout?.();
    } catch {
      /* logging out locally matters more than the round trip succeeding */
    }
    setIdentity({ role: null, teamId: null });
    /* CLEAR THE ACCOUNT, and leave for the front door.
     *
     * Both halves were wrong. `account` outliving the session left the landing page
     * offering "Your Leagues" and a sign-out button to somebody who had just signed
     * out. And this used to call setTab("home"), which is a LEAGUE route - so signing
     * out of the landing page navigated INTO the league just left, to be told it was
     * private. The front door is the only sane place to land. */
    setAccount(null);
    go({ name: "landing" });
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
  const onRefreshPool = () => ops.refreshPlayerPool();
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
   * Every route other than a league now lands on the front door. There used to be a
   * second case here: the in-memory demo had no auth provider, so `/` fell through to
   * the join-code login instead. That adapter is gone (see src/storage/index.js), and
   * with it the branch. */
  if (route.name !== "league") {
    return (
      <div className="pp-root">
        <LandingScreen
          account={account}
          leagues={myLeagues}
          leaguesLoading={leaguesLoading}
          initialCode={route.name === "join" ? route.code : ""}
          /* Arriving from a link that did not work means the answer is "send me
             another", so open that door rather than showing the error above three
             buttons and leaving them to guess which one. */
          initialMode={linkError ? "signin" : null}
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

  /* Nothing to show at this URL. There are two ways to arrive here, and they want
   * different words:
   *
   *   - SIGNED OUT, at a league that is members-only. The reads are RLS-scoped, so an
   *     anonymous visitor genuinely cannot see it and "no league" is all the client can
   *     tell. Sending them to the front door is the right move; it used to be a join
   *     code box, which at least explained itself, and losing that made this screen the
   *     one people would actually hit.
   *
   *   - SIGNED IN, at a fresh deployment with no leagues in it at all. There is no
   *     bootstrap script to run any more - a league is created in the app, by whoever
   *     will own it. */
  if (noLeague) {
    return (
      <div className="pp-root">
        <div className="pp-login-wrap">
          <div className="pp-login-card">
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div className="pp-eyebrow">Pigskin Poker</div>
              <h1 className="pp-h1" style={{ fontSize: 26 }}>
                {account ? "No league here yet" : "Nothing to see here"}
              </h1>
            </div>
            <div className="pp-card">
              {account ? (
                <>
                  <p className="pp-sub" style={{ marginBottom: 10 }}>
                    The database is connected and working - there is just no league at this
                    address, or none you are a member of.
                  </p>
                  <p className="pp-sub">
                    If you are setting this deployment up, create one: whoever makes a league
                    is its commissioner, and everyone else joins by invitation.
                  </p>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="pp-btn pp-btn-gold" onClick={() => go({ name: "home" })}>
                      Create A League
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* A magic link can land here too - an old email pointing at a league
                      someone is no longer signed in to. Without this the failure is
                      silent again, just on a different screen. */}
                  {linkError ? <ErrorBanner message={linkError} /> : null}
                  <p className="pp-sub" style={{ marginBottom: 10 }}>
                    This league is private, or it does not exist. Sign in - if you are a
                    member, it will be waiting.
                  </p>
                  <p className="pp-sub" style={{ marginBottom: 10 }}>
                    Not a member yet? Ask your commissioner for an invite link. Signing in on
                    its own does not join you to a league.
                  </p>
                  <button className="pp-btn pp-btn-gold" onClick={() => go({ name: "home" })}>
                    Sign In
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* `accountChecked` belongs here as much as `loading` does. The league read and the
   * identity lookup are two independent round trips, and the read usually wins - so
   * without it there is a window with the league loaded and the role still unknown,
   * which the test below reads as "signed out". That is the sign-in screen appearing
   * for a moment on the way into a league someone is perfectly entitled to. */
  if (loading || !state || !accountChecked) {
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
          onSignInWithEmail={onSignInWithEmail}
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
              onAddTeam={onAddTeam} onRenameTeam={onRenameTeam} onRemoveTeam={onRemoveTeam}
              invites={invites} onCreateInvite={onCreateInvite} onRevokeInvite={onRevokeInvite}
              onDeal={onDeal} onProcessSchemes={onProcessSchemes} dealError={dealError}
              submittedTeamIds={submittedTeamIds}
              onSwap={onSwap} onSubmitScheme={onSubmitScheme}
              onAddPlayer={onAddPlayer} onSetStatus={onSetStatus} onDeletePlayer={onDeletePlayer}
              onRefreshPool={onRefreshPool} poolReport={poolReport}
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

