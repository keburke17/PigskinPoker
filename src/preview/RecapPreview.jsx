/* The weekly-recap preview: the real league screens - header, nav, My Team, Week,
 * League, Rosters - for a 12-team league on the Tuesday morning Week 11 was dealt, with
 * the recap pop-up on top and a bar at the bottom to flip between recaps.
 *
 * Two kinds of recap, chosen in the bar:
 *   FREE      - written by freeRecap.js from this league's own Weeks 2 to 10, with
 *               fill-in-the-blank lines. No AI, no account. Its numbers match the screens.
 *   AI-STYLE  - the hand-written samples in recapExamples.js, showing what an AI writer
 *               (a paid account) would aim for. Its numbers do NOT match the screens.
 *
 * Open /recap-preview.html under `npm run dev`. Nothing here talks to a database and
 * every button that would save something does nothing.
 */

import { useMemo, useState } from "react";
import { SUIT_CH } from "../engine/index.js";
import { MyTeamTab } from "../components/MyTeamTab.jsx";
import { ScoreboardTab } from "../components/ScoreboardTab.jsx";
import { LeagueHomeTab } from "../components/LeagueHomeTab.jsx";
import { RosterHubTab } from "../components/RosterHubTab.jsx";
import { createPreviewLeague, PREVIEW_TEAMS, previewTeamId, RECAP_WEEKS } from "./previewLeague.js";
import { RECAP_EXAMPLES } from "./recapExamples.js";
import { freeRecapsByWeek } from "./freeRecap.js";
import { RecapReminder, WeeklyRecap } from "./WeeklyRecap.jsx";

const NAV = [
  { key: "results", label: "Week" },
  { key: "myteam", label: "My Team" },
  { key: "home", label: "League" },
  { key: "hub", label: "Rosters" },
];

const noop = () => {};

export function RecapPreview() {
  const league = useMemo(() => createPreviewLeague(), []);
  const state = league.state;
  const sets = useMemo(() => {
    const byWeek = freeRecapsByWeek(league, RECAP_WEEKS);
    const free = RECAP_WEEKS.slice().reverse().map((w) => ({ key: "free" + w, label: "Free - Week " + w, recaps: byWeek[w], free: true }));
    return [...free, { key: "ai", label: "AI-style samples", recaps: RECAP_EXAMPLES, free: false }];
  }, [league]);

  const [setIdx, setSetIdx] = useState(0);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState("myteam");

  const set = sets[setIdx];
  const recap = set.recaps[index];
  /* You are whichever team the recap is about, so the header and My Team match it. */
  const teamIdx = Math.max(0, PREVIEW_TEAMS.indexOf(recap.team));
  const myTeam = state.teams.find((t) => t.id === previewTeamId(teamIdx));

  const show = (i) => {
    setIndex((i + set.recaps.length) % set.recaps.length);
    setTab("myteam");
    setOpen(true);
    window.scrollTo(0, 0);
  };
  const switchSet = (i) => {
    setSetIdx(i);
    setIndex(0);
    setTab("myteam");
    setOpen(true);
  };

  return (
    <div className="pp-root pp-preview-root" style={{ paddingBottom: 130 }}>
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
          {tab !== "myteam" && !set.free ? (
            <div className="pp-preview-note">
              Preview: the AI-style samples were written by hand, so this league&apos;s scores won&apos;t match them. Switch to a Free set and they will.
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
        <div className="pp-preview-row">
          <span className={"pp-preview-tag" + (set.free ? " free" : "")}>{set.free ? "Free" : "Paid AI"}</span>
          <select value={setIdx} onChange={(e) => switchSet(Number(e.target.value))} aria-label="Choose which recaps">
            {sets.map((s, i) => (
              <option key={s.key} value={i}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="pp-preview-row">
          <button onClick={() => show(index - 1)} aria-label="Previous recap">{"<"}</button>
          <select value={index} onChange={(e) => show(Number(e.target.value))} aria-label="Choose a recap">
            {set.recaps.map((r, i) => (
              <option key={r.id} value={i}>{r.label}</option>
            ))}
          </select>
          <button onClick={() => show(index + 1)} aria-label="Next recap">{">"}</button>
        </div>
      </div>
    </div>
  );
}
