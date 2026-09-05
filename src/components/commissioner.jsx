/* Pigskin Poker UI - the commissioner's panels.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 1816-2097. The panels themselves
 * are the artifact's; what has been added since is the NFL-week panel, the lineup-lock
 * panel, the pool refresh, the invite panel, and - for issues #29 and #30 - the "Enter
 * Stats" sub-tab, which is the stat-entry screen that used to live under Rosters.
 */

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_SCORING,
  LINEUP_LOCK,
  POSITIONS,
  deepClone,
  defaultAdvancement,
  firstKickoff,
  formatKickoff,
  kickoffsFor,
  lineupLockMode,
  periodLabel,
  standingsPointsArray,
} from "../engine/index.js";
import { MyTeamTab } from "./MyTeamTab.jsx";
import { ConfirmButton, EmptyState, ErrorBanner, SuitBadge, Tag, TypedConfirm } from "./atoms.jsx";
import { LiveStatsTab } from "./stats.jsx";

export function CommTeamsPanel({ state, onAddTeam, onRenameTeam, onRemoveTeam }) {
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
      {state.teams.map((t) => <CommTeamRow key={t.id} team={t} onRenameTeam={onRenameTeam} onRemoveTeam={onRemoveTeam} />)}
      {state.teams.length === 0 ? (
        <EmptyState>
          No teams yet - add your first team above. One row per manager; you can rename
          them later. Once the teams are in, send invites, then deal Week 1 from Weeks.
        </EmptyState>
      ) : null}
    </div>
  );
}

/* One team, as the commissioner manages it: rename, or remove.
 *
 * There used to be a "Join Code" field here, plus "Sign out devices" beside it. Both
 * belonged to a world where a code WAS the login: setting a new one signed that team
 * out, which was the only way to remove somebody, and it forced the rest of the team
 * onto a new code at the same time. Membership is a `league_members` row now - invite
 * one person, remove one person - so neither control has anything to act on.
 */
export function CommTeamRow({ team, onRenameTeam, onRemoveTeam }) {
  const [name, setName] = useState(team.name);

  return (
    <div className="pp-card pp-card-tight">
      <div className="pp-field" style={{ marginBottom: 6 }}>
        <label className="pp-label">Team Name</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="pp-input" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="pp-btn pp-btn-sm" onClick={() => onRenameTeam(team.id, name)}>Save</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <ConfirmButton label={"Remove " + team.name} confirmLabel="Yes, remove team" danger onConfirm={() => onRemoveTeam(team.id)} />
      </div>
    </div>
  );
}

/* Which week of NFL football this league week plays.
 *
 * League week is not NFL week: `currentPeriod.number` counts the weeks THIS LEAGUE has
 * played, and the stats feed only publishes by NFL week. They match for a league that
 * opened on opening weekend and not for one that started late, played through a bye, or
 * came back the next season - so the mapping is stored and this is where it is fixed.
 * Every week created after a correction counts forward from it, which is why this is
 * normally touched once a season rather than every Sunday. See server/schedule.js.
 */
export function CommNflWeekPanel({ state, onSetNflWeek }) {
  const current = (state._meta && state._meta.nflWeek) ?? null;
  const [draft, setDraft] = useState(current == null ? "" : String(current));
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setDraft(current == null ? "" : String(current));
    setSaved(false);
  }, [current]);

  const trimmed = draft.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 23);
  const changed = (parsed == null ? null : parsed) !== current;

  return (
    <div className="pp-card">
      <h3 className="pp-h3">NFL Week</h3>
      <p className="pp-sub">
        {current == null ? (
          <><strong>Not set.</strong> Stats cannot be pulled for a week nobody has said is
          a week - set it and every week after this one follows on by itself.</>
        ) : (
          <>{periodLabel(state.currentPeriod)} plays <strong>NFL week {current}</strong>.
          Weeks created after this one count on from it, so you should not need to come
          back here.</>
        )}
      </p>
      <div className="pp-field">
        <label className="pp-label">NFL week (1-23, blank to unset)</label>
        <input
          className="pp-input"
          inputMode="numeric"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
        />
      </div>
      {!valid ? <p className="pp-sub">An NFL week is a whole number from 1 to 23.</p> : null}
      <button
        className="pp-btn pp-btn-gold"
        disabled={!valid || !changed}
        onClick={async () => {
          await onSetNflWeek(parsed);
          setSaved(true);
        }}
      >
        Save NFL Week
      </button>
      {saved && !changed ? <p className="pp-sub">Saved.</p> : null}
    </div>
  );
}


/* When lineups stop being changeable - the one league option that changes how a whole
 * week feels to play.
 *
 * Both settings have always been describable; only one of them has ever been enforced,
 * and by hand. `gametime` is the rule the rules screen describes and the commissioner
 * has been pressing Lock for all afternoon. `weekly` is the fantasy-football default
 * most people arrive expecting: set it Thursday, and Thursday is the deadline.
 *
 * The times come from the NFL schedule (server/feed/nflverse.js), which is why this
 * panel says what it knows and offers to read it again - flex scheduling moves games,
 * and a lock is only as right as the kickoff it fires on.
 */
export function CommLineupLockPanel({ state, onSetLineupLock, onRefreshKickoffs, kickoffReport }) {
  const mode = lineupLockMode(state);
  const kickoffs = kickoffsFor(state);
  const teamsKnown = Object.keys(kickoffs).length;
  const first = firstKickoff(kickoffs);
  const readAt = (state._meta && state._meta.kickoffsReadAt) || null;
  const nflWeek = (state._meta && state._meta.nflWeek) ?? null;
  const [busy, setBusy] = useState(false);

  const choose = async (next) => {
    if (next === mode) return;
    await onSetLineupLock(next);
  };

  return (
    <div className="pp-card">
      <h3 className="pp-h3">Lineup Lock</h3>
      <p className="pp-sub">
        When managers stop being able to move players in and out of their starting
        lineup. This is a league rule - set it once and every week follows it.
      </p>

      <LockChoice
        checked={mode === LINEUP_LOCK.GAMETIME}
        onChoose={() => choose(LINEUP_LOCK.GAMETIME)}
        title="Each player at his own kickoff"
        body="A manager can keep changing his lineup all Sunday, but only with players
              whose games have not started. The one o'clock starters lock at one; the
              late window stays open."
      />
      <LockChoice
        checked={mode === LINEUP_LOCK.WEEKLY}
        onChoose={() => choose(LINEUP_LOCK.WEEKLY)}
        title="Everyone at the week's first kickoff"
        body="Thursday night in most weeks. Whatever a manager has in his lineup when the
              first game starts is what plays, injuries and inactives included."
      />

      <p className="pp-sub" style={{ marginTop: 10 }}>
        Either way you can still lock a single player by hand on the Live Stats screen,
        and a manual lock always wins.
      </p>

      <h3 className="pp-h3" style={{ marginTop: 12 }}>Kickoff times</h3>
      {teamsKnown === 0 ? (
        <p className="pp-sub">
          <strong>None read for this week.</strong> Nothing locks on the clock until they
          are{nflWeek == null ? ", and this week is not mapped to an NFL week yet - set that first" : ""}.
        </p>
      ) : (
        <p className="pp-sub">
          {teamsKnown} team{teamsKnown === 1 ? "" : "s"} scheduled for NFL week {nflWeek}.
          {first ? " First kickoff " + formatKickoff(first) + "." : ""}
          {readAt ? " Read " + String(readAt).replace("T", " ").slice(0, 16) + " UTC." : ""}
        </p>
      )}
      <button
        className="pp-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onRefreshKickoffs();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Reading..." : "Refresh Kickoff Times"}
      </button>
      {kickoffReport ? (
        <p className="pp-sub" style={{ marginTop: 6 }}>
          Read {kickoffReport.teams} team{kickoffReport.teams === 1 ? "" : "s"} for NFL week {kickoffReport.nflWeek}.
        </p>
      ) : null}
      <p className="pp-sub" style={{ marginTop: 6 }}>
        Read automatically when you deal a week. Worth pressing again if a game has been
        flexed, because the lock fires on the time we hold.
      </p>
    </div>
  );
}

function LockChoice({ checked, onChoose, title, body }) {
  return (
    <label className="pp-field" style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
      <input type="radio" checked={checked} onChange={onChoose} style={{ marginTop: 4 }} />
      <span>
        <strong>{title}</strong>
        <span className="pp-sub" style={{ display: "block" }}>{body}</span>
      </span>
    </label>
  );
}

export function CommWeeksPanel({ state, onDeal, onProcessSchemes, dealError, submittedTeamIds, onSetNflWeek, onSetLineupLock, onRefreshKickoffs, kickoffReport }) {
  const teams = state.currentPeriod.type === "playoff" ? state.teams.filter((t) => state.playoffConfig.activeTeamIds.includes(t.id)) : state.teams;
  /* `state.schemes` only ever holds what THIS browser was told, and a manager's
   * pending scheme is hidden from every browser read by design - so on the
   * commissioner's screen it counted his own submissions and nobody else's.
   * submittedTeamIds is the server's answer to "who is in?", asked by the one
   * person entitled to it. Null means we have not been told, and the old
   * behaviour stands. See server/operations.js schemeStatus. */
  const hasSubmitted = submittedTeamIds
    ? (t) => submittedTeamIds.includes(t.id)
    : (t) => !!state.schemes[t.id];
  const submitted = teams.filter(hasSubmitted);
  const pending = teams.filter((t) => !hasSubmitted(t));
  const phase = state.currentPeriod.phase;
  return (
    <>
      <div className="pp-card">
      <h3 className="pp-h3">{periodLabel(state.currentPeriod)} - {phase.replace("-", " ")}</h3>
      {dealError ? <ErrorBanner message={dealError} /> : null}
      {phase === "pre-deal" && (
        <>
          {/* ISSUE #24. This used to read "Deal a fresh roster to 0 teams for Week 1."
            * over a disabled button with no reason given - the one screen a new
            * commissioner opens looking for the start button. The button is disabled on
            * the same condition as before; only the explanation is new. */}
          {teams.length === 0 ? (
            <p className="pp-sub">
              No teams to deal to yet. Add them under the Teams tab first - a league
              needs at least one team before {periodLabel(state.currentPeriod)} can be dealt.
            </p>
          ) : (
            <p className="pp-sub">Deal a fresh roster to {teams.length} team{teams.length === 1 ? "" : "s"} for {periodLabel(state.currentPeriod)}.</p>
          )}
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
        <p className="pp-sub">
          Schemes have been processed. Head to Enter Stats to lock the rosters for the
          weekend, fill in the results and finalize.
        </p>
      )}
      </div>
      <CommNflWeekPanel state={state} onSetNflWeek={onSetNflWeek} />
      <CommLineupLockPanel
        state={state}
        onSetLineupLock={onSetLineupLock}
        onRefreshKickoffs={onRefreshKickoffs}
        kickoffReport={kickoffReport}
      />
    </>
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

/* What the last refresh did.
 *
 * The button's value is not that the pool got refreshed - it is seeing WHAT moved before
 * dealing. Corrections are named, not counted, because "3 renamed" tells the commissioner
 * nothing and "Kalil Shakir is Khalil Shakir" tells him the pool was wrong. */
export function PoolRefreshReport({ report }) {
  if (!report) return null;
  const { added = [], renamed = [], retired = 0, updated = 0, untouched = [], gaps = [] } = report;
  const when = report.at ? String(report.at).replace("T", " ").replace("Z", " UTC") : "just now";
  return (
    <div className="pp-card pp-card-tight">
      <h3 className="pp-h3">What the refresh changed</h3>
      <p className="pp-sub">Depth charts as of {when}.</p>
      <ul className="pp-rule-list">
        <li>{updated} player{updated === 1 ? "" : "s"} confirmed or corrected.</li>
        <li>{added.length} added, {retired} retired from the deal.</li>
      </ul>
      {renamed.length > 0 && (
        <>
          <p className="pp-sub" style={{ marginBottom: 4 }}><strong>Names corrected</strong></p>
          <ul className="pp-rule-list">
            {renamed.slice(0, 12).map((r, i) => (
              <li key={i}>{r.from} {ARROW_R} {r.to} <span style={{ color: "var(--text-faint)" }}>({r.position}, {r.team})</span></li>
            ))}
            {renamed.length > 12 ? <li>...and {renamed.length - 12} more.</li> : null}
          </ul>
        </>
      )}
      {added.length > 0 && (
        <>
          <p className="pp-sub" style={{ marginBottom: 4 }}><strong>New to the pool</strong></p>
          <ul className="pp-rule-list">
            {added.slice(0, 12).map((r, i) => <li key={i}>{r.name} - {r.position}, {r.team}</li>)}
            {added.length > 12 ? <li>...and {added.length - 12} more.</li> : null}
          </ul>
        </>
      )}
      {untouched.length > 0 && (
        <>
          <p className="pp-sub" style={{ marginBottom: 4 }}><strong>Left alone - yours, not the feed's</strong></p>
          <ul className="pp-rule-list">
            {untouched.slice(0, 12).map((r, i) => <li key={i}>{r.name} ({r.position}) - {r.why}.</li>)}
            {untouched.length > 12 ? <li>...and {untouched.length - 12} more.</li> : null}
          </ul>
        </>
      )}
      {gaps.length > 0 && (
        <>
          <p className="pp-sub" style={{ marginBottom: 4 }}><strong>The feed could not fill these</strong></p>
          <ul className="pp-rule-list">
            {gaps.slice(0, 12).map((g, i) => (
              <li key={i}>{g.team} - {g.position} #{g.wantedRank}: {g.reason}. Add someone by hand if you want the slot covered.</li>
            ))}
            {gaps.length > 12 ? <li>...and {gaps.length - 12} more.</li> : null}
          </ul>
        </>
      )}
    </div>
  );
}

const ARROW_R = String.fromCodePoint(0x2192);

export function CommPlayerPoolPanel({ state, onAddPlayer, onSetStatus, onDeletePlayer, onRefreshPool, poolReport, phase }) {
  const [name, setName] = useState("");
  const [position, setPosition] = useState("QB");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const canRefresh = phase === "pre-deal";
  const grouped = POSITIONS.reduce((acc, pos) => { acc[pos] = state.playerPool.filter((p) => p.position === pos).sort((a, b) => a.name.localeCompare(b.name)); return acc; }, {});
  return (
    <div>
      <div className="pp-card">
        <h3 className="pp-h3">Refresh From Live Rosters</h3>
        <p className="pp-sub">
          Pulls every team's current starters - 1 QB, 2 RB, 2 WR, 1 TE and the head coach -
          from the live depth charts, so injuries and depth-chart moves are in before you
          deal. It never changes a player you added or a status you set by hand, and it
          never touches a roster that has already been dealt.
        </p>
        {!canRefresh ? (
          <p className="pp-sub">
            <strong>Available before you deal.</strong> This week is already under way
            ({String(phase).replace("-", " ")}), so the pool stays as it is - rosters are
            out and a player who stops being a starter finishes his week. Refresh once
            this week is finalized and before you deal the next one.
          </p>
        ) : null}
        <button
          className="pp-btn pp-btn-gold"
          disabled={!canRefresh || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onRefreshPool();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Reading depth charts..." : "Refresh Player Pool"}
        </button>
      </div>
      <PoolRefreshReport report={poolReport} />

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
  /* Merged over the defaults, because a league whose config was stored before the
   * 2026-08-28 split has none of the per-category keys - and a missing value would make
   * its input uncontrolled. The engine falls back the same way when it scores. */
  const [cfg, setCfg] = useState(
    Object.assign({}, DEFAULT_SCORING, deepClone(state.scoringConfig))
  );
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Scoring Settings</h3>
      <p className="pp-sub">
        Yards convert per category - a passing yard and a rushing yard do not have to be
        worth the same. Each box below is "1 point per N yards", so a bigger number means
        that category is worth less.
      </p>
      <div className="pp-grid-2">
        <div className="pp-field"><label className="pp-label">1 pt per N passing yards</label><input className="pp-input" type="number" value={cfg.passYardsPerPoint} onChange={(e) => setCfg(Object.assign({}, cfg, { passYardsPerPoint: e.target.value }))} /></div>
        <div className="pp-field"><label className="pp-label">1 pt per N rushing yards</label><input className="pp-input" type="number" value={cfg.rushYardsPerPoint} onChange={(e) => setCfg(Object.assign({}, cfg, { rushYardsPerPoint: e.target.value }))} /></div>
        <div className="pp-field"><label className="pp-label">1 pt per N receiving yards</label><input className="pp-input" type="number" value={cfg.recYardsPerPoint} onChange={(e) => setCfg(Object.assign({}, cfg, { recYardsPerPoint: e.target.value }))} /></div>
      </div>
      <div className="pp-grid-2">
        <div className="pp-field"><label className="pp-label">Points per passing TD</label><input className="pp-input" type="number" value={cfg.pointsPerPassTD} onChange={(e) => setCfg(Object.assign({}, cfg, { pointsPerPassTD: e.target.value }))} /></div>
        <div className="pp-field"><label className="pp-label">Points per rushing TD</label><input className="pp-input" type="number" value={cfg.pointsPerRushTD} onChange={(e) => setCfg(Object.assign({}, cfg, { pointsPerRushTD: e.target.value }))} /></div>
        <div className="pp-field"><label className="pp-label">Points per receiving TD</label><input className="pp-input" type="number" value={cfg.pointsPerRecTD} onChange={(e) => setCfg(Object.assign({}, cfg, { pointsPerRecTD: e.target.value }))} /></div>
      </div>
      <div className="pp-grid-2">
        <div className="pp-field"><label className="pp-label">Coach Win</label><input className="pp-input" type="number" value={cfg.coachWin} onChange={(e) => setCfg(Object.assign({}, cfg, { coachWin: e.target.value }))} /></div>
        <div className="pp-field"><label className="pp-label">Coach Tie</label><input className="pp-input" type="number" value={cfg.coachTie} onChange={(e) => setCfg(Object.assign({}, cfg, { coachTie: e.target.value }))} /></div>
        <div className="pp-field"><label className="pp-label">Coach Loss</label><input className="pp-input" type="number" value={cfg.coachLoss} onChange={(e) => setCfg(Object.assign({}, cfg, { coachLoss: e.target.value }))} /></div>
      </div>
      <button className="pp-btn pp-btn-gold" onClick={() => onSave({
        passYardsPerPoint: Number(cfg.passYardsPerPoint) || DEFAULT_SCORING.passYardsPerPoint,
        rushYardsPerPoint: Number(cfg.rushYardsPerPoint) || DEFAULT_SCORING.rushYardsPerPoint,
        recYardsPerPoint: Number(cfg.recYardsPerPoint) || DEFAULT_SCORING.recYardsPerPoint,
        pointsPerPassTD: Number(cfg.pointsPerPassTD) || 0,
        pointsPerRushTD: Number(cfg.pointsPerRushTD) || 0,
        pointsPerRecTD: Number(cfg.pointsPerRecTD) || 0,
        /* Carried, not edited: these score stat lines recorded before the 2026-08-28
         * split and must keep the values those lines were entered under. */
        yardsPerPoint: Number(cfg.yardsPerPoint) || DEFAULT_SCORING.yardsPerPoint,
        pointsPerTD: Number(cfg.pointsPerTD) || 0,
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

export function CommInvitePanel({ state, invites, onCreateInvite, onRevokeInvite }) {
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
        <div key={t.id} className="pp-roster-slot"><div style={{ flex: 1 }}>{t.name}</div></div>
      ))}
    </div>
  );
}

/* "Enter Stats" arrived here from the Rosters hub (issues #29, #30). It belongs with Deal
 * and Process Schemes: they are the three steps of the same commissioner-driven week, and
 * Finalize - the step that ends the week - is on this panel. It leads the list, and it is
 * the sub-tab this screen opens on while a week is live, so it is FEWER taps away than it
 * was as the third sub-tab of Rosters, not more. */
/* ISSUE #24. Ten flat sub-tabs in no particular order, with no sign that only one of
 * them matters yet. This is the order written down, on the screen, ticking itself off -
 * and it removes itself the moment the first week is dealt, so it is scaffolding rather
 * than furniture. Nothing here can act; every line points at a sub-tab above it. */
export function CommSetupChecklist({ state, onGoToSub }) {
  const steps = [
    { done: state.teams.length > 0, sub: "teams", label: "Add your teams", note: "One row per manager." },
    { done: state.teams.length > 0, sub: "invite", label: "Invite the managers", note: "Each invite signs one person in as themselves." },
    /* _meta, not currentPeriod. The NFL week is a server-owned column kept OUT of the
     * state proper because parity depends on the artifact's shape - see the note in
     * src/storage/hydrate.js. Read off currentPeriod it is always undefined, and the
     * step would sit unticked forever. */
    { done: !!(state._meta && state._meta.nflWeek), sub: "weeks", label: "Set the NFL week", note: "Optional - it is what Pull Stats reads from." },
    { done: false, sub: "weeks", label: "Deal " + periodLabel(state.currentPeriod), note: "Every team gets a fresh random 12-player roster." },
  ];
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Setting up</h3>
      <p className="pp-sub" style={{ marginBottom: 10 }}>
        Four steps to a running league. This disappears once the first week is dealt.
      </p>
      {steps.map((st, i) => (
        <div key={i} className="pp-checkstep">
          <span className={"pp-checkbox" + (st.done ? " done" : "")}>{st.done ? "x" : String(i + 1)}</span>
          <div style={{ flex: 1 }}>
            <div className="pp-checkstep-label">{st.label}</div>
            <div className="pp-sub">{st.note}</div>
          </div>
          <button className="pp-btn pp-btn-sm" onClick={() => onGoToSub(st.sub)}>Open</button>
        </div>
      ))}
    </div>
  );
}

export function CommissionerTab(props) {
  const midWeek = props.state.currentPeriod.phase !== "pre-deal";
  const [sub, setSub] = useState(midWeek ? "stats" : "teams");
  /* Only before the very first deal. A league in week 6 sitting at pre-deal is a
   * commissioner between weeks, not a commissioner setting up. */
  const setupPhase = !midWeek
    && props.state.currentPeriod.type === "week"
    && props.state.currentPeriod.number === 1;
  const subs = ["stats", "teams", "weeks", "roster-mgmt", "pool", "scoring", "standings-cfg", "playoffs", "invite", "backup", "reset"];
  const labels = { stats: "Enter Stats", teams: "Teams", weeks: "Weeks", "roster-mgmt": "Manage Rosters", pool: "Player Pool", scoring: "Scoring", "standings-cfg": "Standings Cfg", playoffs: "Playoffs", invite: "Invite", backup: "Backup", reset: "Reset" };
  return (
    <div>
      {setupPhase ? <CommSetupChecklist state={props.state} onGoToSub={setSub} /> : null}
      <div className="pp-subnav">
        {subs.map((s) => <button key={s} className={"pp-subnav-btn" + (sub === s ? " active" : "")} onClick={() => setSub(s)}>{labels[s]}</button>)}
      </div>
      {sub === "stats" && (
        <LiveStatsTab
          state={props.state} isCommissioner={true}
          onStatChange={props.onStatChange} onToggleRosterLock={props.onToggleRosterLock}
          onFinalize={props.onFinalize} finalizeError={props.finalizeError}
          onPullStats={props.onPullStats} statsReport={props.statsReport}
        />
      )}
      {sub === "teams" && <CommTeamsPanel state={props.state} onAddTeam={props.onAddTeam} onRenameTeam={props.onRenameTeam} onRemoveTeam={props.onRemoveTeam} />}
      {sub === "weeks" && <CommWeeksPanel state={props.state} onDeal={props.onDeal} onProcessSchemes={props.onProcessSchemes} dealError={props.dealError} submittedTeamIds={props.submittedTeamIds} onSetNflWeek={props.onSetNflWeek} onSetLineupLock={props.onSetLineupLock} onRefreshKickoffs={props.onRefreshKickoffs} kickoffReport={props.kickoffReport} />}
      {sub === "roster-mgmt" && <CommManageRostersPanel state={props.state} onSwap={props.onSwap} onSubmitScheme={props.onSubmitScheme} />}
      {sub === "pool" && <CommPlayerPoolPanel state={props.state} onAddPlayer={props.onAddPlayer} onSetStatus={props.onSetStatus} onDeletePlayer={props.onDeletePlayer} onRefreshPool={props.onRefreshPool} poolReport={props.poolReport} phase={props.state.currentPeriod.phase} />}
      {sub === "scoring" && <CommScoringPanel state={props.state} onSave={props.onSaveScoring} />}
      {sub === "standings-cfg" && <CommStandingsCfgPanel state={props.state} onSave={props.onSaveStandingsCfg} />}
      {sub === "playoffs" && <CommPlayoffsPanel state={props.state} onStart={props.onStartPlayoffs} />}
      {sub === "invite" && <CommInvitePanel state={props.state} invites={props.invites} onCreateInvite={props.onCreateInvite} onRevokeInvite={props.onRevokeInvite} />}
      {sub === "backup" && <CommBackupPanel state={props.state} onDownload={props.onDownloadBackup} onRestore={props.onRestoreBackup} restoreError={props.restoreError} />}
      {sub === "reset" && <CommResetPanel onReset={props.onResetLeague} />}
    </div>
  );
}

/* ================================== App ==================================== */
