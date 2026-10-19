/* Pigskin Poker - the weekly recap. Issue: Scott's request of 2026-10-19, recorded as OQ-31.
 *
 * After a week is finalized every manager gets a short, funny write-up of how it went -
 * the finish, the standings move, the steal that backfired, the bench that outscored the
 * lineup - shown once when they next open the app and kept on My Team after that.
 *
 *   moves.js  - what the schemes did, captured when they ran (the only moment it is known)
 *   facts.js  - one team's finished week as plain facts
 *   write.js  - facts into words, from lines.js, never repeating a line in a season
 *   lines.js  - every line it can say. Adding lines is safe and is the whole upkeep.
 *
 * Pure, like src/engine/: the server runs it at finalize and stores the result
 * (server/operations.js, `weekly_recaps`), so every manager reads the same words and a
 * recap never changes once written. NOTHING IN THE GAME READS A RECAP. It decides nothing.
 */

import { isTable } from "../engine/index.js";
import { gatherFacts } from "./facts.js";
import { makeDeck, writeRecap } from "./write.js";

export { schemeMoves } from "./moves.js";
export { gatherFacts } from "./facts.js";
export { makeDeck, writeRecap } from "./write.js";

/** Whether this finalize gets recaps: regular-season weeks of a season, not playoff
 * rounds (they would need their own words - "eliminated") and not a table's hands. */
export function recapsApply(state) {
  return !!state && !isTable(state) && state.currentPeriod && state.currentPeriod.type === "week";
}

/**
 * Every team's recap for the week being finalized.
 *
 * @param before    the league as finalize found it
 * @param after     what finalize produced
 * @param moves     schemeMoves() recorded when this week's schemes ran, or null if they
 *                  were not recorded (a week processed before recaps existed)
 * @param deckSeed  stable per season - the season id
 * @param deckSaved the deck as last week left it
 * @param deck      optional: a deck already made - the season check passes one it can count
 * @returns {{ recaps: Object<teamId, recap>, deck: object }}
 */
export function writeWeekRecaps({ before, after, moves, deckSeed, deckSaved, deck: given }) {
  const deck = given || makeDeck(deckSeed, deckSaved);
  const recaps = {};
  /* Best finish first, so the week's winner is never the one left with a fallback. */
  before.teams
    .map((t) => gatherFacts(before, after, Array.isArray(moves) ? moves : null, t.id))
    .filter(Boolean)
    .sort((a, b) => a.place - b.place)
    .forEach((fx) => {
      recaps[fx.teamId] = writeRecap(fx, deck);
    });
  return { recaps, deck: deck.save() };
}
