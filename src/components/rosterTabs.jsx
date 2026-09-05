/* Pigskin Poker UI - the Rosters hub's two panels.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 1474-1528. FreeAgentsTab is
 * unchanged; AllRostersTab was rebuilt for issues #29 and #30 - see the note on it.
 */

import { useState } from "react";
import { FA_TABS, ICON, allRosteredPlayerIds, teamPeriodScore } from "../engine/index.js";
import { EmptyState, SuitBadge, Tag } from "./atoms.jsx";
import { TeamRosterBlock } from "./roster.jsx";

/* One team's card: the headline everybody wants, and the twelve rows only some people do.
 *
 * Collapsed by default so the whole league fits on one phone screen (issue #30 asked for
 * "compact"), with the answer - name and total - on the line you can already see. Your
 * own team opens by itself, because the one card you came for should not need a tap. */
function TeamRosterCard({ team, state, showStats, isMine }) {
  const [open, setOpen] = useState(isMine);
  return (
    <div className={"pp-card pp-card-tight" + (isMine ? " pp-my-card" : "")}>
      <button className="pp-roster-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="pp-roster-head-caret">{open ? ICON.caretDown : ICON.caretRight}</span>
        <span className="pp-roster-head-name">
          {team.name}
          {isMine ? <span className="pp-you-tag">You</span> : null}
        </span>
        {showStats && team.roster ? (
          <span className="pp-roster-head-pts">{teamPeriodScore(state, team)}</span>
        ) : null}
      </button>
      {open ? (
        <div style={{ marginTop: 8 }}>
          <TeamRosterBlock team={team} state={state} showStats={showStats} showBench={true} showTotal={false} />
        </div>
      ) : null}
    </div>
  );
}

/* Who has who. It is a browse, not a dashboard - the scoreboard tab is the dashboard now,
 * so this does not have to be the place anyone adds numbers up.
 *
 * `myTeam` first, then everybody else in the order the league stores them. The list stays
 * complete; your team is lifted out of it, not filtered from it. */
export function AllRostersTab({ state, myTeam }) {
  if (state.teams.length === 0) return <EmptyState>No teams yet.</EmptyState>;
  const mine = myTeam ? state.teams.filter((t) => t.id === myTeam.id) : [];
  const rest = state.teams.filter((t) => !myTeam || t.id !== myTeam.id);
  const showStats = state.currentPeriod.phase !== "pre-deal";
  return (
    <div>
      {mine.concat(rest).map((team) => (
        <TeamRosterCard
          key={team.id}
          team={team}
          state={state}
          showStats={showStats}
          isMine={!!myTeam && team.id === myTeam.id}
        />
      ))}
    </div>
  );
}

/* ============================== Free Agents ================================ */

export function FreeAgentsTab({ state }) {
  const [tab, setTab] = useState("QB");
  const rostered = allRosteredPlayerIds(state);
  let list;
  if (tab === "BYE" || tab === "IR" || tab === "OUT") {
    list = state.playerPool.filter((p) => p.status === tab);
  } else {
    list = state.playerPool.filter((p) => p.position === tab && p.status === "Active" && !rostered.has(p.id));
  }
  list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div>
      <div className="pp-subnav">
        {FA_TABS.map((t) => (
          <button key={t} className={"pp-subnav-btn" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div className="pp-card">
        {list.length === 0 ? (
          <EmptyState>No {tab === "BYE" || tab === "IR" || tab === "OUT" ? "players marked " + tab : tab + " free agents"} right now.</EmptyState>
        ) : (
          list.map((p) => (
            <div key={p.id} className="pp-roster-slot">
              <SuitBadge position={p.position} />
              <div style={{ flex: 1 }}>
                <div className="pp-roster-slot-name">{p.name}</div>
                <div className="pp-roster-slot-meta">{p.position} - {p.team}</div>
              </div>
              {p.status !== "Active" ? <Tag>{p.status}</Tag> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* =============================== Live Stats ================================= */

