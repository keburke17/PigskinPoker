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

import { kickoffAt, kickoffsFor } from "./lineupLock.js";

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

/**
 * THE WEDNESDAY-GAME WEEK. Scott, 2026-11-24 (OQ-40): "weeks that have a Wednesday game,
 * the schemes are processed Wednesday at 3am instead of Thursday. Once the schedule reads
 * back to normal, and games are just Thursday Sunday Monday, the schemes go back to
 * Thursday 3am like normal."
 *
 * WHY: schemes ignore kickoffs. At 3am Thursday a Wednesday game is over, so a steal
 * could take a player whose line is already known, and a Block could be chosen in
 * hindsight. Moving the deadline ahead of the game is the whole fix; nothing about how
 * schemes resolve changed.
 *
 * READ OFF THE WEEK'S OWN `kickoffs` - the times the deal dealt against and the lineup
 * lock fires on - so it switches on and off with the schedule and needs no setting.
 */
export const WEDNESDAY_SCHEME_DEADLINE = { weekday: 3, hour: 3 };

/* Weekday and hour of an instant in a zone, by Intl. Null when the runtime cannot say. */
function wallDayHour(ms, tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const wd = parts.find((p) => p.type === "weekday");
    const hr = parts.find((p) => p.type === "hour");
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd && wd.value);
    const hour = Number(hr && hr.value) % 24;
    if (weekday < 0 || !Number.isFinite(hour)) return null;
    return { weekday, hour };
  } catch {
    return null;
  }
}

/** Does any game in this week's schedule kick off on a Wednesday, in the league's zone? */
export function hasWednesdayGame(kickoffs, tz = "America/New_York") {
  return Object.values(kickoffs || {}).some((entry) => {
    const iso = kickoffAt(entry);
    if (!iso) return false;
    const here = wallDayHour(Date.parse(iso), tz);
    return Boolean(here && here.weekday === WEDNESDAY_SCHEME_DEADLINE.weekday);
  });
}

/**
 * This week's scheme deadline.
 *
 * An ordinary week: Thursday 3am, exactly as before. A week with a Wednesday game: the
 * FIRST of Wednesday 3am or Thursday 3am after the week was dealt. Dealt on the Tuesday
 * as normal, that is Wednesday 3am. Dealt late - on the Wednesday itself, after 3am - it
 * falls back to Thursday 3am rather than waiting a whole week for the next Wednesday,
 * which would process schemes after every game had been played. A commissioner who wants
 * a late-dealt week closed before the Wednesday game presses Process Schemes himself.
 *
 * Unknown deal time (a week not dealt yet) answers Wednesday, which is what a deal on the
 * normal Tuesday will get.
 *
 * @param {{kickoffs?: object, tz?: string, dealtAt?: string|null}} week
 * @returns {{weekday: number, hour: number}}
 */
export function schemeDeadlineFor({ kickoffs, tz = "America/New_York", dealtAt = null } = {}) {
  const normal = CYCLE_DEADLINES.schemes;
  if (!hasWednesdayGame(kickoffs, tz)) return normal;
  const dealt = Date.parse(dealtAt ?? "");
  const here = Number.isFinite(dealt) ? wallDayHour(dealt, tz) : null;
  if (!here) return WEDNESDAY_SCHEME_DEADLINE;
  /* Hours from the deal forward to each candidate, in local wall-clock terms. A deal in
   * the deadline's own hour is AFTER it (the server compares dealt < deadline), so zero
   * counts as a full week away. */
  const ahead = (d) => {
    const h = ((d.weekday - here.weekday) * 24 + d.hour - here.hour + 168) % 168;
    return h === 0 ? 168 : h;
  };
  return ahead(WEDNESDAY_SCHEME_DEADLINE) <= ahead(normal) ? WEDNESDAY_SCHEME_DEADLINE : normal;
}

/** The deadline for the week a hydrated league is on. */
export function schemeDeadlineOf(state) {
  return schemeDeadlineFor({
    kickoffs: kickoffsFor(state),
    tz: leagueTimeZone(state),
    dealtAt: state && state._meta ? state._meta.dealtAt : null,
  });
}

/**
 * The disclaimer for a Wednesday-game week, or null in an ordinary one. Shown wherever the
 * deadline is, so nobody discovers the early close by losing their scheme.
 */
export function wednesdayDeadlineNote(state) {
  if (!hasWednesdayGame(kickoffsFor(state), leagueTimeZone(state))) return null;
  const d = schemeDeadlineOf(state);
  return d.weekday === WEDNESDAY_SCHEME_DEADLINE.weekday
    ? "This week has a Wednesday game, so schemes process Wednesday 3am instead of Thursday."
    : "This week has a Wednesday game, but it was dealt late, so schemes process Thursday 3am - after that game.";
}

/** The rule, for the Rules screen, whatever week it is. */
export const WEDNESDAY_RULE_WORDS =
  "In a week with a Wednesday game, schemes process Wednesday 3am instead of Thursday. Every other week it is Thursday 3am.";

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

/**
 * Does this league email its managers when the week moves? Issue #57 / OQ-6.
 *
 * Not a clock, and it sits here anyway: this file is where the operational `_meta`
 * switches are read from, so a component asks a named question instead of reaching into
 * `state._meta` itself. It belongs beside the two above for a second reason - what the
 * app can promise somebody about what happens next depends on both. "Schemes close at
 * 3am" reads differently to a league that will be emailed about it.
 */
export function leagueEmailOn(state) {
  return Boolean(state && state._meta && state._meta.notifyMembers);
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
  return describeDeadline(schemeDeadlineOf(state)) + " " + zoneLabel(leagueTimeZone(state), at);
}

/** The same, for the Tuesday morning finalize-and-deal. */
export function advanceDeadlineWords(state, at = Date.now()) {
  return describeDeadline(CYCLE_DEADLINES.advance) + " " + zoneLabel(leagueTimeZone(state), at);
}
