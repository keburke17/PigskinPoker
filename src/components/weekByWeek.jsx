/* Finished weeks, one at a time.
 *
 * WHY THIS EXISTS. The Week screen used to end with one table per finished week, every
 * week stacked down the page (WeeklyResultsTab, the artifact's own screen) - by week 12
 * that is twelve tables to scroll past. Scott, 2026-10-16: one scoreboard, with arrows
 * and week buttons to move between weeks, carrying the same columns as the league
 * standings - score, standings points, week win, coach result, TDs, yards, best player -
 * so a manager can go back to any finished week and see how they did.
 *
 * IT ONLY READS WHAT FINALIZE SAVED. Every column here is a field on a weeklyResults
 * entry (finalizeCurrentPeriod in src/engine/standings.js writes them; hydrate.js reads
 * them back from period_results). Nothing is recalculated, so a finished week cannot
 * show anything other than what it finalized as.
 *
 * "SEASON THROUGH THIS WEEK" is the league standings as they stood after that week: the
 * same weeklyResults summed up to it, ranked by the engine's own rankTeamsWithTiebreak
 * and drawn by the league's own StandingsTable. It is offered for regular-season weeks
 * only - playoff rounds have their own bracket screen and their own running totals.
 */

import { useState } from "react";
import { emptyCumulative, periodLabel, rankTeamsWithTiebreak } from "../engine/index.js";
import { EmptyState } from "./atoms.jsx";
import { StandingsTable } from "./standings.jsx";

const samePeriod = (a, b) => !!a && !!b && a.type === b.type && a.number === b.number;

/** Every finalized period, in the order it was played: regular weeks, then playoff rounds. */
export function finishedPeriods(weeklyResults) {
  const seen = [];
  (weeklyResults || []).forEach((r) => {
    if (r.period && !seen.some((p) => samePeriod(p, r.period))) seen.push({ type: r.period.type, number: r.period.number });
  });
  return seen.sort((a, b) => {
    if (a.type !== b.type) return a.type === "playoff" ? 1 : -1;
    return a.number - b.number;
  });
}

/** One period's results, best first. */
export function resultsFor(weeklyResults, period) {
  return (weeklyResults || []).filter((r) => samePeriod(r.period, period)).slice().sort((a, b) => a.rank - b.rank);
}

/** The regular-season standings as they stood after `period`, in StandingsTable's shape. */
export function standingsThrough(weeklyResults, period) {
  const byTeam = new Map();
  (weeklyResults || [])
    .filter((r) => r.period && r.period.type === "week" && r.period.number <= period.number)
    .slice()
    .sort((a, b) => a.period.number - b.period.number)
    .forEach((r) => {
      const t = byTeam.get(r.teamId) || { teamId: r.teamId, teamName: r.teamName, cum: emptyCumulative() };
      t.teamName = r.teamName || t.teamName;
      const cum = t.cum;
      cum.standingsPoints += r.standingsPoints || 0;
      if (r.rank === 1) cum.weekWins += 1;
      if (r.coachResult === "Win") cum.coachWins += 1;
      cum.totalTDs += r.tds || 0;
      cum.totalYards += r.yards || 0;
      if (r.bestPlayer && (!cum.bestPlayer || r.bestPlayer.points > cum.bestPlayer.points)) {
        cum.bestPlayer = { name: r.bestPlayer.name, position: r.bestPlayer.position, points: r.bestPlayer.points, periodLabel: r.periodLabel || periodLabel(r.period) };
      }
      byTeam.set(r.teamId, t);
    });
  const rows = Array.from(byTeam.values()).map((t) => ({
    teamId: t.teamId,
    teamName: t.teamName,
    cum: t.cum,
    rawScore: t.cum.standingsPoints,
    tb: [t.cum.standingsPoints, t.cum.weekWins, t.cum.coachWins, t.cum.totalTDs, t.cum.totalYards, t.cum.bestPlayer ? t.cum.bestPlayer.points : 0],
  }));
  return rankTeamsWithTiebreak(rows);
}

const COACH = { Win: "W", Tie: "T", Loss: "L" };

const ordinal = (n) => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return n + "th";
  return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
};

const stripLabel = (p) => (p.type === "playoff" ? "R" + p.number : String(p.number));

export function WeekByWeekScoreboard({ state, myTeam }) {
  const periods = finishedPeriods(state.weeklyResults);
  /* null means "the latest", so a week finalized while the screen is open moves the card
   * on to it rather than leaving it parked on the old one. */
  const [picked, setPicked] = useState(null);
  const [mode, setMode] = useState("week");
  if (periods.length === 0) return null;

  const at = picked !== null && picked < periods.length ? picked : periods.length - 1;
  const period = periods[at];
  const seasonView = mode === "season" && period.type === "week";
  const rows = resultsFor(state.weeklyResults, period);
  const standings = seasonView ? standingsThrough(state.weeklyResults, period) : null;
  const myId = myTeam ? myTeam.id : null;
  const mineWeek = rows.find((r) => r.teamId === myId);
  const mineSeason = standings ? standings.find((r) => r.teamId === myId) : null;

  return (
    <div className="pp-card">
      <div className="pp-eyebrow" style={{ marginBottom: 8 }}>Finished Weeks</div>
      <div className="pp-wk-head">
        <button type="button" className="pp-wk-btn" onClick={() => setPicked(at - 1)} disabled={at === 0} aria-label="Previous week">{"<"}</button>
        <div className="pp-wk-title">
          <b>{periodLabel(period)}</b>
          <small>{seasonView ? "Standings after " + periodLabel(period) : "Final"}</small>
        </div>
        <button type="button" className="pp-wk-btn" onClick={() => setPicked(at + 1)} disabled={at === periods.length - 1} aria-label="Next week">{">"}</button>
      </div>
      <div className="pp-wk-strip">
        {periods.map((p, i) => (
          <button key={p.type + p.number} type="button" aria-pressed={i === at} className={"pp-wk-pick" + (i === at ? " active" : "")} onClick={() => setPicked(i)}>{stripLabel(p)}</button>
        ))}
      </div>
      {period.type === "week" ? (
        <div className="pp-wk-mode">
          <button type="button" className={mode === "week" ? "active" : ""} onClick={() => setMode("week")}>This week only</button>
          <button type="button" className={mode === "season" ? "active" : ""} onClick={() => setMode("season")}>Season through this week</button>
        </div>
      ) : null}

      {seasonView && mineSeason ? (
        <div className="pp-wk-mine">
          <div><b>{ordinal(mineSeason.rank)}</b><span>Place</span></div>
          <div><b>{mineSeason.cum.standingsPoints}</b><span>Std Pts</span></div>
          <div><b>{mineSeason.cum.weekWins}</b><span>Wk Wins</span></div>
          <div><b>{mineSeason.cum.coachWins}</b><span>Coach W</span></div>
        </div>
      ) : null}
      {!seasonView && mineWeek ? (
        <div className="pp-wk-mine">
          <div><b>{ordinal(mineWeek.rank)}</b><span>Finish</span></div>
          <div><b>{mineWeek.rawScore}</b><span>Score</span></div>
          <div><b>+{mineWeek.standingsPoints}</b><span>Std Pts</span></div>
          <div><b>{mineWeek.tds}</b><span>TDs</span></div>
        </div>
      ) : null}

      {seasonView ? (
        <StandingsTable rows={standings} teams={state.teams} />
      ) : rows.length === 0 ? (
        <EmptyState>No results recorded for {periodLabel(period)}.</EmptyState>
      ) : (
        <div className="pp-table-scroll">
          <table className="pp-table pp-table-wide pp-wk-table">
            <thead>
              <tr>
                <th className="pp-wk-stick1" style={{ width: 30 }}>#</th>
                <th className="pp-wk-stick2">Team</th>
                <th style={{ textAlign: "right" }}>Score</th>
                <th style={{ textAlign: "right" }}>Std Pts</th>
                <th style={{ textAlign: "right" }}>Wk Win</th>
                <th style={{ textAlign: "right" }}>Coach</th>
                <th style={{ textAlign: "right" }}>TDs</th>
                <th style={{ textAlign: "right" }}>Yards</th>
                <th>Best Player</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.teamId === myId ? "pp-wk-me" : ""}>
                  <td className="pp-wk-stick1">{r.rank}</td>
                  <td className="pp-wk-stick2" style={{ fontWeight: 700 }}>{r.teamName}</td>
                  <td className="pp-wk-num" style={{ fontWeight: 700 }}>{r.rawScore}</td>
                  <td className="pp-wk-num" style={{ color: "var(--gold-bright)", fontWeight: 700 }}>{r.standingsPoints}</td>
                  <td className="pp-wk-num">{r.rank === 1 ? <span className="pp-wk-win">Won</span> : "-"}</td>
                  <td className={"pp-wk-num pp-wk-coach-" + (COACH[r.coachResult] || "none")}>{COACH[r.coachResult] || "-"}</td>
                  <td className="pp-wk-num">{r.tds}</td>
                  <td className="pp-wk-num">{r.yards}</td>
                  <td style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                    {r.bestPlayer ? r.bestPlayer.name + " (" + r.bestPlayer.position + ") - " + r.bestPlayer.points + " pts" : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
