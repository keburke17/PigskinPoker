/* Pigskin Poker - playoff bracket start.
 * Moved from PigskinPokerCode.jsx lines 836-857, with `rng` threaded through uid().
 */

import { defaultRng } from "./rng.js";
import { deepClone, emptyCumulative, nowStamp, periodLabel, uid } from "./helpers.js";
import { rankTeamsWithTiebreak, seasonStandingsRows } from "./standings.js";

export function startPlayoffs(state, bracketSize, advancement, rng = defaultRng) {
  const next = deepClone(state);
  const ranked = rankTeamsWithTiebreak(
    seasonStandingsRows(next).map((r) => ({ teamId: r.teamId, rawScore: r.rawScore, tb: r.tb }))
  );
  const orderedIds = ranked
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((r) => r.teamId);
  const bracketTeams = orderedIds.slice(0, bracketSize);
  next.teams.forEach((t) => {
    t.playoffCumulative = emptyCumulative();
  });
  next.playoffConfig = {
    bracketSize,
    advancement,
    started: true,
    completed: false,
    currentRoundIndex: 0,
    activeTeamIds: bracketTeams,
    champion: null,
  };
  next.currentPeriod = { type: "playoff", number: 1, phase: "pre-deal" };
  next.schemes = {};
  next.statsEntry = {};
  next.lockedPlayerIds = {};
  next.rosterLocked = false;
  const names = bracketTeams.map((id) => (next.teams.find((t) => t.id === id) || {}).name).join(", ");
  next.activityLog.push({
    id: uid("act", rng),
    period: next.currentPeriod,
    periodLabel: periodLabel(next.currentPeriod),
    ts: nowStamp(),
    type: "playoffs-start",
    text:
      "Playoffs started! Regular-season standings are now frozen. Bracket (" +
      bracketTeams.length +
      "): " +
      names +
      ".",
  });
  return next;
}
