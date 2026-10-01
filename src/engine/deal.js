/* Pigskin Poker - roster dealing.
 * Moved from PigskinPokerCode.jsx lines 476-549. The `rng` parameter replaced the
 * internal Math.random calls (lines 534-535) and the shuffles.
 *
 * ONE RULE CHANGED SINCE, and it is a real one - SCOTT'S RULING OF 2026-09-08 (OQ-25):
 * a player whose NFL team has no game this week is not dealt. He was, before; he scored a
 * guaranteed nothing, and no scheme could fix it because the free agents he might be
 * swapped for were just as likely to be sitting out too.
 *
 * WHAT THAT COSTS, so nobody rediscovers it as a bug: in the thick of the bye season the
 * dealable pool is about a sixth smaller, and it is thinnest at Coach and QB where each
 * NFL team contributes exactly one - 32 becomes 26. Every team still gets a full hand;
 * there is simply less variety in those weeks.
 *
 * The question is asked in ONE place, `isPlayerAvailable` - see src/engine/availability.js
 * for why it is derived from the schedule rather than written onto anybody's status, and
 * for the two cases where "we do not know" deliberately deals the player anyway.
 */

import { defaultRng } from "./rng.js";
import { shuffle } from "./helpers.js";
import { byeCountAt, isPlayerAvailable } from "./availability.js";

/* "(26)" in front of a pool screen showing 32 active quarterbacks is how a commissioner
 * loses an evening. When byes are the reason, the message says so. */
const shortfall = (state, position, count) => {
  const byes = byeCountAt(state, position);
  return (
    count +
    (byes ? ", with " + byes + " more on a bye this week" : "")
  );
};

export function dealRosters(state, teamIds, rng = defaultRng) {
  const pool = state.playerPool;
  const canPlay = (p, pos) => p.position === pos && isPlayerAvailable(state, p);
  const activeByPos = {
    Coach: pool.filter((p) => canPlay(p, "Coach")),
    QB: pool.filter((p) => canPlay(p, "QB")),
    WR: pool.filter((p) => canPlay(p, "WR")),
    RB: pool.filter((p) => canPlay(p, "RB")),
    TE: pool.filter((p) => canPlay(p, "TE")),
  };
  const available = {
    Coach: shuffle(activeByPos.Coach.map((p) => p.id), rng),
    QB: shuffle(activeByPos.QB.map((p) => p.id), rng),
    WR: shuffle(activeByPos.WR.map((p) => p.id), rng),
    RB: shuffle(activeByPos.RB.map((p) => p.id), rng),
    TE: shuffle(activeByPos.TE.map((p) => p.id), rng),
  };
  const need = {
    Coach: teamIds.length * 2,
    QB: teamIds.length * 2,
    TE: teamIds.length * 2,
  };
  // WR/RB need depends on random FLEX assignment (min 2 each guaranteed, up to 4 if
  // both flexes go one way)
  const minWR = teamIds.length * 2;
  const minRB = teamIds.length * 2;
  if (available.Coach.length < need.Coach) {
    return {
      error:
        "Not enough available Coaches (" +
        shortfall(state, "Coach", available.Coach.length) +
        ") to deal " +
        teamIds.length +
        " team(s). Add more Coaches to the player pool or mark fewer as OUT/IR/BYE.",
    };
  }
  if (available.QB.length < need.QB) {
    return {
      error:
        "Not enough available QBs (" +
        shortfall(state, "QB", available.QB.length) +
        ") to deal " +
        teamIds.length +
        " team(s). Add more QBs to the player pool.",
    };
  }
  if (available.TE.length < need.TE) {
    return {
      error:
        "Not enough available TEs (" +
        shortfall(state, "TE", available.TE.length) +
        ") to deal " +
        teamIds.length +
        " team(s). Add more TEs to the player pool.",
    };
  }
  if (available.WR.length < minWR) {
    return {
      error:
        "Not enough available WRs (" +
        shortfall(state, "WR", available.WR.length) +
        ") to deal " +
        teamIds.length +
        " team(s).",
    };
  }
  if (available.RB.length < minRB) {
    return {
      error:
        "Not enough available RBs (" +
        shortfall(state, "RB", available.RB.length) +
        ") to deal " +
        teamIds.length +
        " team(s).",
    };
  }

  const take = (pos) => {
    if (available[pos].length === 0) return null;
    return available[pos].pop();
  };

  const rosters = {};
  const order = shuffle(teamIds.slice(), rng);
  for (const teamId of order) {
    const starterCoach = take("Coach");
    const benchCoach = take("Coach");
    const starterQB = take("QB");
    const benchQB = take("QB");
    const starterWR = take("WR");
    const benchWR = take("WR");
    const starterRB = take("RB");
    const benchRB = take("RB");
    const starterTE = take("TE");
    const benchTE = take("TE");
    const starterFlexPos = rng() < 0.5 ? "WR" : "RB";
    const benchFlexPos = rng() < 0.5 ? "WR" : "RB";
    const starterFlex = take(starterFlexPos);
    const benchFlex = take(benchFlexPos);

    if (
      !starterCoach ||
      !benchCoach ||
      !starterQB ||
      !benchQB ||
      !starterWR ||
      !benchWR ||
      !starterRB ||
      !benchRB ||
      !starterTE ||
      !benchTE ||
      !starterFlex ||
      !benchFlex
    ) {
      return {
        error:
          "Ran out of available players while dealing rosters (pool exhausted partway " +
          "through). Add more players at the affected position(s) or reduce the number " +
          "of teams. Players whose NFL team has no game this week are not dealt.",
      };
    }

    rosters[teamId] = {
      starters: {
        Coach: starterCoach,
        QB: starterQB,
        WR: starterWR,
        RB: starterRB,
        TE: starterTE,
        FLEX: starterFlex,
      },
      bench: [benchCoach, benchQB, benchWR, benchRB, benchTE, benchFlex],
    };
  }
  return { rosters };
}
