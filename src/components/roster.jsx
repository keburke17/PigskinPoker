/* Pigskin Poker UI - one roster slot, and one team's roster.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 993-1045. Changed twice since:
 * TeamRosterBlock now ends the starters with the team's total (issue #29), and what
 * counts as LOCKED is the league's lineup-lock policy as well as the commissioner's own
 * lock (src/engine/lineupLock.js).
 */

import {
  ICON,
  computeStarterPoints,
  formatKickoffDay,
  getPlayer,
  isPlayerLocked,
  playerKickoff,
  teamPeriodScore,
} from "../engine/index.js";
import { EmptyState, PositionCard, statLineText } from "./atoms.jsx";

const DOT = " " + ICON.dot + " ";

/* The second line of a roster row: who he plays for, and when he plays.
 *
 * The position leads it ONLY when the slot is not already saying it - a FLEX or a bench
 * place. Shared with the commissioner's stat-entry row, which shows the same player above
 * a row of number inputs and should not describe him differently.
 */
export function slotMetaLine(state, slot, player) {
  if (!player) return "";
  const parts = [];
  if (player.position !== slot) parts.push(player.position);
  parts.push(player.team);
  const kickoff = formatKickoffDay(playerKickoff(state, player));
  if (kickoff) parts.push(kickoff);
  return parts.join(DOT);
}

/* ONE PLAYER, THREE LINES (issue #33, and Scott's screenshot of 2026-09-07).
 *
 * The row used to be one line of text with everything hung off it after pipe
 * characters - position, NFL team, status, and the whole stat line - beside a small grey
 * slot label and a suit badge that between them said "QB" twice. Three changes, all
 * presentation:
 *
 *   1. The label and the badge are ONE playing card now, and it is the loud thing on the
 *      left (see PositionCard). The position is not repeated beside the NFL team, which
 *      is what Scott circled - EXCEPT on FLEX and the bench, where the slot and the
 *      position are genuinely different facts and dropping one would lose information.
 *   2. The kickoff goes where the repetition was: this player's own game, day and time,
 *      in the reader's timezone. It is the schedule the lineup lock already reads
 *      (`periods.kickoffs`), so the row cannot name a time the lock disagrees with, and
 *      it says nothing at all for a bye week or a week whose times have not been read.
 *   3. Status comes out of the middle of the sentence and onto the name line as a pill,
 *      beside LOCKED, where an OUT is meant to be noticed.
 *
 * The stat line then gets a line of its own instead of trailing off the end of the meta,
 * and the points stay hard right in a column that lines up down the whole card.
 */
export function RosterSlotRow({ slot, player, state, statLine, locked, showStats }) {
  const pts = showStats ? computeStarterPoints(state, statLine, player ? player.position : slot) : null;
  const meta = slotMetaLine(state, slot, player);
  return (
    <div className="pp-roster-slot">
      <PositionCard slot={slot} position={player ? player.position : null} />
      <div className="pp-roster-slot-body">
        <div className="pp-roster-slot-top">
          <span className="pp-roster-slot-name">{player ? player.name : "empty slot"}</span>
          {player && player.status !== "Active" ? <span className="pp-status-pill">{player.status}</span> : null}
          {locked ? <span className="pp-locked-pill">LOCKED</span> : null}
          {showStats ? <span className="pp-roster-slot-pts">{pts} pt{pts === 1 ? "" : "s"}</span> : null}
        </div>
        {meta ? <div className="pp-roster-slot-meta">{meta}</div> : null}
        {showStats && player ? <div className="pp-roster-slot-stats">{statLineText(state, player, statLine)}</div> : null}
      </div>
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

