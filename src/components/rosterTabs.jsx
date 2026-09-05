/* Pigskin Poker UI - extracted from
 * LegacyProject/PigskinPokerCode.jsx lines 1474-1528.
 *
 * Was verbatim, module boundaries aside, until 2026-09-04: FreeAgentsTab now hides
 * players a pool refresh retired. The artifact had no feed, so it had no such player,
 * and its OUT tab could safely show everyone. See the comment on that filter.
 */

import { useState } from "react";
import { FA_TABS, allRosteredPlayerIds } from "../engine/index.js";
import { EmptyState, SuitBadge, Tag } from "./atoms.jsx";
import { TeamRosterBlock } from "./roster.jsx";

export function AllRostersTab({ state }) {
  if (state.teams.length === 0) return <EmptyState>No teams yet.</EmptyState>;
  return (
    <div>
      {state.teams.map((team) => (
        <div key={team.id} className="pp-card">
          <h3 className="pp-h3">{team.name}</h3>
          <TeamRosterBlock team={team} state={state} showStats={state.currentPeriod.phase !== "pre-deal"} showBench={true} />
        </div>
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

