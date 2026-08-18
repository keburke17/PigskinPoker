/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1131-1245.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { ICON } from "../engine/index.js";
import { EmptyState } from "./atoms.jsx";

export function StandingsTable({ rows, teams }) {
  if (rows.length === 0) return <EmptyState>No standings yet - finalize a week to populate this table.</EmptyState>;
  const ordered = rows.slice().sort((a, b) => a.rank - b.rank);
  return (
    <div className="pp-table-scroll">
      <table className="pp-table pp-table-wide">
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            <th>Team</th>
            <th style={{ textAlign: "right" }}>Std Pts</th>
            <th style={{ textAlign: "right" }}>Week Wins</th>
            <th style={{ textAlign: "right" }}>Coach Wins</th>
            <th style={{ textAlign: "right" }}>TDs</th>
            <th style={{ textAlign: "right" }}>Yards</th>
            <th>Best Player</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => {
            const best = r.cum.bestPlayer;
            return (
              <tr key={r.teamId} className={r.rank === 1 ? "pp-standings-first" : ""}>
                <td>{r.rank === 1 ? <span className="pp-crown">{ICON.crown}</span> : null}{r.rank}</td>
                <td style={{ fontWeight: 700 }}>{r.teamName}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--gold-bright)" }}>{r.cum.standingsPoints}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.cum.weekWins}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.cum.coachWins}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.cum.totalTDs}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.cum.totalYards}</td>
                <td style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{best ? best.name + " - " + best.points + " pts (" + best.periodLabel + ")" : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PlayoffsPanel({ state }) {
  const cfg = state.playoffConfig;
  if (!cfg.started) {
    return <EmptyState>Playoffs are TBD. The commissioner hasn't started them yet.</EmptyState>;
  }
  const roundResults = {};
  state.weeklyResults.forEach((r) => {
    if (r.period.type !== "playoff") return;
    const key = r.period.number;
    roundResults[key] = roundResults[key] || [];
    roundResults[key].push(r);
  });
  const rounds = Object.keys(roundResults).map(Number).sort((a, b) => a - b);
  return (
    <div>
      <p className="pp-sub" style={{ marginBottom: 10 }}>
        Bracket size {cfg.bracketSize} | Advancement: {cfg.advancement.join(" -> ")}
        {cfg.completed && cfg.champion ? <> {"|"} <strong style={{ color: "var(--gold-bright)" }}>Champion: {(state.teams.find(t => t.id === cfg.champion) || {}).name}</strong></> : null}
      </p>
      {rounds.length === 0 ? (
        <EmptyState>Round 1 is set but no rounds have been finalized yet.</EmptyState>
      ) : (
        rounds.map((rn) => (
          <div key={rn} className="pp-card pp-card-tight">
            <h3 className="pp-h3">Playoff Round {rn}</h3>
            <table className="pp-table">
              <thead><tr><th style={{ width: 34 }}>#</th><th>Team</th><th style={{ textAlign: "right" }}>Score</th></tr></thead>
              <tbody>
                {roundResults[rn].slice().sort((a, b) => a.rank - b.rank).map((r) => (
                  <tr key={r.id}><td>{r.rank}</td><td>{r.teamName}</td><td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.rawScore}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
      {!cfg.completed ? (
        <p className="pp-sub">Currently active in the bracket: {cfg.activeTeamIds.map((id) => (state.teams.find(t => t.id === id) || {}).name).join(", ")}</p>
      ) : null}
    </div>
  );
}

export function ActivityPanel({ state }) {
  const log = (state.activityLog || []).slice().reverse();
  if (log.length === 0) return <EmptyState>No activity yet. Steals, redraws, blocks, and week results will show up here.</EmptyState>;
  const grouped = [];
  let lastLabel = null;
  log.forEach((entry) => {
    if (entry.periodLabel !== lastLabel) {
      grouped.push({ header: entry.periodLabel });
      lastLabel = entry.periodLabel;
    }
    grouped.push(entry);
  });
  const iconFor = (type) => ({
    steal: ICON.football, "steal-failed": ICON.warn, redraw: ICON.redraw, block: ICON.shield,
    result: ICON.flag, warning: ICON.warn, "playoffs-start": ICON.trophy, advance: ICON.forward, champion: ICON.trophy,
  }[type] || "*");
  return (
    <div>
      {grouped.map((item, i) =>
        item.header ? (
          <div key={"h" + i} className="pp-eyebrow" style={{ margin: "14px 0 6px" }}>{item.header}</div>
        ) : (
          <div key={item.id} className="pp-card pp-card-tight" style={{ marginBottom: 8, display: "flex", gap: 10 }}>
            <span>{iconFor(item.type)}</span>
            <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{item.text}</span>
          </div>
        )
      )}
    </div>
  );
}

