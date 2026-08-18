/* Pigskin Poker - roster dealing.
 * Moved from PigskinPokerCode.jsx lines 476-549. Behaviour is unchanged; the only
 * edit is the `rng` parameter replacing the internal Math.random calls (lines 534-535)
 * and the shuffles.
 */

import { defaultRng } from "./rng.js";
import { shuffle } from "./helpers.js";

export function dealRosters(state, teamIds, rng = defaultRng) {
  const pool = state.playerPool;
  const activeByPos = {
    Coach: pool.filter((p) => p.position === "Coach" && p.status === "Active"),
    QB: pool.filter((p) => p.position === "QB" && p.status === "Active"),
    WR: pool.filter((p) => p.position === "WR" && p.status === "Active"),
    RB: pool.filter((p) => p.position === "RB" && p.status === "Active"),
    TE: pool.filter((p) => p.position === "TE" && p.status === "Active"),
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
        "Not enough Active Coaches (" +
        available.Coach.length +
        ") to deal " +
        teamIds.length +
        " team(s). Add more Coaches to the player pool or mark fewer as OUT/IR/BYE.",
    };
  }
  if (available.QB.length < need.QB) {
    return {
      error:
        "Not enough Active QBs (" +
        available.QB.length +
        ") to deal " +
        teamIds.length +
        " team(s). Add more QBs to the player pool.",
    };
  }
  if (available.TE.length < need.TE) {
    return {
      error:
        "Not enough Active TEs (" +
        available.TE.length +
        ") to deal " +
        teamIds.length +
        " team(s). Add more TEs to the player pool.",
    };
  }
  if (available.WR.length < minWR) {
    return {
      error:
        "Not enough Active WRs (" +
        available.WR.length +
        ") to deal " +
        teamIds.length +
        " team(s).",
    };
  }
  if (available.RB.length < minRB) {
    return {
      error:
        "Not enough Active RBs (" +
        available.RB.length +
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
          "Ran out of Active players while dealing rosters (pool exhausted partway " +
          "through). Add more players at the affected position(s) or reduce the number " +
          "of teams.",
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
