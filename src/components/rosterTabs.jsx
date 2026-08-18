/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1474-1528.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
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

