/* Pigskin Poker UI - one roster slot, and one team's roster.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 993-1045. Changed twice since:
 * TeamRosterBlock now ends the starters with the team's total (issue #29), and what
 * counts as LOCKED is the league's lineup-lock policy as well as the commissioner's own
 * lock (src/engine/lineupLock.js).
 */

import {
  ICON,
  abbrFor,
  computeStarterPoints,
  formatKickoffDay,
  getPlayer,
  isPlayerLocked,
  playerGame,
  teamPeriodScore,
  weekScheduleKnown,
} from "../engine/index.js";
import { EmptyState, PositionCard, statLineText } from "./atoms.jsx";

const DOT = " " + ICON.dot + " ";

/* The second line of a roster row: WHO HE IS PLAYING, and when.
 *
 * SCOTT'S CALL, 2026-09-08, from four mockups - this is option B. It used to spell his
 * NFL team out in full and stop there ("Philadelphia Eagles - Sun 9/14 8:20 PM"), which
 * spent most of a phone's width on the one fact you already knew from the name above it,
 * and never said the thing a manager actually wants before choosing a block: who the man
 * is up against. So the team moved up to the name line as an abbreviation (see the chip in
 * RosterSlotRow) and the opponent took its place down here.
 *
 * THE MATCHUP LEADS THE LINE, which is the whole of what made B different from the other
 * three: every row starts with the same kind of fact, so the matchups line up down the
 * left edge of the card and can be read in one pass instead of hunted for at the end of
 * six sentences of different lengths.
 *
 * `vs` OR `at` IS REAL INFORMATION AND IT IS FREE. The schedule names both teams in a
 * game, so knowing the opponent is knowing whether he is home - and a road game at 8:20pm
 * is a different proposition from the same time at home.
 *
 * The position leads it ONLY when the slot is not already saying it - a FLEX or a bench
 * place. Shared with the commissioner's stat-entry row, which shows the same player above
 * a row of number inputs and should not describe him differently.
 *
 * Returns NODES, not a string, because the preposition is set apart from the opponent in
 * gold - the row is read at a glance and `at` in the same weight as `DAL` reads as part of
 * the team's name.
 */
export function slotMetaLine(state, slot, player) {
  if (!player) return null;
  const game = playerGame(state, player);
  const when = formatKickoffDay(game ? game.at : null);
  const parts = [];

  if (player.position !== slot) parts.push(player.position);
  if (game && game.opp) {
    parts.push(
      <>
        {game.home === false ? <span className="pp-vs">at</span> : <span className="pp-vs">vs</span>}{" "}
        {game.opp}
      </>
    );
  }
  if (when) parts.push(when);

  /* NOTHING KNOWN IS TWO DIFFERENT FACTS AND THE ROW SAYS WHICH. Once the week's times
   * are in, a player absent from them is genuinely not playing - a bye - and that is worth
   * saying out loud, because a bye man on your card scores nothing and you want to notice
   * before Sunday. Before they are in, every player looks the same way and the row keeps
   * its mouth shut rather than announcing thirty-two byes. */
  if (!parts.length) {
    return weekScheduleKnown(state) ? <span className="pp-no-game">No game this week</span> : null;
  }

  return parts.map((part, i) => (
    <span key={i}>
      {i ? DOT : ""}
      {part}
    </span>
  ));
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
          {/* NAME AND TEAM TRAVEL TOGETHER (2026-09-08). The name used to be the flexible
              element on this line, which pushed everything after it hard right - so an
              abbreviation added beside it would have drifted to the far side of the row and
              read as a column of its own rather than as part of the player. The wrapper
              takes the flexing instead, and the chip stays where a shirt number would. */}
          <span className="pp-roster-slot-who">
            <span className="pp-roster-slot-name">{player ? player.name : "empty slot"}</span>
            {player && player.team ? <span className="pp-team-chip">{abbrFor(player.team)}</span> : null}
          </span>
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

