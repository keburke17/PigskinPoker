/* Pigskin Poker UI - the Rosters tab.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 1650-1674. Changed since: it
 * lost its third sub-tab - see below.
 */

import { useState } from "react";
import { PeriodBanner } from "./atoms.jsx";
import { AllRostersTab, FreeAgentsTab } from "./rosterTabs.jsx";

/* WHAT LEFT THIS HUB, AND WHY. "Live Stats" used to be the third sub-tab here, and it was
 * two screens welded together: a running scoreboard everybody wanted, sitting on top of
 * the commissioner's stat-entry wall - six editable rows per team, Lock Rosters, Pull
 * Stats and Finalize Week. A manager who found it scrolled past the only scoreboard in the
 * app into a screen full of inputs they could not use (issues #29, #30).
 *
 * The scoreboard is now the Scoreboard tab, which is where people were looking for it.
 * The stat entry moved to the Commissioner tab, next to Deal and Process Schemes - the
 * other two steps of the same weekly flow. Finalize did not get harder to find; it got
 * filed with the rest of the commissioner's week.
 *
 * What is left is what the tab is named after: who has who. */
export function RosterHubTab({ state, myTeam }) {
  const [sub, setSub] = useState("rosters");
  return (
    <div>
      <PeriodBanner state={state} />
      <div className="pp-subnav">
        <button className={"pp-subnav-btn" + (sub === "rosters" ? " active" : "")} onClick={() => setSub("rosters")}>All Rosters</button>
        <button className={"pp-subnav-btn" + (sub === "fa" ? " active" : "")} onClick={() => setSub("fa")}>Free Agents</button>
      </div>
      {sub === "rosters" && <AllRostersTab state={state} myTeam={myTeam} />}
      {sub === "fa" && <FreeAgentsTab state={state} />}
    </div>
  );
}

/* ============================= Weekly Results =============================== */

