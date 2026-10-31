/* Moving players around a lineup by tapping their cards (Scott, 2026-10-30, OQ-34).
 *
 * The lineup used to change one way: a dropdown under each starter swapped him for a
 * bench player who fit. Scott asked for the ESPN-style card instead - tap a card, every
 * place that player can go lights up HERE, tap one - and for two moves the dropdown
 * could not make:
 *
 *   starter <-> starter   A WR in the FLEX trades places with the WR, an RB with the RB,
 *                         a TE with the TE. Only ever two players of the SAME position,
 *                         because each has to fit the other's slot - so the same six
 *                         players start, the score cannot move, and a steal (which looks
 *                         at every starter of a position, FLEX included) cannot either.
 *
 *   TE -> FLEX, three-way The starting TE into a FLEX held by a WR or RB. That WR or RB
 *                         cannot play TE, so the bench TE comes in at TE and the FLEX
 *                         player goes to the bench. Offered only when exactly ONE bench
 *                         player fits the vacated slot, so the app never picks between
 *                         two of your players for you. With the deal's two-TE cap that
 *                         always holds for the TE; for an RB or WR it usually does not,
 *                         and the move is two taps through the bench as before.
 *
 * Pure. Lock state comes in as a predicate so the browser and the server ask the same
 * question with their own clock.
 */

import { STARTER_SLOTS } from "./constants.js";
import { slotAcceptsPosition } from "./state.js";

/* A place on the roster: { area: "starter", slot } or { area: "bench", index }. */
const idAt = (roster, at) => (at.area === "starter" ? roster.starters[at.slot] : roster.bench[at.index]);

/**
 * Every place the player at `from` can be moved to, with what the move needs.
 *
 * Each target is `{ area, slot | index, playerId, locked, fill }`. `locked` marks a
 * target whose occupant cannot move - shown, so a manager sees why, but not tappable.
 * `fill` is the bench index that comes in behind a three-way move, or null.
 *
 * @param {object} roster    { starters, bench }
 * @param {object} from      the place tapped
 * @param {function} positionOf  playerId -> position, or null for an empty place
 * @param {function} isLocked    playerId -> boolean
 */
export function lineupMoveTargets(roster, from, positionOf, isLocked) {
  if (!roster || !from) return [];
  const movingId = idAt(roster, from);
  const moving = movingId ? positionOf(movingId) : null;
  if (!moving) return [];
  const out = [];
  const lockedId = (id) => !!id && !!isLocked(id);

  if (from.area === "bench") {
    STARTER_SLOTS.forEach((slot) => {
      if (!slotAcceptsPosition(slot, moving)) return;
      const id = roster.starters[slot];
      out.push({ area: "starter", slot, playerId: id || null, locked: lockedId(id), fill: null });
    });
    return out;
  }

  STARTER_SLOTS.forEach((slot) => {
    if (slot === from.slot || !slotAcceptsPosition(slot, moving)) return;
    const id = roster.starters[slot];
    const pos = id ? positionOf(id) : null;
    if (!pos || slotAcceptsPosition(from.slot, pos)) {
      out.push({ area: "starter", slot, playerId: id || null, locked: lockedId(id), fill: null });
      return;
    }
    const fills = [];
    roster.bench.forEach((b, i) => {
      if (b && !lockedId(b) && slotAcceptsPosition(from.slot, positionOf(b))) fills.push(i);
    });
    if (fills.length === 1) {
      out.push({ area: "starter", slot, playerId: id, locked: lockedId(id), fill: fills[0] });
    }
  });
  roster.bench.forEach((id, index) => {
    if (!id || !slotAcceptsPosition(from.slot, positionOf(id))) return;
    out.push({ area: "bench", index, playerId: id, locked: lockedId(id), fill: null });
  });
  return out;
}

/**
 * The roster after moving the starter in `fromSlot` into `toSlot`.
 *
 * With `fillIndex` null the two starters trade places. With a bench index, the bench
 * player takes `fromSlot` and whoever held `toSlot` goes to that bench place. No
 * checking here - the server checks, and the browser only offers legal targets.
 */
export function moveStarter(roster, fromSlot, toSlot, fillIndex = null) {
  const starters = { ...roster.starters };
  const bench = roster.bench.slice();
  const moving = starters[fromSlot];
  const displaced = starters[toSlot];
  starters[toSlot] = moving;
  if (fillIndex == null) {
    starters[fromSlot] = displaced;
  } else {
    starters[fromSlot] = bench[fillIndex];
    bench[fillIndex] = displaced;
  }
  return { ...roster, starters, bench };
}

/** The exact inverse of moveStarter with the same arguments - how a refused move is undone. */
export function unmoveStarter(roster, fromSlot, toSlot, fillIndex = null) {
  const starters = { ...roster.starters };
  const bench = roster.bench.slice();
  const moved = starters[toSlot];
  if (fillIndex == null) {
    starters[toSlot] = starters[fromSlot];
  } else {
    starters[toSlot] = bench[fillIndex];
    bench[fillIndex] = starters[fromSlot];
  }
  starters[fromSlot] = moved;
  return { ...roster, starters, bench };
}
