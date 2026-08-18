/* Pigskin Poker - player pool generation.
 * Moved verbatim from PigskinPokerCode.jsx lines 277-297.
 */

import { TEAM_ROWS } from "../data/teamRows.js";

export function generatePlayerPool() {
  const pool = [];
  let counter = 1;
  const push = (name, position, team) => {
    pool.push({
      id: "p" + counter++,
      name,
      position, // 'Coach' | 'QB' | 'RB' | 'WR' | 'TE'
      team,
      status: "Active", // Active | OUT | IR | BYE
    });
  };
  TEAM_ROWS.forEach(([team, coach, qb, rbs, wrs, tes]) => {
    push(coach, "Coach", team);
    push(qb, "QB", team);
    rbs.forEach((n) => push(n, "RB", team));
    wrs.forEach((n) => push(n, "WR", team));
    tes.forEach((n) => push(n, "TE", team));
  });
  return pool;
}
