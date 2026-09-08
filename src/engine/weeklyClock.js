/* When the week moves on by itself.
 *
 * Issue #52, OQ-14. Scott asked for the cycle to run on a clock rather than on his
 * attention: "Rosters are dealt automatically Tuesday morning. Schemes are processed
 * Thursday morning at like 3am (just how waivers would process in real fantasy
 * football) ... Tuesday morning rosters are dealt automatically for the next week.
 * Standings are updated."
 *
 * WHY THE DEADLINES LIVE HERE, beside lineupLock.js rather than in server/. Both halves
 * of the app have to say the same thing about them:
 *
 *   - the SERVER decides whether a deadline has passed (server/autoCycle.js, which
 *     imports the constants below and does the timezone arithmetic);
 *   - the BROWSER has to TELL people the deadline exists - the Help tab, the welcome
 *     card, the "your next step" line - because a manager who finds out that 3am
 *     Thursday is real by losing a week is exactly the failure this was meant to avoid.
 *
 * `server/` may import from `src/`; the reverse is forbidden and tests/bundle.test.js
 * fails if it happens. So one definition, in the direction that is allowed. This is the
 * same arrangement lineupLock.js has: the rule is here, the enforcement is server-side,
 * and the screen reaches the same verdict without a round trip.
 *
 * NOTHING HERE DECIDES ANYTHING ON ITS OWN. It is constants plus readers - no clock, no
 * I/O, no state written. The step that actually presses a button is `runLifecycle` in
 * server/operations.js, and it is the same one the commissioner's own button presses.
 */

/**
 * The two deadlines, in the league's own local time. 0 = Sunday, hour is 0-23.
 *
 * CONSTANTS RATHER THAN PER-LEAGUE SETTINGS. Scott named 3am Thursday exactly;
 * "Tuesday morning" he left loose, and 6am is the reading that leaves the longest gap
 * after Monday night football for the numbers to be published - recorded in OQ-14 as a
 * default chosen here rather than one he asked for. Making them settings would put two
 * more knobs on a commissioner nav that OQ-8 already calls too crowded, to solve a
 * problem nobody has had. WHICH timezone they are read in IS per league (`leagues.tz`),
 * because that is the part that is genuinely different for a league in California.
 */
export const CYCLE_DEADLINES = {
  schemes: { weekday: 4, hour: 3 },
  advance: { weekday: 2, hour: 6 },
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Thursday 3am" - the deadline as a phrase, for a log line or a sentence on screen. */
export function describeDeadline({ weekday, hour }) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return DAY_NAMES[weekday] + " " + h12 + (hour < 12 ? "am" : "pm");
}

/** Is this league's scheme deadline on a clock? */
export function autoProcessSchemes(state) {
  return Boolean(state && state._meta && state._meta.autoProcessSchemes);
}

/** Does this league finalize and deal itself on a Tuesday morning? */
export function autoAdvanceWeek(state) {
  return Boolean(state && state._meta && state._meta.autoAdvanceWeek);
}

/** Is anything at all running on a clock? Decides whether to mention it. */
export function anyAutomation(state) {
  return autoProcessSchemes(state) || autoAdvanceWeek(state);
}

/** The IANA zone the league's deadlines are read in. */
export function leagueTimeZone(state) {
  const tz = state && state._meta ? state._meta.tz : null;
  return typeof tz === "string" && tz ? tz : "America/New_York";
}

/**
 * "EST" / "PDT" for a zone, right now - so a deadline reads as a time somebody can act
 * on rather than as a database column.
 *
 * ASKS Intl RATHER THAN HARDCODING, for the same reason kickoff times do: the answer
 * changes on 1 November, mid-season, and a league told "3am ET" all year would be told
 * something an hour wrong for half of it. Falls back to the zone's city name where a
 * runtime cannot answer, which is still better than nothing.
 */
export function zoneLabel(tz, at = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(new Date(at));
    const found = parts.find((p) => p.type === "timeZoneName");
    if (found && found.value) return found.value;
  } catch {
    /* fall through */
  }
  return String(tz).split("/").pop().replace(/_/g, " ");
}

/**
 * The scheme deadline as one phrase, in the league's own terms: "Thursday 3am EST".
 *
 * Used by every screen that has to say when schemes close, so they cannot drift from
 * each other or from what the server actually does.
 */
export function schemeDeadlineWords(state, at = Date.now()) {
  return describeDeadline(CYCLE_DEADLINES.schemes) + " " + zoneLabel(leagueTimeZone(state), at);
}

/** The same, for the Tuesday morning finalize-and-deal. */
export function advanceDeadlineWords(state, at = Date.now()) {
  return describeDeadline(CYCLE_DEADLINES.advance) + " " + zoneLabel(leagueTimeZone(state), at);
}
