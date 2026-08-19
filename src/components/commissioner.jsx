/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1816-2097.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { useRef, useState } from "react";
import { POSITIONS, deepClone, defaultAdvancement, periodLabel, standingsPointsArray } from "../engine/index.js";
import { CODE_RULE_HINT } from "../storage/codePolicy.js";
import { MyTeamTab } from "./MyTeamTab.jsx";
import { ConfirmButton, EmptyState, ErrorBanner, SuitBadge, Tag, TypedConfirm } from "./atoms.jsx";

export function CommTeamsPanel({ state, onAddTeam, onRenameTeam, onSetJoinCode, onSignOutTeam, onRemoveTeam }) {
  const [newName, setNewName] = useState("");
  return (
    <div>
      <div className="pp-card">
        <h3 className="pp-h3">Add a Team</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="pp-input" placeholder="Team name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="pp-btn pp-btn-gold" disabled={!newName.trim()} onClick={() => { onAddTeam(newName.trim()); setNewName(""); }}>Add</button>
        </div>
      </div>
      {state.teams.map((t) => <CommTeamRow key={t.id} team={t} onRenameTeam={onRenameTeam} onSetJoinCode={onSetJoinCode} onSignOutTeam={onSignOutTeam} onRemoveTeam={onRemoveTeam} />)}
      {state.teams.length === 0 ? <EmptyState>No teams yet - add your first team above.</EmptyState> : null}
    </div>
  );
}

export function CommTeamRow({ team, onRenameTeam, onSetJoinCode, onSignOutTeam, onRemoveTeam }) {
  const [name, setName] = useState(team.name);
  /* Deliberately blank. Join codes are stored hashed, so there is nothing to read
   * back - the commissioner sets a NEW code rather than viewing the existing one.
   * That is the cost of taking codes out of every visitor's browser (P2). */
  const [code, setCode] = useState("");
  /* Setting a code can now FAIL - it has to meet the length and character rule - and
   * before Phase 3a the result of this button went to the login screen's error banner,
   * which is not on screen when you are signed in. The commissioner clicked Save and
   * was told nothing either way. The outcome is reported here, next to the button that
   * caused it. */
  const [codeStatus, setCodeStatus] = useState(null);

  const saveCode = async () => {
    setCodeStatus(null);
    const r = await onSetJoinCode(team.id, code);
    if (r && r.ok === false) {
      setCodeStatus({ bad: true, text: r.message || "Couldn't set that join code." });
      return;
    }
    // Say plainly that this signed people out. It is the whole point of rotating a
    // code, and it is the kind of side effect that should never be a surprise.
    const n = r && typeof r.signedOut === "number" ? r.signedOut : 0;
    setCodeStatus({
      bad: false,
      text: n > 0
        ? "Code set. " + n + " signed-in device" + (n === 1 ? "" : "s") + " signed out."
        : "Code set.",
    });
    setCode("");
  };

  const signOut = async () => {
    setCodeStatus(null);
    const r = await onSignOutTeam(team.id);
    if (r && r.ok === false) {
      setCodeStatus({ bad: true, text: r.message || "Couldn't sign that team out." });
      return;
    }
    const n = r && typeof r.signedOut === "number" ? r.signedOut : 0;
    setCodeStatus({
      bad: false,
      text: n > 0
        ? n + " device" + (n === 1 ? "" : "s") + " signed out. The join code still works."
        : "Nobody was signed in on that team.",
    });
  };

  return (
    <div className="pp-card pp-card-tight">
      <div className="pp-grid-2">
        <div className="pp-field" style={{ marginBottom: 6 }}>
          <label className="pp-label">Team Name</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="pp-input" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="pp-btn pp-btn-sm" onClick={() => onRenameTeam(team.id, name)}>Save</button>
          </div>
        </div>
        <div className="pp-field" style={{ marginBottom: 6 }}>
          <label className="pp-label">Join Code</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="pp-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="new join code" />
            <button className="pp-btn pp-btn-sm" onClick={saveCode}>Save</button>
          </div>
          {/* The rule is stated, not just enforced - a rejection after the fact is a
              worse way to learn it. */}
          <div className="pp-hint">{CODE_RULE_HINT} Setting a new code signs that team out.</div>
          {codeStatus ? (
            <div className={codeStatus.bad ? "pp-hint pp-hint-bad" : "pp-hint pp-hint-good"}>{codeStatus.text}</div>
          ) : null}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {/* For the phone-left-somewhere case, where the code is fine and only the live
            sessions are the problem. Rotating the code to achieve this would force the
            whole team to be told a new one. */}
        <ConfirmButton label="Sign out devices" confirmLabel="Yes, sign out" onConfirm={signOut} />
        <ConfirmButton label={"Remove " + team.name} confirmLabel="Yes, remove team" danger onConfirm={() => onRemoveTeam(team.id)} />
      </div>
    </div>
  );
}

export function CommWeeksPanel({ state, onDeal, onProcessSchemes, dealError }) {
  const teams = state.currentPeriod.type === "playoff" ? state.teams.filter((t) => state.playoffConfig.activeTeamIds.includes(t.id)) : state.teams;
  const submitted = teams.filter((t) => state.schemes[t.id]);
  const pending = teams.filter((t) => !state.schemes[t.id]);
  const phase = state.currentPeriod.phase;
  return (
    <div className="pp-card">
      <h3 className="pp-h3">{periodLabel(state.currentPeriod)} - {phase.replace("-", " ")}</h3>
      {dealError ? <ErrorBanner message={dealError} /> : null}
      {phase === "pre-deal" && (
        <>
          <p className="pp-sub">Deal a fresh roster to {teams.length} team{teams.length === 1 ? "" : "s"} for {periodLabel(state.currentPeriod)}.</p>
          <button className="pp-btn pp-btn-gold" disabled={teams.length === 0} onClick={onDeal}>Deal Rosters</button>
        </>
      )}
      {phase === "dealt" && (
        <>
          <p className="pp-sub">{submitted.length} of {teams.length} teams have submitted a scheme.</p>
          {pending.length > 0 && <p className="pp-sub">Still pending: {pending.map((t) => t.name).join(", ")}</p>}
          <button className="pp-btn pp-btn-gold" onClick={onProcessSchemes}>Process Schemes</button>
        </>
      )}
      {phase === "schemes-processed" && (
        <p className="pp-sub">Schemes have been processed. Head to Live Stats to enter results and finalize.</p>
      )}
    </div>
  );
}

export function CommManageRostersPanel({ state, onSwap, onSubmitScheme }) {
  const teams = state.currentPeriod.type === "playoff" ? state.teams.filter((t) => state.playoffConfig.activeTeamIds.includes(t.id)) : state.teams;
  const [teamId, setTeamId] = useState(teams[0] ? teams[0].id : "");
  const team = state.teams.find((t) => t.id === teamId);
  return (
    <div>
      <div className="pp-card">
        <label className="pp-label">Team</label>
        <select className="pp-select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">Choose a team...</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {team && <MyTeamTab state={state} team={team} onSwap={(slot, benchIdx) => onSwap(team.id, slot, benchIdx)} onSubmitScheme={onSubmitScheme} onRename={() => {}} />}
    </div>
  );
}

export function CommPlayerPoolPanel({ state, onAddPlayer, onSetStatus, onDeletePlayer }) {
  const [name, setName] = useState("");
  const [position, setPosition] = useState("QB");
  const [team, setTeam] = useState("");
  const grouped = POSITIONS.reduce((acc, pos) => { acc[pos] = state.playerPool.filter((p) => p.position === pos).sort((a, b) => a.name.localeCompare(b.name)); return acc; }, {});
  return (
    <div>
      <div className="pp-card">
        <h3 className="pp-h3">Add Custom Player</h3>
        <div className="pp-grid-2">
          <div className="pp-field"><label className="pp-label">Name</label><input className="pp-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="pp-field">
            <label className="pp-label">Position</label>
            <select className="pp-select" value={position} onChange={(e) => setPosition(e.target.value)}>
              {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="pp-field"><label className="pp-label">NFL Team</label><input className="pp-input" value={team} onChange={(e) => setTeam(e.target.value)} /></div>
        <button className="pp-btn pp-btn-gold" disabled={!name.trim() || !team.trim()} onClick={() => { onAddPlayer(name.trim(), position, team.trim()); setName(""); setTeam(""); }}>Add Player</button>
      </div>
      {POSITIONS.map((pos) => (
        <div key={pos} className="pp-card">
          <h3 className="pp-h3">{pos} <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>({grouped[pos].length})</span></h3>
          {grouped[pos].map((p) => (
            <div key={p.id} className="pp-roster-slot" style={{ flexWrap: "wrap" }}>
              <SuitBadge position={p.position} />
              <div style={{ flex: 1, minWidth: 120 }}>
                <div className="pp-roster-slot-name">{p.name}</div>
                <div className="pp-roster-slot-meta">{p.team}</div>
              </div>
              <select className="pp-select" style={{ width: 100 }} value={p.status} onChange={(e) => onSetStatus(p.id, e.target.value)}>
                <option value="Active">Active</option>
                <option value="OUT">OUT</option>
                <option value="IR">IR</option>
                <option value="BYE">BYE</option>
              </select>
              <ConfirmButton label="Delete" confirmLabel="Yes, delete" danger onConfirm={() => onDeletePlayer(p.id)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function CommScoringPanel({ state, onSave }) {
  const [cfg, setCfg] = useState(deepClone(state.scoringConfig));
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Scoring Settings</h3>
      <div className="pp-field"><label className="pp-label">Points per N yards (N)</label><input className="pp-input" type="number" value={cfg.yardsPerPoint} onChange={(e) => setCfg(Object.assign({}, cfg, { yardsPerPoint: e.target.value }))} /></div>
      <div className="pp-field"><label className="pp-label">Points per TD</label><input className="pp-input" type="number" value={cfg.pointsPerTD} onChange={(e) => setCfg(Object.assign({}, cfg, { pointsPerTD: e.target.value }))} /></div>
      <div className="pp-grid-2">
        <div className="pp-field"><label className="pp-label">Coach Win</label><input className="pp-input" type="number" value={cfg.coachWin} onChange={(e) => setCfg(Object.assign({}, cfg, { coachWin: e.target.value }))} /></div>
        <div className="pp-field"><label className="pp-label">Coach Tie</label><input className="pp-input" type="number" value={cfg.coachTie} onChange={(e) => setCfg(Object.assign({}, cfg, { coachTie: e.target.value }))} /></div>
        <div className="pp-field"><label className="pp-label">Coach Loss</label><input className="pp-input" type="number" value={cfg.coachLoss} onChange={(e) => setCfg(Object.assign({}, cfg, { coachLoss: e.target.value }))} /></div>
      </div>
      <button className="pp-btn pp-btn-gold" onClick={() => onSave({
        yardsPerPoint: Number(cfg.yardsPerPoint) || 10, pointsPerTD: Number(cfg.pointsPerTD) || 0,
        coachWin: Number(cfg.coachWin) || 0, coachTie: Number(cfg.coachTie) || 0, coachLoss: Number(cfg.coachLoss) || 0,
      })}>Save Scoring</button>
    </div>
  );
}

export function CommStandingsCfgPanel({ state, onSave }) {
  const teamCount = state.teams.length || 1;
  const current = state.standingsPointsOverride || standingsPointsArray(teamCount);
  const [text, setText] = useState(current.join(", "));
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Standings Point Values by Rank</h3>
      <p className="pp-sub">Comma-separated, 1st place first. Default is team count down to 1.</p>
      <input className="pp-input" value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="pp-btn pp-btn-gold" onClick={() => {
          const arr = text.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n));
          if (arr.length > 0) onSave(arr);
        }}>Save</button>
        <button className="pp-btn pp-btn-ghost" onClick={() => { onSave(null); setText(standingsPointsArray(teamCount).join(", ")); }}>Reset to Default</button>
      </div>
    </div>
  );
}

export function CommPlayoffsPanel({ state, onStart }) {
  const [bracketSize, setBracketSize] = useState(state.playoffConfig.bracketSize || 4);
  const [advText, setAdvText] = useState((state.playoffConfig.advancement || defaultAdvancement(bracketSize)).join(", "));
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Playoff Configuration</h3>
      {state.playoffConfig.started ? (
        <p className="pp-sub">Playoffs already started ({state.playoffConfig.bracketSize} teams, {state.playoffConfig.advancement.join(" -> ")}). Use Reset to start over if needed.</p>
      ) : (
        <>
          <div className="pp-field">
            <label className="pp-label">Bracket Size (top N teams by season standings)</label>
            <input className="pp-input" type="number" value={bracketSize} onChange={(e) => { setBracketSize(e.target.value); setAdvText(defaultAdvancement(Number(e.target.value) || 1).join(", ")); }} />
          </div>
          <div className="pp-field">
            <label className="pp-label">Advancement per round (e.g. 4, 2, 1)</label>
            <input className="pp-input" value={advText} onChange={(e) => setAdvText(e.target.value)} />
          </div>
          <button
            className="pp-btn pp-btn-gold"
            disabled={state.teams.length < 2}
            onClick={() => {
              const bs = Number(bracketSize) || 2;
              const adv = advText.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
              onStart(Math.min(bs, state.teams.length), adv.length ? adv : defaultAdvancement(bs));
            }}
          >
            Start Playoffs
          </button>
          {state.teams.length < 2 ? <p className="pp-sub">Add at least 2 teams first.</p> : null}
        </>
      )}
    </div>
  );
}

export function CommResetPanel({ onReset }) {
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Reset League</h3>
      <p className="pp-sub">Wipes teams, rosters, stats, standings, and the activity log. The player pool and scoring settings stay intact. This cannot be undone.</p>
      <TypedConfirm phrase="RESET LEAGUE" label="Reset League" onConfirm={onReset} />
    </div>
  );
}

export function CommBackupPanel({ state, onDownload, onRestore, restoreError }) {
  const fileRef = useRef(null);
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Backup & Restore</h3>
      <p className="pp-sub">
        Given this app's history of unreliable automatic cloud saves, treat manual backups as your <strong>primary</strong>{" "}
        safety net, not a nice-to-have. Download a backup after anything important - a week dealt, a week finalized,
        teams added.
      </p>
      <button className="pp-btn pp-btn-gold" style={{ marginBottom: 12 }} onClick={onDownload}>Download Backup (JSON)</button>
      <div className="pp-divider" />
      <h3 className="pp-h3">Restore from Backup</h3>
      {restoreError ? <ErrorBanner message={restoreError} /> : null}
      <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; if (f) onRestore(f); e.target.value = ""; }} />
      <ConfirmButton label="Choose File & Restore" confirmLabel="This replaces current league data - continue?" danger onConfirm={() => fileRef.current && fileRef.current.click()} />
    </div>
  );
}

export function CommInvitePanel({ state, invites, onCreateInvite, onRevokeInvite, invitesAvailable }) {
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState("manager");
  const [issued, setIssued] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const issue = async () => {
    setError(null); setIssued(null); setCopied(false);
    const r = await onCreateInvite(role === "manager" ? teamId : null, role);
    if (!r || r.ok === false) { setError(r?.message || "Could not create that invite."); return; }
    setIssued(r.code);
  };

  const link = issued ? (globalThis.location?.origin ?? "") + "/join/" + issued : "";

  /* The in-memory demo has no accounts, so it has nothing to invite anyone TO. Rather
     than show a door that cannot open, say why. */
  if (!invitesAvailable) {
    return (
      <div className="pp-card">
        <h3 className="pp-h3">Invites</h3>
        <p className="pp-sub">
          Invite codes need the hosted database - they are not available in the demo.
          Set a team&apos;s join code under Teams instead.
        </p>
      </div>
    );
  }

  return (
    <div className="pp-card">
      <h3 className="pp-h3">Invite Someone</h3>
      <p className="pp-sub" style={{ marginBottom: 10 }}>
        An invite lets someone join with their own account. Unlike a join code it is spent
        once redeemed - so you can revoke or reissue one freely without locking anybody out.
      </p>

      <div className="pp-grid-2">
        <div className="pp-field">
          <label className="pp-label">Joining As</label>
          <select className="pp-select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="manager">A team manager</option>
            <option value="commissioner">Another commissioner</option>
          </select>
        </div>
        {role === "manager" ? (
          <div className="pp-field">
            <label className="pp-label">Which Team</label>
            <select className="pp-select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Select a team...</option>
              {state.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        ) : null}
      </div>

      <button className="pp-btn pp-btn-gold" disabled={role === "manager" && !teamId} onClick={issue}>
        Create Invite
      </button>
      {error ? <div className="pp-hint pp-hint-bad">{error}</div> : null}

      {issued ? (
        <div style={{ marginTop: 12 }}>
          {/* Shown ONCE. There is no route that reads a code back - which is safe here
              precisely because reissuing costs nothing. Said plainly so nobody closes
              the tab expecting to find it again. */}
          <div className="pp-hint pp-hint-good">
            Copy this now - it is shown once. Lost it? Just make another.
          </div>
          <div className="pp-input" style={{ margin: "6px 0", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>{issued}</div>
          <div className="pp-input" style={{ marginBottom: 6, fontSize: 11, wordBreak: "break-all" }}>{link}</div>
          <button
            className="pp-btn pp-btn-sm"
            onClick={async () => {
              try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
            }}
          >
            {copied ? "Copied" : "Copy Link"}
          </button>
        </div>
      ) : null}

      <h3 className="pp-h3" style={{ marginTop: 18 }}>Outstanding Invites</h3>
      {(invites ?? []).length === 0 ? (
        <p className="pp-sub">None yet.</p>
      ) : (
        (invites ?? []).map((i) => (
          <div key={i.id} className="pp-roster-slot">
            <div style={{ flex: 1 }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>{i.ref}</span>
              <span className="pp-roster-slot-meta">
                {"  " + (i.role === "commissioner" ? "commissioner" : (state.teams.find((t) => t.id === i.teamId)?.name ?? "a team"))}
                {"  -  used " + i.uses + (i.maxUses ? " of " + i.maxUses : " times")}
              </span>
            </div>
            {i.revoked ? <Tag>revoked</Tag> : (
              <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => onRevokeInvite(i.id)}>Revoke</button>
            )}
          </div>
        ))
      )}

      <h3 className="pp-h3" style={{ marginTop: 18 }}>Join Codes (the old way)</h3>
      <p className="pp-sub">
        Still work, and still fine. A join code signs in a whole team on any device; an
        invite signs in one person as themselves. Both will keep working until everyone
        has an account.
      </p>
      {state.teams.map((t) => (
        <div key={t.id} className="pp-roster-slot"><div style={{ flex: 1 }}>{t.name}</div><Tag>{t.hasJoinCode ? "code set" : "no code set"}</Tag></div>
      ))}
    </div>
  );
}

export function CommissionerTab(props) {
  const [sub, setSub] = useState("teams");
  const subs = ["teams", "weeks", "roster-mgmt", "pool", "scoring", "standings-cfg", "playoffs", "invite", "backup", "reset"];
  const labels = { teams: "Teams", weeks: "Weeks", "roster-mgmt": "Manage Rosters", pool: "Player Pool", scoring: "Scoring", "standings-cfg": "Standings Cfg", playoffs: "Playoffs", invite: "Invite", backup: "Backup", reset: "Reset" };
  return (
    <div>
      <div className="pp-subnav">
        {subs.map((s) => <button key={s} className={"pp-subnav-btn" + (sub === s ? " active" : "")} onClick={() => setSub(s)}>{labels[s]}</button>)}
      </div>
      {sub === "teams" && <CommTeamsPanel state={props.state} onAddTeam={props.onAddTeam} onRenameTeam={props.onRenameTeam} onSetJoinCode={props.onSetJoinCode} onSignOutTeam={props.onSignOutTeam} onRemoveTeam={props.onRemoveTeam} />}
      {sub === "weeks" && <CommWeeksPanel state={props.state} onDeal={props.onDeal} onProcessSchemes={props.onProcessSchemes} dealError={props.dealError} />}
      {sub === "roster-mgmt" && <CommManageRostersPanel state={props.state} onSwap={props.onSwap} onSubmitScheme={props.onSubmitScheme} />}
      {sub === "pool" && <CommPlayerPoolPanel state={props.state} onAddPlayer={props.onAddPlayer} onSetStatus={props.onSetStatus} onDeletePlayer={props.onDeletePlayer} />}
      {sub === "scoring" && <CommScoringPanel state={props.state} onSave={props.onSaveScoring} />}
      {sub === "standings-cfg" && <CommStandingsCfgPanel state={props.state} onSave={props.onSaveStandingsCfg} />}
      {sub === "playoffs" && <CommPlayoffsPanel state={props.state} onStart={props.onStartPlayoffs} />}
      {sub === "invite" && <CommInvitePanel state={props.state} invites={props.invites} onCreateInvite={props.onCreateInvite} onRevokeInvite={props.onRevokeInvite} invitesAvailable={props.invitesAvailable} />}
      {sub === "backup" && <CommBackupPanel state={props.state} onDownload={props.onDownloadBackup} onRestore={props.onRestoreBackup} restoreError={props.restoreError} />}
      {sub === "reset" && <CommResetPanel onReset={props.onResetLeague} />}
    </div>
  );
}

/* ================================== App ==================================== */
