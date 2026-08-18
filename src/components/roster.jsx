/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 993-1045.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { computeStarterPoints, getPlayer } from "../engine/index.js";
import { EmptyState, SuitBadge, statLineText } from "./atoms.jsx";

export function RosterSlotRow({ slot, player, state, statLine, locked, showStats }) {
  const pts = showStats ? computeStarterPoints(state, statLine, player ? player.position : slot) : null;
  return (
    <div className="pp-roster-slot">
      <span className="pp-roster-slot-label">{slot}</span>
      {player ? <SuitBadge position={player.position} /> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="pp-roster-slot-name">{player ? player.name : "empty slot"}</div>
        <div className="pp-roster-slot-meta">
          {player ? player.position + " - " + player.team : ""}
          {player && player.status !== "Active" ? " | " + player.status : ""}
          {showStats && player ? " | " + statLineText(state, player, statLine) : ""}
        </div>
      </div>
      {locked ? <span className="pp-locked-pill">LOCKED</span> : null}
      {showStats ? <span className="pp-roster-slot-pts">{pts} pt{pts === 1 ? "" : "s"}</span> : null}
    </div>
  );
}

export function TeamRosterBlock({ team, state, showStats, showBench }) {
  const stats = (state.statsEntry && state.statsEntry[team.id]) || {};
  const locks = state.lockedPlayerIds || {};
  if (!team.roster) return <EmptyState>No roster dealt yet this period.</EmptyState>;
  return (
    <div>
      {["Coach", "QB", "WR", "RB", "TE", "FLEX"].map((slot) => {
        const pid = team.roster.starters[slot];
        const player = getPlayer(state, pid);
        return (
          <RosterSlotRow
            key={slot} slot={slot} player={player} state={state}
            statLine={stats[slot]} locked={pid && locks[pid]} showStats={showStats}
          />
        );
      })}
      {showBench ? (
        <>
          <div className="pp-eyebrow" style={{ margin: "10px 0 6px" }}>Bench</div>
          {team.roster.bench.map((pid, i) => {
            const player = getPlayer(state, pid);
            return (
              <RosterSlotRow key={i} slot="BN" player={player} state={state} statLine={null} locked={pid && locks[pid]} showStats={false} />
            );
          })}
        </>
      ) : null}
    </div>
  );
}

/* ================================ Login ================================ */

