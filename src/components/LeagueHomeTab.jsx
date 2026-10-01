/* Pigskin Poker UI - extracted from
 * LegacyProject/PigskinPokerCode.jsx lines 1246-1272.
 *
 * Extracted verbatim, with only module boundaries added. Since then it takes two props
 * it did not have (2026-09-08, OQ-20): `initialSub`, so the week screen's "All weeks"
 * link can open the Activity panel directly, and `myTeam`, which that panel uses only to
 * tint the rows naming your team. The three sub-tabs and what they show are unchanged.
 */

import { useState } from "react";
import { emptyCumulative, periodLabel, rankTeamsWithTiebreak, seasonStandingsRows } from "../engine/index.js";
import { ActivityPanel, PlayoffsPanel, StandingsTable } from "./standings.jsx";

/* `initialSub` lets the week card's "All weeks" link land on the activity log rather
 * than on the standings (OQ-20). Read once, at mount, which is all it needs to be:
 * App keys this component on the same value, so arriving again re-mounts it. */
export function LeagueHomeTab({ state, myTeam, initialSub }) {
  const [sub, setSub] = useState(initialSub || "regular");
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
        {sub === "activity" && <ActivityPanel state={state} myTeam={myTeam} />}
      </div>
    </div>
  );
}

/* ================================ My Team ================================ */

