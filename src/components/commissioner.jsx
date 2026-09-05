/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1816-2097.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { useEffect, useRef, useState } from "react";
import { DEFAULT_SCORING, POSITIONS, deepClone, defaultAdvancement, periodLabel, standingsPointsArray } from "../engine/index.js";
import { MyTeamTab } from "./MyTeamTab.jsx";
import { ConfirmButton, EmptyState, ErrorBanner, SuitBadge, Tag, TypedConfirm } from "./atoms.jsx";

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
      {state.teams.length === 0 ? <EmptyState>No teams yet - add your first team above.</EmptyState> : null}
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

export function CommWeeksPanel({ state, onDeal, onProcessSchemes, dealError, submittedTeamIds, onSetNflWeek }) {
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
      <CommNflWeekPanel state={state} onSetNflWeek={onSetNflWeek} />
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
  const {
    added = [], renamed = [], retired = 0, updated = 0, untouched = [], gaps = [],
    sidelined = [], injuries = null, coachesKept = 0,
  } = report;
  const when = report.at ? String(report.at).replace("T", " ").replace("Z", " UTC") : "just now";
  return (
    <div className="pp-card pp-card-tight">
      <h3 className="pp-h3">What the refresh changed</h3>
      <p className="pp-sub">Depth charts as of {when}.</p>
      <ul className="pp-rule-list">
        <li>{updated} player{updated === 1 ? "" : "s"} confirmed or corrected.</li>
        <li>{added.length} added, {retired} retired from the deal.</li>
        {coachesKept > 0 && (
          <li>{coachesKept} head coach{coachesKept === 1 ? "" : "es"} left exactly as you have {coachesKept === 1 ? "it" : "them"}.</li>
        )}
        {/* Whether the injury half ran is worth saying either way: a refresh that
          * quietly skipped it looks identical to one that found nobody hurt. */}
        {injuries && injuries.ok && <li>Injury statuses read from week {injuries.week}.</li>}
        {injuries && !injuries.ok && (
          <li>
            <strong>Injury statuses could not be read</strong> ({injuries.reason}). The pool
            is still current on depth-chart order, which is usually a day or two behind an
            injury. Refreshing again later will pick them up.
          </li>
        )}
      </ul>
      {sidelined.length > 0 && (
        <>
          <p className="pp-sub" style={{ marginBottom: 4 }}><strong>Listed as starters but hurt - skipped, next man up</strong></p>
          <ul className="pp-rule-list">
            {sidelined.slice(0, 12).map((s, i) => (
              <li key={i}>{s.name} - {s.position}{s.depthRank ? String(s.depthRank) : ""}, {s.team} <span style={{ color: "var(--text-faint)" }}>({s.status})</span></li>
            ))}
            {sidelined.length > 12 ? <li>...and {sidelined.length - 12} more.</li> : null}
          </ul>
        </>
      )}
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

/* One player in the pool, with the correction the refresh cannot make for you.
 *
 * Renaming exists because head coaches became yours on 2026-09-04. A list nobody may
 * edit is not a list you maintain, and delete-then-add-again is a poor way to fix a
 * spelling. Renaming a player the feed owns is fine too - the next refresh matches him
 * by his provider id and puts its own spelling back, which is the feed correcting its
 * own work exactly as it should. */
function PoolPlayerRow({ player, dimmed, onSetStatus, onDeletePlayer, onRenamePlayer, onRestorePlayer }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(player.name);
  const [team, setTeam] = useState(player.team);
  const save = () => {
    const n = name.trim();
    const t = team.trim();
    if (n && t && (n !== player.name || t !== player.team)) onRenamePlayer(player.id, n, t);
    setEditing(false);
  };
  return (
    <div className="pp-roster-slot" style={{ flexWrap: "wrap", opacity: dimmed ? 0.55 : 1 }}>
      <SuitBadge position={player.position} />
      {editing ? (
        <div style={{ flex: 1, minWidth: 180, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input className="pp-input" style={{ flex: 2, minWidth: 120 }} value={name} onChange={(e) => setName(e.target.value)} />
          <input className="pp-input" style={{ flex: 2, minWidth: 120 }} value={team} onChange={(e) => setTeam(e.target.value)} />
          <button className="pp-btn pp-btn-gold" onClick={save}>Save</button>
          <button className="pp-btn" onClick={() => { setName(player.name); setTeam(player.team); setEditing(false); }}>Cancel</button>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, minWidth: 120 }}>
            <div className="pp-roster-slot-name">{player.name}</div>
            <div className="pp-roster-slot-meta">{player.team}</div>
          </div>
          <button className="pp-btn" onClick={() => setEditing(true)}>Edit</button>
        </>
      )}
      {onRestorePlayer ? (
        <button className="pp-btn" onClick={() => onRestorePlayer(player.id)}>Restore</button>
      ) : (
        <select className="pp-select" style={{ width: 100 }} value={player.status} onChange={(e) => onSetStatus(player.id, e.target.value)}>
          <option value="Active">Active</option>
          <option value="OUT">OUT</option>
          <option value="IR">IR</option>
          <option value="BYE">BYE</option>
        </select>
      )}
      <ConfirmButton label="Delete" confirmLabel="Yes, delete" danger onConfirm={() => onDeletePlayer(player.id)} />
    </div>
  );
}

export function CommPlayerPoolPanel({ state, onAddPlayer, onSetStatus, onDeletePlayer, onRenamePlayer, onRestorePlayer, onRefreshPool, poolReport, phase }) {
  const [name, setName] = useState("");
  const [position, setPosition] = useState("QB");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const canRefresh = phase === "pre-deal";
  /* THREE GROUPS, NOT ONE LIST. Retiring a player never deletes him - a deleted player
   * would break the rosters and results that already reference him - so the pool keeps
   * every mistake the hand-typed list ever had. Listing those beside the live players is
   * what made a working refresh look broken on 2026-09-04: the WR card said 75 when only
   * 64 could be dealt, and "Derek Henry (OUT)" sat one line from "Derrick Henry".
   *
   * `sidelined` and `retired` are deliberately different things, and only this screen
   * shows the second one:
   *   sidelined - in the pool, not playing this week. OUT / IR / BYE. Every manager sees
   *               these on the Free Agents screen, and should.
   *   retired   - dropped from the pool by a refresh. Nobody but the commissioner sees
   *               them; showing "James Cook" to a league whose rosters have "James Cook
   *               III" in them reads as a duplicate or a bug. */
  const grouped = POSITIONS.reduce((acc, pos) => {
    const all = state.playerPool.filter((p) => p.position === pos);
    const byName = (a, b) => a.name.localeCompare(b.name);
    acc[pos] = {
      dealable: all.filter((p) => !p.retired && p.status === "Active").sort(byName),
      sidelined: all.filter((p) => !p.retired && p.status !== "Active").sort(byName),
      retired: all.filter((p) => p.retired).sort(byName),
    };
    return acc;
  }, {});
  const retiredTotal = POSITIONS.reduce((n, pos) => n + grouped[pos].retired.length, 0);
  return (
    <div>
      <div className="pp-card">
        <h3 className="pp-h3">Refresh From Live Rosters</h3>
        <p className="pp-sub">
          Pulls every team's current starters - 1 QB, 2 RB, 2 WR and 1 TE - from the live
          depth charts, so injuries and depth-chart moves are in before you deal. A
          starter who is on injured reserve is marked IR and the next healthy man takes
          his place, so every NFL team still contributes a full set. It never changes a
          player you added or a status you set by hand, and it never touches a roster that
          has already been dealt.
        </p>
        <p className="pp-sub">
          <strong>Head coaches are yours.</strong> The refresh does not add, rename or
          retire a single one - use Edit below to correct them.
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
      {retiredTotal > 0 && (
        <div className="pp-card pp-card-tight">
          <p className="pp-sub" style={{ marginBottom: 8 }}>
            <strong>{retiredTotal} retired player{retiredTotal === 1 ? "" : "s"} - only you can see {retiredTotal === 1 ? "him" : "them"}.</strong>
            {" "}A refresh dropped {retiredTotal === 1 ? "him" : "them"}: no longer a listed
            starter, or a misspelling the feed replaced with the real man. They are kept
            rather than deleted so the weeks they already played still make sense, and
            they are hidden from your managers so a retired name never turns up beside the
            player who replaced him. <strong>Restore</strong> puts one back in the pool.
          </p>
          <button className="pp-btn" onClick={() => setShowRetired((v) => !v)}>
            {showRetired ? "Hide retired players" : "Show retired players"}
          </button>
        </div>
      )}

      {POSITIONS.map((pos) => (
        <div key={pos} className="pp-card">
          <h3 className="pp-h3">
            {pos}{" "}
            <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>
              ({grouped[pos].dealable.length} in the deal
              {grouped[pos].sidelined.length ? ", " + grouped[pos].sidelined.length + " sidelined" : ""}
              {grouped[pos].retired.length ? ", " + grouped[pos].retired.length + " retired" : ""})
            </span>
          </h3>
          {grouped[pos].dealable.map((p) => (
            <PoolPlayerRow key={p.id} player={p} onSetStatus={onSetStatus} onDeletePlayer={onDeletePlayer} onRenamePlayer={onRenamePlayer} />
          ))}
          {/* Sidelined players stay in the main list: they are in the pool, your managers
            * can see them on Free Agents, and hiding them from you would be a lie. */}
          {grouped[pos].sidelined.map((p) => (
            <PoolPlayerRow key={p.id} player={p} onSetStatus={onSetStatus} onDeletePlayer={onDeletePlayer} onRenamePlayer={onRenamePlayer} />
          ))}
          {showRetired && grouped[pos].retired.length > 0 && (
            <>
              <p className="pp-sub" style={{ margin: "12px 0 4px" }}>
                <strong>Retired</strong> - not in the pool, and not shown to your managers.
              </p>
              {grouped[pos].retired.map((p) => (
                <PoolPlayerRow
                  key={p.id}
                  player={p}
                  dimmed
                  onSetStatus={onSetStatus}
                  onDeletePlayer={onDeletePlayer}
                  onRenamePlayer={onRenamePlayer}
                  onRestorePlayer={onRestorePlayer}
                />
              ))}
            </>
          )}
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

export function CommissionerTab(props) {
  const [sub, setSub] = useState("teams");
  const subs = ["teams", "weeks", "roster-mgmt", "pool", "scoring", "standings-cfg", "playoffs", "invite", "backup", "reset"];
  const labels = { teams: "Teams", weeks: "Weeks", "roster-mgmt": "Manage Rosters", pool: "Player Pool", scoring: "Scoring", "standings-cfg": "Standings Cfg", playoffs: "Playoffs", invite: "Invite", backup: "Backup", reset: "Reset" };
  return (
    <div>
      <div className="pp-subnav">
        {subs.map((s) => <button key={s} className={"pp-subnav-btn" + (sub === s ? " active" : "")} onClick={() => setSub(s)}>{labels[s]}</button>)}
      </div>
      {sub === "teams" && <CommTeamsPanel state={props.state} onAddTeam={props.onAddTeam} onRenameTeam={props.onRenameTeam} onRemoveTeam={props.onRemoveTeam} />}
      {sub === "weeks" && <CommWeeksPanel state={props.state} onDeal={props.onDeal} onProcessSchemes={props.onProcessSchemes} dealError={props.dealError} submittedTeamIds={props.submittedTeamIds} onSetNflWeek={props.onSetNflWeek} />}
      {sub === "roster-mgmt" && <CommManageRostersPanel state={props.state} onSwap={props.onSwap} onSubmitScheme={props.onSubmitScheme} />}
      {sub === "pool" && <CommPlayerPoolPanel state={props.state} onAddPlayer={props.onAddPlayer} onSetStatus={props.onSetStatus} onDeletePlayer={props.onDeletePlayer} onRenamePlayer={props.onRenamePlayer} onRestorePlayer={props.onRestorePlayer} onRefreshPool={props.onRefreshPool} poolReport={props.poolReport} phase={props.state.currentPeriod.phase} />}
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
