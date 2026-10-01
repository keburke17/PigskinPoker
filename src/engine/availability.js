/* Who can reach a roster this week.
 *
 * SCOTT'S RULING, 2026-09-08 (OQ-25): "the deal should skip a player who has no game
 * scheduled. they cannot be redrawn, stolen, or dealt to teams at all. once they have a
 * game scheduled they will resume being placed in the deal."
 *
 * Before this, a player whose NFL team was on a bye was dealt exactly like everyone else
 * and scored a guaranteed nothing. The BYE status existed and the engine honoured it -
 * dealing has always taken only `Active` players - but NOTHING EVER SET IT except a
 * commissioner working down the pool screen by hand on a Tuesday. So in practice six
 * teams' worth of dead cards went into the deal every week of the bye season.
 *
 * DERIVED, NOT STORED, AND THAT IS THE WHOLE DESIGN. The alternative was to write BYE onto
 * forty players' status rows each Tuesday and clear it again the week after. This asks the
 * schedule instead, every time it is asked, which is what makes the second half of Scott's
 * sentence free: a player is back in the deal the moment his team has a game again, with
 * nothing to remember to undo. It also leaves the BYE status alone as what it always was -
 * a commissioner's manual override - so a hand-set status is never stamped on by a robot.
 *
 * TWO WAYS TO KNOW NOTHING, AND NEITHER OF THEM EXCLUDES ANYBODY:
 *
 *   1. THE WEEK'S SCHEDULE HAS NOT BEEN READ. Every player looks exactly like a player on
 *      a bye, and filtering on that would deal nobody at all. `weekScheduleKnown` is the
 *      guard, and it is the same rule the lineup lock follows: a deal that silently
 *      refuses forty players because a CSV was slow is far worse than the problem.
 *   2. THE PLAYER IS ON A TEAM THE SCHEDULE CANNOT SPEAK ABOUT. A commissioner can type
 *      any team he likes when he adds a rookie by hand, and a typo would otherwise remove
 *      that player from every deal forever with nothing on screen saying why. If the team
 *      is not one of the 32, we do not know that he has no game - so he plays.
 *
 * Pure, like everything else here: it reads the kickoffs already on `state._meta` and
 * touches no clock and no network.
 */

import { gameFor, kickoffsFor, weekScheduleKnown } from "./lineupLock.js";
import { NFL_TEAM_ABBR } from "./nflTeams.js";

/**
 * Is this player's NFL team sitting out this week?
 *
 * True ONLY when we positively know it: the week's schedule has been read, his team is one
 * we can look up, and it has no game in it. Every other case is false, because "we cannot
 * tell" and "he is on a bye" are different answers and only one of them takes a card off a
 * manager.
 */
export function isOnByeThisWeek(state, player) {
  if (!player || !player.team) return false;
  if (!weekScheduleKnown(state)) return false;
  if (!NFL_TEAM_ABBR[player.team]) return false;
  return gameFor(kickoffsFor(state), player.team) == null;
}

/**
 * May this player be dealt, stolen or redrawn into a roster this week?
 *
 * The one question the deal and both schemes ask, so they cannot drift: a commissioner's
 * status still decides first - OUT, IR and a hand-set BYE all keep a player out, exactly as
 * they always have - and the schedule decides second.
 */
export function isPlayerAvailable(state, player) {
  if (!player) return false;
  if (player.status !== "Active") return false;
  return !isOnByeThisWeek(state, player);
}

/**
 * How many of a position are sitting out - for the message a commissioner reads when a
 * deal cannot be filled.
 *
 * "Not enough Active QBs (26)" in front of a pool showing 32 active quarterbacks is the
 * kind of number that costs somebody an evening. Naming the byes turns it into a sentence
 * that explains itself.
 */
export function byeCountAt(state, position) {
  return (state.playerPool || []).filter(
    (p) => p.position === position && p.status === "Active" && !p.retired && isOnByeThisWeek(state, p)
  ).length;
}
