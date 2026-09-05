/* Pigskin Poker UI - one roster slot, and one team's roster.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 993-1045. Changed twice since:
 * TeamRosterBlock now ends the starters with the team's total (issue #29), and what
 * counts as LOCKED is the league's lineup-lock policy as well as the commissioner's own
 * lock (src/engine/lineupLock.js).
 */

import { computeStarterPoints, getPlayer, isPlayerLocked, teamPeriodScore } from "../engine/index.js";
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

/* `showTotal` defaults to `showStats`, because the six numbers and the number they add
 * up to belong on screen together. Before this the card stopped after the FLEX row and
 * the only place in the whole app a team total appeared was the commissioner's stat-entry
 * screen - so to find out your own team was on 59 you had to leave the tab that was
 * showing you the six numbers (issue #29).
 *
 * The sum comes from the engine's teamPeriodScore rather than being added up here: it is
 * the same walk over the same six slots that finalize does, so the card cannot show a
 * total the week will not award. */
export function TeamRosterBlock({ team, state, showStats, showBench, showTotal }) {
  const stats = (state.statsEntry && state.statsEntry[team.id]) || {};
  /* Locked means "cannot be moved now", which is the commissioner's manual lock OR the
   * league's lineup-lock policy having caught up with the clock - one question, asked
   * in one place. See src/engine/lineupLock.js. */
  const locked = (pid) => !!pid && isPlayerLocked(state, pid);
  if (!team.roster) return <EmptyState>No roster dealt yet this period.</EmptyState>;
  return (
    <div>
      {["Coach", "QB", "WR", "RB", "TE", "FLEX"].map((slot) => {
        const pid = team.roster.starters[slot];
        const player = getPlayer(state, pid);
        return (
          <RosterSlotRow
            key={slot} slot={slot} player={player} state={state}
            statLine={stats[slot]} locked={locked(pid)} showStats={showStats}
          />
        );
      })}
      {(showTotal == null ? showStats : showTotal) ? (
        <div className="pp-roster-total">
          <span>Team total</span>
          <span className="pp-roster-total-pts">{teamPeriodScore(state, team)}</span>
        </div>
      ) : null}
      {showBench ? (
        <>
          <div className="pp-eyebrow" style={{ margin: "10px 0 6px" }}>Bench</div>
          {team.roster.bench.map((pid, i) => {
            const player = getPlayer(state, pid);
            return (
              <RosterSlotRow key={i} slot="BN" player={player} state={state} statLine={null} locked={locked(pid)} showStats={false} />
            );
          })}
        </>
      ) : null}
    </div>
  );
}

/* ================================ Login ================================ */

