/* Pigskin Poker - scheme processing (block / steal / redraw).
 * Moved from PigskinPokerCode.jsx lines 554-657. Behaviour is unchanged; the only
 * edits are the `rng` parameter replacing Math.random (lines 584, 617) and the shuffle.
 *
 * Rule order matters and is deliberate: blocks resolve FIRST and apply immediately,
 * then steals and redraws resolve in a single shuffled pass so that freed players can
 * flow between actions. Do not reorder these passes.
 *
 * ONE DELETION, behaviour-neutral: the original declared `const rostered =
 * allRosteredPlayerIds(next)` at the top of the steal branch (line 611) and never read
 * it - freeAgentIdOfPosition computes its own. Dead local, removed so the no-unused-vars
 * lint rule stays on. Nothing else was touched. Recorded in docs/MIGRATION-NOTES.md.
 *
 * KNOWN GAP - OQ-B (docs/OPEN-QUESTIONS.md): a block is not validated as being on the
 * acting team's own starting lineup. The submission form allows nothing else, so this
 * is unreachable today, but the server must enforce it once writes move server-side in
 * Phase 3. Do not "fix" it here - the engine is being kept behaviour-identical.
 */

import { defaultRng } from "./rng.js";
import { deepClone, nowStamp, periodLabel, shuffle, uid } from "./helpers.js";
import { allRosteredPlayerIds, getPlayer, slotForPlayer } from "./state.js";
import { POSITIONS } from "./constants.js";

export function processSchemes(state, rng = defaultRng) {
  const next = deepClone(state);
  const activity = [];
  const teams = next.teams;
  const schemes = next.schemes || {};
  const label = periodLabel(next.currentPeriod);

  const protectedIds = new Set();
  // Pass 1: blocks apply first & immediately
  Object.entries(schemes).forEach(([teamId, sc]) => {
    if (sc && sc.type === "block" && sc.playerId) {
      protectedIds.add(sc.playerId);
      const team = teams.find((t) => t.id === teamId);
      const p = getPlayer(next, sc.playerId);
      activity.push({
        id: uid("act", rng),
        period: next.currentPeriod,
        periodLabel: label,
        ts: nowStamp(),
        type: "block",
        text:
          (team ? team.name : "A team") +
          " blocked " +
          (p ? p.name + " (" + p.position + ")" : "a player") +
          " from being stolen this " +
          (next.currentPeriod.type === "playoff" ? "round" : "week") +
          ".",
      });
    }
  });

  // Pass 2: steals + redraws, single shuffled pass so freed players can flow between actions
  const actionEntries = Object.entries(schemes).filter(
    ([, sc]) => sc && (sc.type === "steal" || sc.type === "redraw")
  );
  const shuffled = shuffle(actionEntries, rng);

  const freeAgentIdOfPosition = (pos) => {
    const rostered = allRosteredPlayerIds(next);
    const candidates = next.playerPool.filter(
      (p) => p.position === pos && p.status === "Active" && !rostered.has(p.id)
    );
    if (candidates.length === 0) return null;
    return candidates[Math.floor(rng() * candidates.length)].id;
  };

  shuffled.forEach(([teamId, sc]) => {
    const team = teams.find((t) => t.id === teamId);
    if (!team || !team.roster) return;
    const droppedPlayer = getPlayer(next, sc.playerId);
    const loc = slotForPlayer(team, sc.playerId);
    if (!droppedPlayer || !loc) return; // player no longer where expected; skip gracefully

    if (sc.type === "steal") {
      const victims = [];
      teams.forEach((t) => {
        if (t.id === teamId || !t.roster) return;
        POSITIONS.concat(["FLEX"]).forEach((slot) => {
          const pid = t.roster.starters[slot];
          if (pid) {
            const pl = getPlayer(next, pid);
            if (pl && pl.position === sc.position && !protectedIds.has(pid)) {
              victims.push({ team: t, slot, playerId: pid });
            }
          }
        });
      });
      if (victims.length === 0) {
        activity.push({
          id: uid("act", rng),
          period: next.currentPeriod,
          periodLabel: label,
          ts: nowStamp(),
          type: "steal-failed",
          text:
            team.name +
            " tried to steal a " +
            sc.position +
            " but no eligible (unprotected) target was found - action skipped, roster unchanged.",
        });
        return;
      }
      const target = victims[Math.floor(rng() * victims.length)];
      const stolenPlayer = getPlayer(next, target.playerId);
      // remove dropped player from acting team, place stolen player in same slot
      if (loc.area === "starters") team.roster.starters[loc.slot] = target.playerId;
      else team.roster.bench[loc.index] = target.playerId;
      // victim loses stolen player, gets FA replacement of same position in same slot
      const replacementId = freeAgentIdOfPosition(sc.position);
      target.team.roster.starters[target.slot] = replacementId; // may be null if pool empty
      const replacementPlayer = getPlayer(next, replacementId);
      activity.push({
        id: uid("act", rng),
        period: next.currentPeriod,
        periodLabel: label,
        ts: nowStamp(),
        type: "steal",
        text:
          team.name +
          " stole " +
          sc.position +
          " " +
          stolenPlayer.name +
          " from " +
          target.team.name +
          " (dropped " +
          droppedPlayer.name +
          "). " +
          target.team.name +
          " received " +
          (replacementPlayer
            ? replacementPlayer.name + " (free agent)"
            : "no replacement - free-agent pool empty at " + sc.position) +
          " in return.",
      });
      if (!replacementId) {
        activity.push({
          id: uid("act", rng),
          period: next.currentPeriod,
          periodLabel: label,
          ts: nowStamp(),
          type: "warning",
          text:
            "No Active free agents at " +
            sc.position +
            " were available to replace " +
            target.team.name +
            "'s stolen player - that slot is now empty.",
        });
      }
    } else if (sc.type === "redraw") {
      const replacementId = freeAgentIdOfPosition(sc.position);
      if (loc.area === "starters") team.roster.starters[loc.slot] = replacementId;
      else team.roster.bench[loc.index] = replacementId;
      const replacementPlayer = getPlayer(next, replacementId);
      activity.push({
        id: uid("act", rng),
        period: next.currentPeriod,
        periodLabel: label,
        ts: nowStamp(),
        type: "redraw",
        text:
          team.name +
          " redrew " +
          droppedPlayer.name +
          " (" +
          sc.position +
          ") for " +
          (replacementPlayer
            ? replacementPlayer.name + " (free agent)"
            : "no replacement - free-agent pool empty at " + sc.position) +
          ".",
      });
    }
  });

  next.activityLog = (next.activityLog || []).concat(activity);
  next.schemes = {}; // clear after processing
  return next;
}
