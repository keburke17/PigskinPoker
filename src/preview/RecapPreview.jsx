/* The weekly-recap preview: the real league screens - header, nav, My Team, Week,
 * League, Rosters - for a 12-team league on the Tuesday morning Week 7 was dealt, with
 * the recap pop-up on top and a bar at the bottom to flip between the samples.
 *
 * Open /recap-preview.html under `npm run dev`. Nothing here talks to a database: the
 * league is built in the browser by previewLeague.js and every button that would save
 * something does nothing.
 */

import { useMemo, useState } from "react";
import { SUIT_CH } from "../engine/index.js";
import { MyTeamTab } from "../components/MyTeamTab.jsx";
import { ScoreboardTab } from "../components/ScoreboardTab.jsx";
import { LeagueHomeTab } from "../components/LeagueHomeTab.jsx";
import { RosterHubTab } from "../components/RosterHubTab.jsx";
import { createPreviewLeague, PREVIEW_TEAMS, previewTeamId } from "./previewLeague.js";
import { RECAP_EXAMPLES } from "./recapExamples.js";
import { RecapReminder, WeeklyRecap } from "./WeeklyRecap.jsx";

const NAV = [
  { key: "results", label: "Week" },
  { key: "myteam", label: "My Team" },
  { key: "home", label: "League" },
  { key: "hub", label: "Rosters" },
];

const noop = () => {};

export function RecapPreview() {
  const state = useMemo(() => createPreviewLeague(), []);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState("myteam");

  const recap = RECAP_EXAMPLES[index];
  /* You are whichever team the sample is about, so the header and My Team match it. */
  const teamIdx = Math.max(0, PREVIEW_TEAMS.indexOf(recap.team));
  const myTeam = state.teams.find((t) => t.id === previewTeamId(teamIdx));

  const show = (i) => {
    setIndex((i + RECAP_EXAMPLES.length) % RECAP_EXAMPLES.length);
    setTab("myteam");
    setOpen(true);
    window.scrollTo(0, 0);
  };

  return (
    <div className="pp-root pp-preview-root" style={{ paddingBottom: 90 }}>
      {open ? <WeeklyRecap recap={recap} onClose={() => setOpen(false)} onGoTo={setTab} /> : null}

      <div className="pp-container">
        <div className="pp-header">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="pp-eyebrow">Pigskin Poker</div>
              <h1 className="pp-h1 pp-league-title">{SUIT_CH.spade} {state.leagueName} {SUIT_CH.diamond}</h1>
              <span className="pp-badge-role">{myTeam.name}</span>
            </div>
            <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={noop}>Log Out</button>
          </div>
          <div className="pp-nav-wrap">
            <nav className="pp-nav">
              {NAV.map((n) => (
                <button key={n.key} className={"pp-nav-btn" + (tab === n.key ? " active" : "")} onClick={() => setTab(n.key)}>{n.label}</button>
              ))}
            </nav>
          </div>
        </div>

        <div style={{ paddingTop: 14 }}>
          {tab !== "myteam" ? (
            <div className="pp-preview-note">
              Preview: this league&apos;s scores are a random demo and won&apos;t match the recap&apos;s numbers.
            </div>
          ) : null}
          {tab === "myteam" ? (
            <>
              <RecapReminder recap={recap} onOpen={() => setOpen(true)} />
              <MyTeamTab state={state} team={myTeam} onSwap={noop} onSubmitScheme={noop} onRename={noop} onGoTo={setTab} />
            </>
          ) : null}
          {tab === "results" ? <ScoreboardTab state={state} myTeam={myTeam} onSeeAllActivity={() => setTab("home")} onGoTo={setTab} /> : null}
          {tab === "home" ? <LeagueHomeTab state={state} myTeam={myTeam} /> : null}
          {tab === "hub" ? <RosterHubTab state={state} myTeam={myTeam} /> : null}
        </div>
      </div>

      <div className="pp-preview-bar">
        <span className="pp-preview-tag">Sample</span>
        <button onClick={() => show(index - 1)} aria-label="Previous sample">{"<"}</button>
        <select value={index} onChange={(e) => show(Number(e.target.value))} aria-label="Choose a sample recap">
          {RECAP_EXAMPLES.map((r, i) => (
            <option key={r.id} value={i}>{r.label}</option>
          ))}
        </select>
        <button onClick={() => show(index + 1)} aria-label="Next sample">{">"}</button>
      </div>
    </div>
  );
}
