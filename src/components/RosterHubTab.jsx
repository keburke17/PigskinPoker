/* Pigskin Poker UI - the Rosters tab.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 1650-1674. Changed since: it
 * lost its third sub-tab - see below.
 */

import { useEffect, useRef, useState } from "react";
import { periodTitle } from "../engine/index.js";
import { PeriodBanner } from "./atoms.jsx";
import { AllRostersTab, FreeAgentsTab, RosterGridTab } from "./rosterTabs.jsx";
import { pastRosterPeriods, pastWeekState } from "./pastWeek.js";

/* WHAT LEFT THIS HUB, AND WHY. "Live Stats" used to be the third sub-tab here, and it was
 * two screens welded together: a running scoreboard everybody wanted, sitting on top of
 * the commissioner's stat-entry wall - six editable rows per team, Lock Rosters, Pull
 * Stats and Finalize Week. A manager who found it scrolled past the only scoreboard in the
 * app into a screen full of inputs they could not use (issues #29, #30).
 *
 * The scoreboard is now the Week tab, which is where people were looking for it.
 * The stat entry moved to the Commissioner tab, next to Deal and Process Schemes - the
 * other two steps of the same weekly flow. Finalize did not get harder to find; it got
 * filed with the rest of the commissioner's week.
 *
 * What is left is what the tab is named after: who has who.
 *
 * THREE TABS SINCE 2026-10-22 (Scott). Roster Grid is the draft-board glance at the whole
 * league and opens first; Full Rosters is the old All Rosters, untouched, for opponents,
 * kickoffs and the injury notepad; Free Agents is unchanged. */
/* GOING BACK A WEEK (Scott, 2026-10-27). A picker above the sub-tabs steps through every
 * finished week, then "Now". A finished week redraws the Roster Grid and Full Rosters with
 * that week's rosters, the points each player scored and every team's scheme - read from
 * what the league kept (pastWeek.js), never recalculated. Free Agents is this week only:
 * who was free in Week 3 is not something anyone can act on. Its button stays put on a
 * past week and brings you back to now, because a tab that vanished read as a tab that
 * had been removed (Scott, 2026-10-27). */
export function RosterHubTab({ state, myTeam }) {
  const [sub, setSub] = useState("grid");
  /* null is "now", so a fresh deal moves the screen on by itself. */
  const [picked, setPicked] = useState(null);
  const pages = pastRosterPeriods(state);
  const at = picked !== null && picked < pages.length ? picked : pages.length;
  const past = at < pages.length ? pastWeekState(state, pages[at]) : null;
  const view = past || state;
  return (
    <div>
      <PeriodBanner state={state} />
      {pages.length > 0 ? (
        <WeekPicker
          state={state}
          pages={pages}
          at={at}
          onPick={(i) => {
            setPicked(i >= pages.length ? null : i);
            /* Free Agents is this week only, so going back a week from it opens the grid. */
            if (i < pages.length && sub === "fa") setSub("grid");
          }}
        />
      ) : null}
      <div className="pp-subnav">
        <button className={"pp-subnav-btn" + (sub === "grid" ? " active" : "")} onClick={() => setSub("grid")}>Roster Grid</button>
        <button className={"pp-subnav-btn" + (sub === "rosters" ? " active" : "")} onClick={() => setSub("rosters")}>Full Rosters</button>
        <button
          className={"pp-subnav-btn" + (sub === "fa" ? " active" : "")}
          onClick={() => {
            setSub("fa");
            setPicked(null);
          }}
        >
          Free Agents
        </button>
      </div>
      {sub === "grid" && <RosterGridTab state={view} myTeam={myTeam} />}
      {sub === "rosters" && <AllRostersTab state={view} myTeam={myTeam} />}
      {sub === "fa" && <FreeAgentsTab state={state} />}
    </div>
  );
}

/* The same arrows and week buttons as the Week screen's scoreboard, so moving between
 * weeks works the same way on both screens. */
export function WeekPicker({ state, pages, at, onPick }) {
  const last = pages.length;
  const label = (p) => (p.type === "playoff" ? "R" + p.number : String(p.number));
  /* By Week 10 the strip is wider than a phone, and "Now" - where it opens - is off the
   * right edge. Keep the lit button in view. */
  const strip = useRef(null);
  useEffect(() => {
    const el = strip.current && strip.current.querySelector(".pp-wk-pick.active");
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [at]);
  return (
    <div className="pp-card pp-card-tight pp-rh-picker">
      <div className="pp-wk-head">
        <button type="button" className="pp-wk-btn" onClick={() => onPick(at - 1)} disabled={at === 0} aria-label="Previous week">{"<"}</button>
        <div className="pp-wk-title">
          <b>{at < last ? periodTitle(state, pages[at]) : periodTitle(state)}</b>
          <small>{at < last ? "Final - looking back" : "This week"}</small>
        </div>
        <button type="button" className="pp-wk-btn" onClick={() => onPick(at + 1)} disabled={at === last} aria-label="Next week">{">"}</button>
      </div>
      <div className="pp-wk-strip" ref={strip}>
        {pages.map((p, i) => (
          <button key={p.type + p.number} type="button" aria-pressed={i === at} className={"pp-wk-pick" + (i === at ? " active" : "")} onClick={() => onPick(i)}>{label(p)}</button>
        ))}
        <button type="button" aria-pressed={at === last} className={"pp-wk-pick" + (at === last ? " active" : "")} onClick={() => onPick(last)}>Now</button>
      </div>
    </div>
  );
}

/* ============================= Weekly Results =============================== */

