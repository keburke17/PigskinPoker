/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1246-1272.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { useState } from "react";
import { emptyCumulative, periodLabel, rankTeamsWithTiebreak, seasonStandingsRows } from "../engine/index.js";
import { ActivityPanel, PlayoffsPanel, StandingsTable } from "./standings.jsx";

export function LeagueHomeTab({ state }) {
  const [sub, setSub] = useState("regular");
  const standings = seasonStandingsRows(state);
  const ranked = rankTeamsWithTiebreak(standings.map((r) => ({ teamId: r.teamId, rawScore: r.rawScore, tb: r.tb })))
    .map((r) => Object.assign({}, r, { teamName: (state.teams.find(t => t.id === r.teamId) || {}).name, cum: (state.teams.find(t => t.id === r.teamId) || {}).cumulative || emptyCumulative() }));

  return (
    <div>
      <div className="pp-subnav">
        <button className={"pp-subnav-btn" + (sub === "regular" ? " active" : "")} onClick={() => setSub("regular")}>Regular Season</button>
        <button className={"pp-subnav-btn" + (sub === "playoffs" ? " active" : "")} onClick={() => setSub("playoffs")}>Playoffs</button>
        <button className={"pp-subnav-btn" + (sub === "activity" ? " active" : "")} onClick={() => setSub("activity")}>Activity</button>
      </div>
      <div className="pp-card">
        <div className="pp-eyebrow" style={{ marginBottom: 8 }}>{periodLabel(state.currentPeriod)} - {state.currentPeriod.phase.replace("-", " ")}</div>
        {sub === "regular" && (state.playoffConfig.started
          ? <><p className="pp-sub" style={{ marginBottom: 10 }}>Regular-season standings are frozen - playoffs are underway.</p><StandingsTable rows={ranked} teams={state.teams} /></>
          : <StandingsTable rows={ranked} teams={state.teams} />)}
        {sub === "playoffs" && <PlayoffsPanel state={state} />}
        {sub === "activity" && <ActivityPanel state={state} />}
      </div>
    </div>
  );
}

/* ================================ My Team ================================ */

