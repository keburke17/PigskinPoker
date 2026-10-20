/* Pigskin Poker - what each scheme actually did, captured as it happens.
 *
 * The weekly recap jokes about steals, redraws and blocks: who you dropped, who you got,
 * whose roster it came from. NONE OF THAT SURVIVES to the end of the week. Scheme
 * processing rewrites roster_slots in place, so by finalize the player a steal brought in
 * is simply sitting in the slot, with nothing saying where he came from - and the schemes
 * table records what was asked for, not what it produced.
 *
 * So the server calls schemeMoves() at the moment it has both rosters - the view before
 * processing and the blob after - and stores the answer on the period
 * (`periods.scheme_moves`). Finalize reads it back when it writes the recaps.
 *
 * Pure: state in, plain data out. Every id is the view's own (legacy) id.
 * NOTHING SCORES, DEALS OR RESOLVES FROM THIS. It is a record for the recap only.
 */

import { slotForPlayer } from "../engine/index.js";

function ownerOf(state, playerId) {
  if (!playerId) return null;
  for (const t of state.teams) {
    if (!t.roster) continue;
    if (Object.values(t.roster.starters).includes(playerId)) return t.id;
  }
  return null;
}

/**
 * One entry per team that ran a block, steal or redraw this period.
 *
 * @param before the league state as schemes were about to be processed
 * @param after  the state processSchemes returned
 * @returns {Array<{teamId, type, position, playerId, gotId?, fromTeamId?, skipped?, attempts?}>}
 *   `playerId` is the player named on the scheme (blocked, or dropped). For a steal or a
 *   redraw `gotId` is who ended up in his slot, `skipped` says nothing changed, and a
 *   steal's `fromTeamId` is whose starter it took. A block's `attempts` counts the other
 *   teams that tried to steal at that position.
 */
export function schemeMoves(before, after) {
  const schemes = (before && before.schemes) || {};
  const moves = [];
  Object.entries(schemes).forEach(([teamId, sc]) => {
    if (!sc || !sc.playerId || !["block", "steal", "redraw"].includes(sc.type)) return;
    const move = { teamId, type: sc.type, position: sc.position, playerId: sc.playerId };
    if (sc.type === "block") {
      move.attempts = Object.entries(schemes).filter(([id, o]) => id !== teamId && o && o.type === "steal" && o.position === sc.position).length;
    } else {
      const was = before.teams.find((t) => t.id === teamId);
      const now = after.teams.find((t) => t.id === teamId);
      const loc = was ? slotForPlayer(was, sc.playerId) : null;
      if (!loc || !now || !now.roster) return;
      const gotId = loc.area === "starters" ? now.roster.starters[loc.slot] : now.roster.bench[loc.index];
      move.gotId = gotId || null;
      move.skipped = gotId === sc.playerId;
      if (sc.type === "steal" && !move.skipped) move.fromTeamId = ownerOf(before, gotId);
    }
    moves.push(move);
  });
  return moves;
}
