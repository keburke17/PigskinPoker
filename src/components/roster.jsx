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
  coachRecord,
  computeStarterPoints,
  formatKickoffDay,
  getPlayer,
  isPlayerLocked,
  playerGame,
  playerSeasonAverage,
  playerWeekLine,
  recordText,
  shortPlayerName,
  teamPeriodScore,
  weekScheduleKnown,
} from "../engine/index.js";
import { EmptyState, PositionCard, statLineText } from "./atoms.jsx";
import { useInjuryNotes } from "./injury.jsx";

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
 * The position used to lead it on FLEX and bench rows. Since 2026-10-19 the position and
 * the team have a line of their own above this one (PlayerIdLine), so this line is the
 * game and nothing else. Shared with the commissioner's stat-entry row and the free agent
 * list, which show the same player and should not describe him differently.
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

/* WHO HE PLAYS FOR, AND WHAT HE PLAYS - "DET | QB" (Scott, 2026-10-19, option A4b).
 *
 * The team used to be a small gold chip on the name line, and the position was only on
 * the card. Scott's point was that a manager reads the NAME first and then hunts for the
 * position and the team, and on a bench row the card says BN with the real position in
 * small print. So both get a line of their own straight under the name: the team bold,
 * then the position in a light tint of its card's ink, so the colour matches the card
 * while still reading on the felt. He looked at it both ways round and picked team first.
 *
 * A coach is written HC: "Coach" beside a coach's own name read oddly in the mockups.
 *
 * A COACH'S LINE ENDS IN HIS TEAM'S RECORD - DET | HC | 5-1 (Scott, 2026-10-22, option C).
 * An average of 1.1 on a coach meant nothing, so he has none; the record is what a
 * manager actually wants to know about him, and it reads like a team's line in the paper. */
export function PlayerIdLine({ player, state }) {
  if (!player) return null;
  const record = state ? coachRecord(state, player) : null;
  return (
    <div className="pp-id-line">
      {player.team ? <span className="pp-id-team">{abbrFor(player.team)}</span> : null}
      {player.team ? <span className="pp-id-sep">|</span> : null}
      <span className={"pp-id-pos pp-id-" + player.position}>{player.position === "Coach" ? "HC" : player.position}</span>
      {record ? <span className="pp-id-sep">|</span> : null}
      {record ? (
        <span className="pp-id-record" title="His team's record this season">
          {recordText(record)}
        </span>
      ) : null}
    </div>
  );
}

/* The name as the row shows it - J. Goff - with the full name kept for a long press or a
 * hover, since an initial is the one thing on the row that throws information away. */
export function PlayerName({ player }) {
  return (
    <span className="pp-roster-slot-name" title={player ? player.name : undefined}>
      {player ? shortPlayerName(player.name) : "empty slot"}
    </span>
  );
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
export function RosterSlotRow({ slot, player, state, statLine, locked, showStats, bench }) {
  /* A BENCH ROW (OQ-28, Scott 2026-10-16) scores the feed's line for him this week, with
   * the same function a starter is scored with - so the grey number is exactly what he
   * would have put up in the lineup. It is greyed and italic because it does not count:
   * teamPeriodScore walks the six starting slots and never this row. Nothing until a
   * stats pull has a line for him, which is also what a starter's row does. */
  const benchLine = bench && showStats ? playerWeekLine(state, player) : null;
  const line = bench ? benchLine : statLine;
  const withStats = bench ? !!benchLine : showStats;
  const pts = withStats ? computeStarterPoints(state, line, player ? player.position : slot) : null;
  const meta = slotMetaLine(state, slot, player);
  const average = playerSeasonAverage(state, player);
  /* OQ-29: the injury pill and notepad ride on the name line, and the report opens under
   * the opponent and kickoff - so a healthy player's row is exactly what it was. */
  const injury = useInjuryNotes(state, player);
  return (
    <div className="pp-roster-slot">
      <PositionCard slot={slot} position={player ? player.position : null} />
      <div className="pp-roster-slot-body">
        <div className="pp-roster-slot-top">
          {/* The name line is the name, the injury pill and an OUT / IR status - nothing
              else. The team chip moved down to PlayerIdLine and LOCKED moved under the
              points (2026-10-19), which is what gives a long name its room back. */}
          <span className="pp-roster-slot-who">
            <PlayerName player={player} />
            {injury.tag}
          </span>
          {player && player.status !== "Active" ? <span className="pp-status-pill">{player.status}</span> : null}
        </div>
        <PlayerIdLine player={player} state={state} />
        {meta ? <div className="pp-roster-slot-meta">{meta}</div> : null}
        {withStats && player ? <div className="pp-roster-slot-stats">{statLineText(state, player, line)}</div> : null}
        {injury.report}
      </div>
      <PointsColumn pts={pts} average={average} notCounting={bench} locked={locked} />
    </div>
  );
}

/* THE POINTS COLUMN - option A of four, Scott's pick on 2026-10-16 (OQ-28). This week's
 * points on top, the season average under them, hard right so both line up down the card.
 *
 * The average is there BEFORE a ball is thrown, deliberately: Tuesday's deal and
 * Wednesday's scheme are when "sit or start" gets decided, and that is when there are no
 * points yet to sit beside it. Nothing at all is drawn for a player with neither, so an
 * empty slot stays the shape it was.
 *
 * BIGGER, AND LOCKED UNDER IT (Scott, 2026-10-19, roster-row mockups). The points are the
 * loud number on the right now, one decimal like the average, with no "pts" after them;
 * before a ball is thrown a dash holds their place so the average does not jump up the
 * row. LOCKED left the name line, where it was competing with the name for room. */
export function PointsColumn({ pts, average, notCounting, locked }) {
  if (pts == null && !average && !locked) return null;
  return (
    <div className="pp-roster-slot-right">
      <span
        className={"pp-roster-slot-pts" + (notCounting || pts == null ? " pp-pts-not-counting" : "")}
        title={notCounting ? "Not in the lineup - does not count toward the team's score" : undefined}
      >
        {pts != null ? Number(pts).toFixed(1) : "-"}
      </span>
      {average ? (
        <span className="pp-roster-slot-avg" title={"Season average over " + average.games + " game" + (average.games === 1 ? "" : "s") + " played"}>
          {/* Always one decimal, so "avg 19.0" and "avg 13.6" line up down the column. */}
          avg {average.avg.toFixed(1)}
        </span>
      ) : null}
      {locked ? <span className="pp-locked-pill">LOCKED</span> : null}
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
          {/* "Does not count" is said once, here, rather than on every grey number. */}
          <div className="pp-eyebrow" style={{ margin: "10px 0 6px" }}>Bench {ICON.dot} does not count</div>
          {team.roster.bench.map((pid, i) => {
            const player = getPlayer(state, pid);
            return (
              <RosterSlotRow key={i} slot="BN" player={player} state={state} statLine={null} locked={locked(pid)} showStats={showStats} bench />
            );
          })}
        </>
      ) : null}
    </div>
  );
}

/* ================================ Login ================================ */

