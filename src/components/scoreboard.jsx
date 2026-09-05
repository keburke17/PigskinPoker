/* The week in progress.
 *
 * WHY THIS EXISTS (issues #29 and #30). Between the deal and the finalize - which is the
 * entire time a week is interesting - the app had nowhere that answered "how is the
 * league doing right now". League Home showed the last FINALIZED week's standings, My
 * Team showed a lineup with no points on it at all, Weekly Results said "No weeks
 * finalized yet", and the only running scoreboard in the app was the third sub-tab of
 * Rosters, underneath the commissioner's stat-entry controls. So the answer was: scroll
 * through six roster cards and add up thirty-six numbers in your head, on a phone.
 *
 * This is the screen every other fantasy app opens on: your team and its score first,
 * then the league table, then the rosters if you want them.
 *
 * IT READS, IT DOES NOT FINALIZE. Every number here comes from projectCurrentPeriod,
 * which is the same three engine calls finalizeCurrentPeriod makes, in the same order -
 * so the mid-week scoreboard cannot disagree with the week it turns into. Nothing here
 * writes to `cumulative`; only the commissioner pressing Finalize does that, and the
 * commissioner-driven flow is unchanged.
 */

import { periodLabel, projectCurrentPeriod } from "../engine/index.js";
import { EmptyState, PeriodBanner } from "./atoms.jsx";
import { TeamRosterBlock } from "./roster.jsx";

const ordinal = (n) => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return n + "th";
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return n + suffix;
};

/** The league table for the open period. Sorted by the engine, not here - see the note
 *  on projectCurrentPeriod about why re-sorting would be wrong. */
export function WeekScoreTable({ state, rows, myTeamId, showProjection }) {
  if (rows.length === 0) return null;
  const roundWord = state.currentPeriod.type === "playoff" ? "Round" : "Week";
  return (
    <div className="pp-table-scroll">
      <table className="pp-table">
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            <th>Team</th>
            <th style={{ textAlign: "right" }}>Score</th>
            {showProjection ? <th style={{ textAlign: "right" }}>Std Pts</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.teamId} className={r.teamId === myTeamId ? "pp-my-row" : ""}>
              <td>{r.rank}</td>
              <td style={{ fontWeight: 700 }}>
                {r.teamName}
                {r.teamId === myTeamId ? <span className="pp-you-tag">You</span> : null}
              </td>
              <td className="pp-num pp-num-gold">{r.rawScore}</td>
              {showProjection ? <td className="pp-num">{r.standingsPoints}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pp-sub" style={{ marginTop: 8, marginBottom: 0 }}>
        Updates as stats are entered - a starter with no line yet counts as zero.
        {showProjection
          ? " Std Pts is what this " + roundWord.toLowerCase() +
            " would award if it finalized right now; nothing is banked until the commissioner finalizes it."
          : ""}
      </p>
    </div>
  );
}

/** Your team, at the top, where a fantasy app puts it. */
function MyWeekCard({ state, team, rows }) {
  const row = rows.find((r) => r.teamId === team.id);
  if (!row) return null;
  const leader = rows[0];
  const behind = leader ? leader.rawScore - row.rawScore : 0;
  const best = row.bestThisPeriod;
  return (
    <div className="pp-card pp-my-card">
      <div className="pp-score-hero">
        <div style={{ minWidth: 0 }}>
          <div className="pp-eyebrow">Your {state.currentPeriod.type === "playoff" ? "round" : "week"}</div>
          <h2 className="pp-h2" style={{ marginBottom: 2 }}>{team.name}</h2>
          <div className="pp-sub" style={{ marginBottom: 0 }}>
            {ordinal(row.rank)} of {rows.length}
            {behind > 0 ? " - " + behind + " behind " + leader.teamName : row.rank === 1 ? " - leading" : ""}
          </div>
        </div>
        <div className="pp-score-big">{row.rawScore}</div>
      </div>
      {best && best.points > 0 ? (
        <p className="pp-sub" style={{ margin: "8px 0 10px" }}>
          Top scorer: <strong style={{ color: "var(--text)" }}>{best.name}</strong> - {best.points} pt{best.points === 1 ? "" : "s"}
        </p>
      ) : null}
      <TeamRosterBlock team={team} state={state} showStats={true} showBench={false} showTotal={false} />
    </div>
  );
}

export function WeekScoreboard({ state, myTeam }) {
  const period = state.currentPeriod;
  const roundWord = period.type === "playoff" ? "round" : "week";

  /* Pre-deal is a real state, not an absence of one, and it deserves a sentence that says
   * so. "No weeks finalized yet" was the old message here and it was answering a
   * different question. */
  if (period.phase === "pre-deal") {
    return (
      <div>
        <PeriodBanner state={state} />
        <div className="pp-card">
          <EmptyState>
            {periodLabel(period)} has not been dealt yet. Scores appear here as soon as the
            commissioner deals the {roundWord}.
          </EmptyState>
        </div>
      </div>
    );
  }

  const { rows } = projectCurrentPeriod(state);
  if (rows.length === 0) {
    return (
      <div>
        <PeriodBanner state={state} />
        <div className="pp-card">
          <EmptyState>No teams are playing this {roundWord}.</EmptyState>
        </div>
      </div>
    );
  }

  /* Before schemes are processed the rosters can still change, so a rank has nothing
   * behind it yet and a projected standings-points column would only be noise. */
  const showProjection = period.phase !== "dealt";

  return (
    <div>
      <PeriodBanner state={state} extra={state.rosterLocked ? "Rosters locked" : null} />
      {myTeam ? <MyWeekCard state={state} team={myTeam} rows={rows} /> : null}
      <div className="pp-card">
        <h3 className="pp-h3">{periodLabel(period)} Scoreboard</h3>
        <WeekScoreTable
          state={state}
          rows={rows}
          myTeamId={myTeam ? myTeam.id : null}
          showProjection={showProjection}
        />
      </div>
    </div>
  );
}
