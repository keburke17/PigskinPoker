/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1650-1674.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { useState } from "react";
import { PeriodBanner } from "./atoms.jsx";
import { AllRostersTab, FreeAgentsTab } from "./rosterTabs.jsx";
import { LiveStatsTab } from "./stats.jsx";

export function RosterHubTab({ state, isCommissioner, onStatChange, onToggleRosterLock, onFinalize, finalizeError, onPullStats, statsReport, onSetAutoPullStats }) {
  const [sub, setSub] = useState("rosters");
  return (
    <div>
      <PeriodBanner state={state} />
      <div className="pp-subnav">
        <button className={"pp-subnav-btn" + (sub === "rosters" ? " active" : "")} onClick={() => setSub("rosters")}>All Rosters</button>
        <button className={"pp-subnav-btn" + (sub === "fa" ? " active" : "")} onClick={() => setSub("fa")}>Free Agents</button>
        <button className={"pp-subnav-btn" + (sub === "stats" ? " active" : "")} onClick={() => setSub("stats")}>Live Stats</button>
      </div>
      {sub === "rosters" && <AllRostersTab state={state} />}
      {sub === "fa" && <FreeAgentsTab state={state} />}
      {sub === "stats" && (
        <LiveStatsTab
          state={state} isCommissioner={isCommissioner}
          onStatChange={onStatChange} onToggleRosterLock={onToggleRosterLock}
          onFinalize={onFinalize} finalizeError={finalizeError}
          onPullStats={onPullStats} statsReport={statsReport}
          onSetAutoPullStats={onSetAutoPullStats}
        />
      )}
    </div>
  );
}

/* ============================= Weekly Results =============================== */

