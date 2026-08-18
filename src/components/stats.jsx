/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1529-1649.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { computeStarterPoints, getPlayer } from "../engine/index.js";
import { ConfirmButton, EmptyState, ErrorBanner, SuitBadge } from "./atoms.jsx";
import { RosterSlotRow } from "./roster.jsx";

export function StatEntryRow({ state, team, slot, isCommissioner, onChange }) {
  const pid = team.roster.starters[slot];
  const player = getPlayer(state, pid);
  const stats = (state.statsEntry[team.id] || {})[slot] || {};
  const locks = state.lockedPlayerIds || {};
  const locked = pid && locks[pid];
  if (!player) return <RosterSlotRow slot={slot} player={null} state={state} showStats={false} />;

  if (!isCommissioner) {
    return <RosterSlotRow slot={slot} player={player} state={state} statLine={stats} locked={locked} showStats={true} />;
  }

  return (
    <div className="pp-roster-slot" style={{ flexWrap: "wrap" }}>
      <span className="pp-roster-slot-label">{slot}</span>
      <SuitBadge position={player.position} />
      <div style={{ flex: 1, minWidth: 120 }}>
        <div className="pp-roster-slot-name">{player.name}</div>
        <div className="pp-roster-slot-meta">{player.position} - {player.team}</div>
      </div>
      {player.position === "Coach" ? (
        <select className="pp-select" style={{ width: 120 }} value={stats.result || ""} onChange={(e) => onChange(team.id, slot, { result: e.target.value || null })}>
          <option value="">Result...</option>
          <option value="Win">Win</option>
          <option value="Tie">Tie</option>
          <option value="Loss">Loss</option>
        </select>
      ) : (
        <>
          <input className="pp-input" style={{ width: 78 }} type="number" placeholder="Yards" value={stats.yards != null ? stats.yards : ""} onChange={(e) => onChange(team.id, slot, Object.assign({}, stats, { yards: e.target.value }))} />
          <input className="pp-input" style={{ width: 62 }} type="number" placeholder="TDs" value={stats.tds != null ? stats.tds : ""} onChange={(e) => onChange(team.id, slot, Object.assign({}, stats, { tds: e.target.value }))} />
        </>
      )}
      <span className="pp-roster-slot-pts">{computeStarterPoints(state, stats, player.position)} pts</span>
      <button className={"pp-btn pp-btn-sm " + (locked ? "pp-btn-danger" : "pp-btn-ghost")} onClick={() => onChange(team.id, "__togglelock__", pid)}>
        {locked ? "Unlock" : "Lock"}
      </button>
    </div>
  );
}

export function teamRunningScore(state, team) {
  if (!team.roster) return 0;
  const stats = (state.statsEntry && state.statsEntry[team.id]) || {};
  let total = 0;
  ["Coach", "QB", "WR", "RB", "TE", "FLEX"].forEach((slot) => {
    const pid = team.roster.starters[slot];
    const player = getPlayer(state, pid);
    total += computeStarterPoints(state, stats[slot], player ? player.position : slot);
  });
  return total;
}

export function LiveScoresBar({ state, teams }) {
  const rows = teams.filter((t) => t.roster).map((t) => ({ team: t, score: teamRunningScore(state, t) }))
    .sort((a, b) => b.score - a.score);
  if (rows.length === 0) return null;
  return (
    <div className="pp-card">
      <h3 className="pp-h3">This {state.currentPeriod.type === "playoff" ? "Round's" : "Week's"} Scores</h3>
      <table className="pp-table">
        <thead><tr><th style={{ width: 30 }}>#</th><th>Team</th><th style={{ textAlign: "right" }}>Score</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.team.id}>
              <td>{i + 1}</td>
              <td style={{ fontWeight: 700 }}>{r.team.name}</td>
              <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--gold-bright)" }}>{r.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pp-sub" style={{ marginTop: 8, marginBottom: 0 }}>Updates live as stats are entered - only counts starters that already have a stat line.</p>
    </div>
  );
}

export function LiveStatsTab({ state, isCommissioner, onStatChange, onToggleRosterLock, onFinalize, finalizeError }) {
  const teamsForPeriod = state.currentPeriod.type === "playoff"
    ? state.teams.filter((t) => state.playoffConfig.activeTeamIds.includes(t.id))
    : state.teams;

  if (teamsForPeriod.length === 0) return <EmptyState>No teams to show stats for.</EmptyState>;
  if (teamsForPeriod.every((t) => !t.roster)) return <EmptyState>No roster dealt yet this period.</EmptyState>;

  return (
    <div>
      {isCommissioner && (
        <div className="pp-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h3 className="pp-h3" style={{ marginBottom: 2 }}>Commissioner Controls</h3>
              <p className="pp-sub">Enter stats for each starter, then finalize the {state.currentPeriod.type === "playoff" ? "round" : "week"} once everyone's in.</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className={"pp-btn " + (state.rosterLocked ? "pp-btn-danger" : "")} onClick={onToggleRosterLock}>
                {state.rosterLocked ? "Unlock Rosters" : "Lock Rosters for the Weekend"}
              </button>
              <ConfirmButton label={"Finalize " + (state.currentPeriod.type === "playoff" ? "Round" : "Week")} confirmLabel="Yes, finalize" onConfirm={onFinalize} />
            </div>
          </div>
          {finalizeError ? <ErrorBanner message={finalizeError} /> : null}
        </div>
      )}
      <LiveScoresBar state={state} teams={teamsForPeriod} />
      {teamsForPeriod.map((team) => (
        <div key={team.id} className="pp-card">
          <h3 className="pp-h3">{team.name}</h3>
          {!team.roster ? <EmptyState>No roster dealt.</EmptyState> : (
            ["Coach", "QB", "WR", "RB", "TE", "FLEX"].map((slot) => (
              <StatEntryRow key={slot} state={state} team={team} slot={slot} isCommissioner={isCommissioner} onChange={onStatChange} />
            ))
          )}
        </div>
      ))}
    </div>
  );
}

/* ========================= Combined Rosters / FA / Stats hub ========================= */

