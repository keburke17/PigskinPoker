/* The Week screen's one scoreboard: the week being played, then every finished week.
 *
 * WHY THIS EXISTS. The Week screen used to end with one table per finished week, every
 * week stacked down the page (WeeklyResultsTab, the artifact's own screen) - by week 12
 * that is twelve tables to scroll past. Scott, 2026-10-16: one scoreboard, with arrows
 * and week buttons to move between weeks, carrying the same columns as the league
 * standings - score, standings points, week win, coach result, TDs, yards, best player -
 * so a manager can go back to any finished week and see how they did.
 *
 * A FINISHED WEEK ONLY READS WHAT FINALIZE SAVED. Every column there is a field on a weeklyResults
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
import { isTable, periodLabel, periodTitle, projectCurrentPeriod, standingsThrough } from "../engine/index.js";
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

/* standingsThrough moved to src/engine/standings.js (2026-10-19) so the weekly recap,
 * written on the server, ranks a team exactly as this screen does. Re-exported here for
 * anything that already imported it from this file. */
export { standingsThrough };

const COACH = { Win: "W", Tie: "T", Loss: "L" };

const ordinal = (n) => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return n + "th";
  return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
};


/* THE WEEK BEING PLAYED IS THE LAST PAGE (Scott, 2026-10-17). There used to be two
 * scoreboards on the Week screen - the live table and this card - and he asked for one:
 * this card, exactly as it looks, with the current week added. So the current week is
 * drawn in the same columns, from projectCurrentPeriod - the same three engine calls
 * finalize makes, and exactly what the old live table showed. It reads; only the
 * commissioner's finalize writes anything.
 *
 * Three columns cannot mean the same thing before a week is over, and each says so
 * rather than guessing: Wk Win is "-" for everyone (nobody has won yet); Std Pts is what
 * the week would award right now, and "-" before schemes process, because rosters can
 * still change (the old live table hid the column then, for the same reason); and
 * "Season through this week" stops at the last FINISHED week, so a projection is never
 * added into the standings. */
const LIVE_PHASES = { dealt: true, "schemes-processed": true, stats: true };

/** The current week as scoreboard rows, or null when there is no week being played. */
export function liveRows(state) {
  const period = state && state.currentPeriod;
  if (!period || !LIVE_PHASES[period.phase]) return null;
  if (finishedPeriods(state.weeklyResults).some((p) => samePeriod(p, period))) return null;
  const { rows } = projectCurrentPeriod(state);
  if (!rows || rows.length === 0) return null;
  const projected = period.phase !== "dealt";
  return rows.map((r) => ({
    id: "live-" + r.teamId,
    teamId: r.teamId,
    teamName: r.teamName,
    rank: r.rank,
    rawScore: r.rawScore,
    standingsPoints: projected ? r.standingsPoints : null,
    coachResult: r.coachResult,
    tds: r.tds,
    yards: r.yards,
    bestPlayer: r.bestThisPeriod,
  }));
}

/** Every page of the card: finished periods in order, then the week being played. */
export function scoreboardPages(state) {
  const pages = finishedPeriods(state.weeklyResults).map((p) => ({ type: p.type, number: p.number, live: false }));
  if (liveRows(state)) pages.push({ type: state.currentPeriod.type, number: state.currentPeriod.number, live: true });
  return pages;
}

const stripLabel = (p) => (p.type === "playoff" ? "R" + p.number : String(p.number));

export function WeekByWeekScoreboard({ state, myTeam }) {
  const pages = scoreboardPages(state);
  /* null means "the latest", so the card opens on the week being played, and moves on by
   * itself when a new week is dealt or finalized. */
  const [picked, setPicked] = useState(null);
  const [mode, setMode] = useState("week");
  if (pages.length === 0) return null;
  /* A table (issue #75) keeps no running points, so the card drops the standings-points
   * column and the "season through this week" view, and calls each page a hand. */
  const table = isTable(state);

  const at = picked !== null && picked < pages.length ? picked : pages.length - 1;
  const page = pages[at];
  /* The finished week "Season through this week" counts up to: the page itself, or for
   * the week being played, the last finished regular week before it. */
  const seasonTo = table || page.type !== "week"
    ? null
    : page.live
      ? pages.slice(0, at).filter((p) => p.type === "week").pop() || null
      : page;
  const seasonView = mode === "season" && !!seasonTo;
  const rows = page.live ? liveRows(state) : resultsFor(state.weeklyResults, page);
  const standings = seasonView ? standingsThrough(state.weeklyResults, seasonTo) : null;
  const myId = myTeam ? myTeam.id : null;
  const mineWeek = rows.find((r) => r.teamId === myId);
  const mineSeason = standings ? standings.find((r) => r.teamId === myId) : null;
  const sp = (v) => (v == null ? "-" : v);

  return (
    <div className="pp-card">
      <div className="pp-eyebrow" style={{ marginBottom: 8 }}>Scoreboard</div>
      <div className="pp-wk-head">
        <button type="button" className="pp-wk-btn" onClick={() => setPicked(at - 1)} disabled={at === 0} aria-label="Previous week">{"<"}</button>
        <div className="pp-wk-title">
          <b>{periodTitle(state, page)}</b>
          <small>{seasonView ? "Standings after " + periodLabel(seasonTo) : page.live ? "In progress" : "Final"}</small>
        </div>
        <button type="button" className="pp-wk-btn" onClick={() => setPicked(at + 1)} disabled={at === pages.length - 1} aria-label="Next week">{">"}</button>
      </div>
      <div className="pp-wk-strip">
        {pages.map((p, i) => (
          <button key={p.type + p.number} type="button" aria-pressed={i === at} className={"pp-wk-pick" + (i === at ? " active" : "")} onClick={() => setPicked(i)}>{stripLabel(p)}</button>
        ))}
      </div>
      {seasonTo ? (
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
          {table ? null : <div><b>{mineWeek.standingsPoints == null ? "-" : "+" + mineWeek.standingsPoints}</b><span>Std Pts</span></div>}
          <div><b>{mineWeek.tds}</b><span>TDs</span></div>
          {table ? <div><b>{mineWeek.yards}</b><span>Yards</span></div> : null}
        </div>
      ) : null}

      {seasonView ? (
        <StandingsTable rows={standings} teams={state.teams} />
      ) : rows.length === 0 ? (
        <EmptyState>No results recorded for {periodTitle(state, page)}.</EmptyState>
      ) : (
        <div className="pp-table-scroll">
          <table className="pp-table pp-table-wide pp-wk-table">
            <thead>
              <tr>
                <th className="pp-wk-stick1" style={{ width: 30 }}>#</th>
                <th className="pp-wk-stick2">{table ? "Player" : "Team"}</th>
                <th style={{ textAlign: "right" }}>Score</th>
                {table ? null : <th style={{ textAlign: "right" }}>Std Pts</th>}
                <th style={{ textAlign: "right" }}>{table ? "Won" : "Wk Win"}</th>
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
                  {table ? null : <td className="pp-wk-num" style={{ color: "var(--gold-bright)", fontWeight: 700 }}>{sp(r.standingsPoints)}</td>}
                  <td className="pp-wk-num">{r.rank === 1 && !page.live ? <span className="pp-wk-win">Won</span> : "-"}</td>
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
