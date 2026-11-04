/* The homepage's two lines under each league (Scott, 2026-11-04).
 *
 *   Season League - Commissioner - Gridiron Gang
 *   Week 9 - Schemes due Thursday 3am EST
 *
 * The FACTS come from the server (`leagueHomeFacts` in server/operations.js, carried on
 * each row of myLeagues); the WORDS are here, pure, so tests/homepage.test.js can pin
 * them without a browser.
 *
 * READ-ONLY, like every live view: nothing here decides anything, and nothing reads it
 * back. A row whose facts did not arrive - an older server, a failed read - gets no
 * status line rather than a wrong one.
 */

import { CYCLE_DEADLINES, describeDeadline, zoneLabel } from "../engine/index.js";

const SEP = " - ";

/** "Season League" or "Weekly Table" - the game a league plays, as the cards name it. */
export function gameName(game) {
  return game === "table" ? "Weekly Table" : "Season League";
}

/** The game, the role, and the team: who you are in this league. */
export function leagueSubtitle(league) {
  const table = league.game === "table";
  const parts = [gameName(league.game)];
  if (league.role === "commissioner") parts.push(table ? "Dealer" : "Commissioner");
  if (league.teamName) parts.push(league.teamName);
  if (table && Number.isInteger(league.seats) && Number.isInteger(league.seated)) {
    parts.push(league.seated + " of " + league.seats + " seated");
  }
  return parts.join(SEP);
}

/**
 * What is happening in the league right now, or null when that is not known.
 *
 * A deadline is named ONLY for a league whose scheme clock is switched on - a commissioner
 * who processes by hand has no deadline, and inventing one would be telling managers a
 * rule that does not exist (the email says the same thing, server/notifyFacts.js).
 */
export function leagueStatus(league, now = Date.now()) {
  const p = league.period;
  if (!p || !p.phase) return null;
  if (league.seasonOver) return "Season over";

  const table = league.game === "table";
  const when =
    p.type === "playoff" ? "Playoffs round " + p.number : (table ? "Hand " : "Week ") + p.number;

  let what;
  switch (p.phase) {
    case "pre-deal":
      what = "Waiting on the deal";
      break;
    case "dealt":
      what = league.autoProcessSchemes
        ? "Schemes due " + describeDeadline(CYCLE_DEADLINES.schemes) + " " + zoneLabel(league.tz || "America/New_York", now)
        : table ? "Cards are out - schemes open" : "Schemes open";
      break;
    case "schemes-processed":
      what = "Schemes are in";
      break;
    case "stats":
      what = "Scores coming in";
      break;
    case "finalized":
      what = "Final";
      break;
    default:
      return null;
  }
  return when + SEP + what;
}
