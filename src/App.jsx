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

import { useMemo, useState } from "react";
import { createStore } from "./storage/index.js";
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
import { EmptyState, ErrorBanner, SaveStatusBar } from "./components/atoms.jsx";
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
  const store = useMemo(() => createStore(), []);
  const league = useLeague(store);

  const {
    view: state,
    identity,
    setIdentity,
    loading,
    loadFailed,
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
  const [tab, setTab] = useState("home");

  const saveStatus = saveState.status;
  const lastSavedAt = saveState.lastSavedAt;
  const saveErrorDetail = saveState.error;

  /* Operation failures surface through the same banners the artifact used, so the
   * screens below did not change: a phase violation or a rejected write reads as a
   * deal/finalize error depending on which action raised it. */
  const dealError = opError && opError.headline ? opError.headline : null;
  const finalizeError = dealError;

  /* ---- login (still client-checked in 2b; Phase 2c moves it server-side) ---- */
  const onCommissionerLogin = (code) => {
    const trimmed = (code || "").trim();
    if (!state.commissionerCode) {
      if (!trimmed) {
        setLoginError("Enter a code to create the commissioner login.");
        return;
      }
      store.setCommissionerCode(trimmed);
      setIdentity({ role: "commissioner", teamId: null });
      setLoginError(null);
    } else if (trimmed === state.commissionerCode) {
      setIdentity({ role: "commissioner", teamId: null });
      setLoginError(null);
    } else {
      setLoginError("Incorrect commissioner code.");
    }
  };

  const onManagerLogin = (teamId, joinCode) => {
    const team = state.teams.find((t) => t.id === teamId);
    if (!team) {
      setLoginError("Select a team first.");
      return;
    }
    if (!team.joinCode) {
      setLoginError("This team doesn't have a join code set yet - ask your commissioner to set one.");
      return;
    }
    if (team.joinCode !== joinCode) {
      setLoginError("Incorrect join code.");
      return;
    }
    setIdentity({ role: "manager", teamId });
    setLoginError(null);
  };

  const onLogout = () => {
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
        joinCode: "",
        roster: null,
        cumulative: emptyCumulative(),
        playoffCumulative: emptyCumulative(),
      });
    });
  const onRenameTeam = (id, name) => onRenameMyTeam(id, name);
  const onSetJoinCode = (id, code) => {
    store.setTeamJoinCode(id, code);
    ops.mutate("joinCode:" + id, () => {});
  };
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
        <LoginScreen state={state} onCommissionerLogin={onCommissionerLogin} onManagerLogin={onManagerLogin} loginError={loginError} setLoginError={setLoginError} />
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
              onAddTeam={onAddTeam} onRenameTeam={onRenameTeam} onSetJoinCode={onSetJoinCode} onRemoveTeam={onRemoveTeam}
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

