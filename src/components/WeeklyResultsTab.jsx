/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1675-1715.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { EmptyState } from "./atoms.jsx";

export function WeeklyResultsTab({ state }) {
  const byPeriod = {};
  state.weeklyResults.forEach((r) => {
    const key = r.periodLabel;
    byPeriod[key] = byPeriod[key] || [];
    byPeriod[key].push(r);
  });
  const keys = Object.keys(byPeriod);
  // sort by underlying period number descending, weeks before playoffs is fine since labels differ
  const order = state.weeklyResults.reduce((acc, r) => { acc[r.periodLabel] = r; return acc; }, {});
  keys.sort((a, b) => {
    const pa = order[a].period, pb = order[b].period;
    if (pa.type !== pb.type) return pa.type === "playoff" ? -1 : 1; // playoffs happen after the regular season, so they're most recent
    return pb.number - pa.number;
  });
  if (keys.length === 0) return <EmptyState>No weeks finalized yet. History will appear here after the commissioner finalizes a week.</EmptyState>;
  return (
    <div>
      {keys.map((label) => (
        <div key={label} className="pp-card">
          <h3 className="pp-h3">{label}</h3>
          <table className="pp-table">
            <thead><tr><th style={{ width: 30 }}>#</th><th>Team</th><th style={{ textAlign: "right" }}>Score</th><th style={{ textAlign: "right" }}>Std Pts</th></tr></thead>
            <tbody>
              {byPeriod[label].slice().sort((a, b) => a.rank - b.rank).map((r) => (
                <tr key={r.id}>
                  <td>{r.rank}</td><td>{r.teamName}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.rawScore}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--gold-bright)" }}>{r.standingsPoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/* ================================== Rules ==================================== */

