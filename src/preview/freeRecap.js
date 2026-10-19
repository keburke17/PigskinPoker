/* The preview's recaps: this demo league's weeks run through the REAL recap writer in
 * src/recap/, exactly as the server runs it at finalize - one deck carried from week to
 * week the way `seasons.recap_deck` carries it. */

import { makeDeck, schemeMoves, writeWeekRecaps } from "../recap/index.js";

const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");

/** Every team's recap for every recap week, best finish first. */
export function freeRecapsByWeek(league, weeks, deck = makeDeck("preview")) {
  const out = {};
  weeks.slice().sort((a, b) => a - b).forEach((w) => {
    const { beforeSchemes, scored } = league.weeks[w];
    const { recaps } = writeWeekRecaps({ before: scored, after: league.state, moves: schemeMoves(beforeSchemes, scored), deck });
    out[w] = Object.values(recaps)
      .sort((a, b) => a.place - b.place)
      .map((r) => ({ ...r, id: "free-" + w + "-" + r.team, label: ordinal(r.place) + " - " + r.team }));
  });
  return out;
}
