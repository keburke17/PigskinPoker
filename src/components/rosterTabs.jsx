/* Pigskin Poker UI - the Rosters hub's two panels.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 1474-1528. Neither panel is
 * verbatim any more:
 *   AllRostersTab was rebuilt for issues #29 and #30 - see the note on it.
 *   FreeAgentsTab hides players a pool refresh retired (2026-09-04). The artifact had
 *     no feed, so it had no such player, and its OUT tab could safely show everyone.
 *     See the comment on that filter. */

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
  /* RETIRED PLAYERS ARE NOT SHOWN HERE AT ALL - added 2026-09-04, and the reason this
   * screen is no longer verbatim from the artifact.
   *
   * A player the refresh dropped used to land under the OUT tab, because retiring him
   * set his status to OUT and this tab lists every player with that status. So the
   * misspelling the feed had just replaced went on show to every manager in the league:
   * "James Cook" sitting under OUT while "James Cook III" started for somebody. OUT, IR
   * and BYE are football statements about a player who is still in the pool, and they
   * belong here. A retired player is not in the pool, and belongs only to the
   * commissioner's Player Pool screen. */
  const pool = state.playerPool.filter((p) => !p.retired);
  let list;
  if (tab === "BYE" || tab === "IR" || tab === "OUT") {
    list = pool.filter((p) => p.status === tab);
  } else {
    list = pool.filter((p) => p.position === tab && p.status === "Active" && !rostered.has(p.id));
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

