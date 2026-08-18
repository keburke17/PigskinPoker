/* Pigskin Poker - application root.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 2102-2529.
 *
 * WHAT CHANGED IN THE PORT, and nothing else:
 *   - window.storage (4 call sites: legacy 2135, 2168, 2187, 2209) is replaced by the
 *     storage interface in src/storage/. There is no window.storage anywhere in src/.
 *   - Per-device identity moved to localStorage, where it always belonged.
 *   - GLOBAL_CSS is a real stylesheet imported once in main.jsx, so the <style> tag
 *     that was injected in every render path is gone.
 *
 * WHAT DELIBERATELY DID NOT CHANGE - see docs/DATA-MODEL.md "Do not change":
 *   - THE REFUSAL TO SILENTLY START BLANK. On a load error that is not "no league
 *     yet", this does NOT fall back to an empty league; it blocks on the "Couldn't
 *     load your league" screen. Starting blank would let auto-save overwrite real data
 *     with nothing. This is hard-won and must survive. It matters MORE after Phase 2,
 *     not less.
 *   - THE STRONG SAVE GUARANTEE: aggressive immediate saving, the save-status bar, the
 *     retry timer, and the manual Save Now button all stay. Phase 2 makes each save
 *     cheap (one row, debounced) without weakening the guarantee. "We optimized it so
 *     it saves less" is a wrong answer.
 *   - The commissioner-driven weekly flow: pre-deal -> dealt -> schemes-processed ->
 *     stats -> finalized.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDefaultState,
  dealRosters,
  deepClone,
  emptyCumulative,
  finalizeCurrentPeriod,
  nowStamp,
  periodLabel,
  processSchemes,
  startPlayoffs,
  uid,
  POSITIONS,
  SUIT_CH,
} from "./engine/index.js";
import { createStore, loadIdentity, saveIdentity } from "./storage/index.js";
import { EmptyState, ErrorBanner, SaveStatusBar } from "./components/atoms.jsx";
import { LoginScreen } from "./components/LoginScreen.jsx";
import { LeagueHomeTab } from "./components/LeagueHomeTab.jsx";
import { MyTeamTab } from "./components/MyTeamTab.jsx";
import { RosterHubTab } from "./components/RosterHubTab.jsx";
import { WeeklyResultsTab } from "./components/WeeklyResultsTab.jsx";
import { RulesTab } from "./components/RulesTab.jsx";
import { CommissionerTab } from "./components/commissioner.jsx";

const store = createStore();

function errText(e) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e.message) return e.message;
  try { return JSON.stringify(e); } catch (x) { return String(e); }
}

export default function App() {
  const [state, setState] = useState(null);
  const [identity, setIdentity] = useState({ role: null, teamId: null });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadErrorDetail, setLoadErrorDetail] = useState(null);
  const [saveStatus, setSaveStatus] = useState("saved");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [saveErrorDetail, setSaveErrorDetail] = useState(null);
  const [loginError, setLoginError] = useState(null);
  const [dealError, setDealError] = useState(null);
  const [finalizeError, setFinalizeError] = useState(null);
  const [restoreError, setRestoreError] = useState(null);
  const [tab, setTab] = useState("home");

  const hasLoaded = useRef(false);
  const retryTimer = useRef(null);
  const loadAttempt = useRef(0);
  const loadRetryTimer = useRef(null);
  // The version the in-memory state was loaded at, carried back on every save so a
  // stale write is rejected rather than applied. Phase 2 is where this earns its keep.
  const loadedVersion = useRef(0);

  /* ---- initial load (auto-retries a few times before showing a blocking error) ---- */
  const loadLeague = useCallback(async () => {
    setLoadFailed(false);
    let loadedState = null;
    let hardFail = false;
    try {
      const res = await store.loadLeague();
      // null means "no league exists yet" -> genuinely brand-new, safe to start fresh.
      // A THROWN error means we could not tell, so we must NOT assume empty.
      if (res && res.state) {
        loadedState = res.state;
        loadedVersion.current = res.version;
      } else {
        loadedState = createDefaultState();
      }
    } catch (e) {
      // Do NOT fall back to a blank league: auto-save would then overwrite real data
      // with an empty one. Block and let the person retry instead.
      setLoadErrorDetail(errText(e));
      hardFail = true;
    }
    if (hardFail) {
      loadAttempt.current += 1;
      if (loadAttempt.current <= 3) {
        // transient blip? retry automatically a few times before bothering the person
        if (loadRetryTimer.current) clearTimeout(loadRetryTimer.current);
        loadRetryTimer.current = setTimeout(() => { loadLeague(); }, loadAttempt.current * 2000);
        return;
      }
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    loadAttempt.current = 0;
    if (loadRetryTimer.current) { clearTimeout(loadRetryTimer.current); loadRetryTimer.current = null; }
    if (!loadedState) loadedState = createDefaultState();
    setState(loadedState);

    setIdentity(loadIdentity());
    hasLoaded.current = true;
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLeague();
    return () => { if (loadRetryTimer.current) clearTimeout(loadRetryTimer.current); };
  }, [loadLeague]);

  /* ---- save on every change (no debounce) ---- */
  const doSave = useCallback(async (s) => {
    setSaveStatus("saving");
    try {
      const result = await store.saveLeague(s, loadedVersion.current);
      if (!result || !result.ok) {
        // Phase 1's in-memory store is single-client, so a stale result cannot happen
        // here in practice. Phase 2 turns this into the real conflict path: refetch,
        // tell the person plainly, and never resolve by overwriting.
        throw new Error(
          result && result.reason === "stale"
            ? "Someone else updated the league while you were editing."
            : "Storage write returned no confirmation."
        );
      }
      loadedVersion.current = result.version;
      setSaveStatus("saved");
      setLastSavedAt(nowStamp());
      setSaveErrorDetail(null);
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    } catch (e) {
      setSaveStatus("error");
      setSaveErrorDetail(errText(e));
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => { doSave(s); }, 3000);
    }
  }, []);

  useEffect(() => {
    if (!hasLoaded.current || !state) return;
    doSave(state);
    // eslint-disable-next-line
  }, [state]);

  useEffect(() => {
    if (!hasLoaded.current) return;
    saveIdentity(identity);
  }, [identity]);

  const saveNow = () => { if (state) doSave(state); };

  const update = useCallback((fn) => {
    setState((prev) => {
      const next = deepClone(prev);
      fn(next);
      return next;
    });
  }, []);

  /* ---- login handlers ---- */
  const onCommissionerLogin = (code) => {
    const trimmed = (code || "").trim();
    if (!state.commissionerCode) {
      if (!trimmed) { setLoginError("Enter a code to create the commissioner login."); return; }
      update((s) => { s.commissionerCode = trimmed; });
      setIdentity({ role: "commissioner", teamId: null });
      setLoginError(null);
    } else {
      if (trimmed === state.commissionerCode) {
        setIdentity({ role: "commissioner", teamId: null });
        setLoginError(null);
      } else {
        setLoginError("Incorrect commissioner code.");
      }
    }
  };

  const onManagerLogin = (teamId, joinCode) => {
    const team = state.teams.find((t) => t.id === teamId);
    if (!team) { setLoginError("Select a team first."); return; }
    if (!team.joinCode) { setLoginError("This team doesn't have a join code set yet - ask your commissioner to set one."); return; }
    if (team.joinCode !== joinCode) { setLoginError("Incorrect join code."); return; }
    setIdentity({ role: "manager", teamId });
    setLoginError(null);
  };

  const onLogout = () => { setIdentity({ role: null, teamId: null }); setTab("home"); };

  /* ---- roster swap / scheme submit ---- */
  const onSwap = (teamId, slot, benchIdx) => {
    update((s) => {
      const team = s.teams.find((t) => t.id === teamId);
      if (!team || !team.roster) return;
      const locks = s.lockedPlayerIds || {};
      const starterId = team.roster.starters[slot];
      const benchId = team.roster.bench[benchIdx];
      if ((starterId && locks[starterId]) || (benchId && locks[benchId])) return;
      team.roster.starters[slot] = benchId;
      team.roster.bench[benchIdx] = starterId;
    });
  };

  const onSubmitScheme = (teamId, scheme) => {
    update((s) => {
      if (s.rosterLocked) return;
      s.schemes[teamId] = scheme;
    });
  };

  const onRenameMyTeam = (teamId, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    update((s) => { const t = s.teams.find((x) => x.id === teamId); if (t) t.name = trimmed; });
  };

  /* ---- commissioner: weeks ---- */
  const onDeal = () => {
    setDealError(null);
    const teamIds = state.currentPeriod.type === "playoff" ? state.playoffConfig.activeTeamIds : state.teams.map((t) => t.id);
    if (teamIds.length === 0) { setDealError("Add at least one team before dealing rosters."); return; }
    const result = dealRosters(state, teamIds);
    if (result.error) { setDealError(result.error); return; }
    update((s) => {
      Object.entries(result.rosters).forEach(([teamId, roster]) => {
        const team = s.teams.find((t) => t.id === teamId);
        if (team) team.roster = roster;
      });
      s.currentPeriod.phase = "dealt";
      s.schemes = {};
      s.statsEntry = {};
      s.lockedPlayerIds = {};
      s.rosterLocked = false;
      s.activityLog.push({
        id: uid("act"), period: Object.assign({}, s.currentPeriod), periodLabel: periodLabel(s.currentPeriod), ts: nowStamp(),
        type: "deal", text: "Rosters dealt for " + periodLabel(s.currentPeriod) + " (" + teamIds.length + " team" + (teamIds.length === 1 ? "" : "s") + ").",
      });
    });
  };

  const onProcessSchemes = () => {
    const next = processSchemes(state);
    next.currentPeriod.phase = "schemes-processed";
    next.rosterLocked = true;
    setState(next);
  };

  /* ---- live stats ---- */
  const onStatChange = (teamId, slot, value) => {
    update((s) => {
      if (slot === "__togglelock__") {
        const pid = value;
        s.lockedPlayerIds[pid] = !s.lockedPlayerIds[pid];
        if (!s.lockedPlayerIds[pid]) delete s.lockedPlayerIds[pid];
        return;
      }
      if (!s.statsEntry[teamId]) s.statsEntry[teamId] = {};
      s.statsEntry[teamId][slot] = value;
    });
  };

  const onToggleRosterLock = () => update((s) => { s.rosterLocked = !s.rosterLocked; });

  const onFinalize = () => {
    setFinalizeError(null);
    const result = finalizeCurrentPeriod(state);
    if (result.error) { setFinalizeError(result.error); return; }
    setState(result.state);
    setDealError(null);
  };

  /* ---- commissioner: teams ---- */
  const onAddTeam = (name) => update((s) => {
    s.teams.push({ id: uid("team"), name, joinCode: "", roster: null, cumulative: emptyCumulative(), playoffCumulative: emptyCumulative() });
  });
  const onRenameTeam = (id, name) => { const trimmed = (name || "").trim(); if (!trimmed) return; update((s) => { const t = s.teams.find((x) => x.id === id); if (t) t.name = trimmed; }); };
  const onSetJoinCode = (id, code) => update((s) => { const t = s.teams.find((x) => x.id === id); if (t) t.joinCode = code; });
  const onRemoveTeam = (id) => update((s) => {
    s.teams = s.teams.filter((t) => t.id !== id);
    delete s.schemes[id];
    delete s.statsEntry[id];
    s.playoffConfig.activeTeamIds = s.playoffConfig.activeTeamIds.filter((tid) => tid !== id);
  });

  /* ---- commissioner: player pool ---- */
  const onAddPlayer = (name, position, team) => update((s) => {
    s.playerPool.push({ id: uid("pl"), name, position, team, status: "Active" });
  });
  const onSetStatus = (playerId, status) => update((s) => {
    const p = s.playerPool.find((x) => x.id === playerId);
    if (p) p.status = status;
  });
  const onDeletePlayer = (playerId) => update((s) => {
    s.playerPool = s.playerPool.filter((p) => p.id !== playerId);
    s.teams.forEach((t) => {
      if (!t.roster) return;
      POSITIONS.concat(["FLEX"]).forEach((slot) => { if (t.roster.starters[slot] === playerId) t.roster.starters[slot] = null; });
      t.roster.bench = t.roster.bench.map((id) => (id === playerId ? null : id));
    });
    Object.keys(s.schemes).forEach((teamId) => { if (s.schemes[teamId] && s.schemes[teamId].playerId === playerId) delete s.schemes[teamId]; });
  });

  /* ---- commissioner: scoring / standings cfg / playoffs / reset ---- */
  const onSaveScoring = (cfg) => update((s) => { s.scoringConfig = cfg; });
  const onSaveStandingsCfg = (arr) => update((s) => { s.standingsPointsOverride = arr; });
  const onStartPlayoffs = (bracketSize, advancement) => setState(startPlayoffs(state, bracketSize, advancement));
  const onResetLeague = () => update((s) => {
    s.teams = [];
    s.schemes = {};
    s.statsEntry = {};
    s.weeklyResults = [];
    s.activityLog = [];
    s.lockedPlayerIds = {};
    s.rosterLocked = false;
    s.currentPeriod = { type: "week", number: 1, phase: "pre-deal" };
    s.playoffConfig = { bracketSize: 4, advancement: [4, 2, 1], started: false, completed: false, currentRoundIndex: 0, activeTeamIds: [], champion: null };
    s.standingsPointsOverride = null;
  });

  /* ---- backup / restore ---- */
  const onDownloadBackup = () => {
    try {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pigskin-poker-backup-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json";
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
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.teams) || !Array.isArray(parsed.playerPool)) {
          throw new Error("File doesn't look like a Pigskin Poker backup (missing teams/playerPool).");
        }
        setState(parsed);
      } catch (e) {
        setRestoreError({ headline: "Restore failed - the file couldn't be read as a valid backup.", detail: errText(e) });
      }
    };
    reader.onerror = () => setRestoreError({ headline: "Restore failed - couldn't read the file.", detail: errText(reader.error) });
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
              <button className="pp-btn pp-btn-gold pp-btn-block" onClick={() => { loadAttempt.current = 0; loadLeague(); }}>Try Again</button>
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
