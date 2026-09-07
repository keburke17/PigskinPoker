/* Wall clock to instant, and back, in a named timezone.
 *
 * WHY THIS FILE EXISTS. Two things in this project have to reason about a local time
 * that is not the server's:
 *
 *   1. `kickoffIso` (server/feed/nflverse.js) turns nflverse's `gameday` + `gametime`
 *      - Eastern wall clock, with no offset written on it - into an instant.
 *   2. The scheduled weekly cycle (server/autoCycle.js) has to answer "has this
 *      league's 3am Thursday passed yet?" for a league that names its own timezone.
 *
 * The first already did this correctly, hardcoded to America/New_York. The second could
 * not reuse it, so rather than write the same Intl dance twice - and have one of them
 * quietly drift - the rule lives here and nflverse.js calls it with its own zone.
 *
 * THE PROBLEM BEING SOLVED, because it is easy to think there isn't one. A wall clock
 * time is not an instant until you know the offset, and the offset depends on the date:
 * "13:00 Eastern" is 17:00Z in September and 18:00Z in December, and "3am Thursday" is
 * 07:00Z until 1 November 2026 and 08:00Z after it. A hardcoded -5 would fire the
 * league's scheme deadline an hour early for half the season. Node and the browser both
 * ship the zone table; this asks it rather than guessing.
 *
 * NO DEPENDENCY. `Intl.DateTimeFormat` is the standard trick and it is built in, which
 * matters here: CLAUDE.md's rule is that dependencies stay boring, and a timezone
 * library is a large one to add for two callers.
 */

/* Formatters are not free to build and these are asked the same question thousands of
 * times over a season. Keyed by zone, built once. */
const FORMATTERS = new Map();

function formatterFor(tz) {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      /* h23 EXPLICITLY, not just hour12:false. With hour12 alone some ICU builds
       * format midnight as "24" belonging to the PREVIOUS day, which reads back as a
       * date one off - and it would do it only at midnight, which is exactly the hour
       * nobody tests. h23 pins the range to 0-23. */
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      weekday: "short",
    });
    FORMATTERS.set(tz, f);
  }
  return f;
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Is this a timezone this runtime knows about?
 *
 * Used to refuse a nonsense `leagues.tz` at the door rather than throwing from inside a
 * cron three hours later, where the only symptom would be a league that stopped
 * advancing with nothing on any screen to say why.
 */
export function isValidTimeZone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the clock on the wall says in `tz` at that instant.
 *
 * @returns {{year, month, day, hour, minute, second, weekday}} `month` is 1-12 and
 *   `weekday` is 0=Sunday, matching `Date.prototype.getUTCDay`.
 */
export function wallClock(utcMs, tz) {
  const parts = {};
  for (const part of formatterFor(tz).formatToParts(new Date(utcMs))) {
    if (part.type === "weekday") parts.weekday = WEEKDAYS[part.value];
    else if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts;
}

/**
 * How far behind UTC `tz` is at that instant, in milliseconds - the number to ADD to a
 * wall clock in that zone to get UTC.
 *
 * Formatting the instant in the zone and reading the result back as if it were UTC is
 * the standard trick, and it needs no data of its own.
 */
export function offsetMs(utcMs, tz) {
  const p = wallClock(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return utcMs - asUtc;
}

/**
 * A wall clock reading in `tz`, as an instant.
 *
 * TWO PASSES, because the offset depends on the answer it is being used to compute.
 * The second pass only differs inside the hour a transition happens - 2am on a Sunday
 * in March and November - and the first pass lands close enough to pick the right side
 * of it everywhere else. A time that does not exist (2:30am on the spring-forward
 * Sunday) resolves to the instant an hour later rather than throwing, which is the
 * behaviour every calendar application settles on.
 *
 * @returns {number} epoch milliseconds
 */
export function instantOf({ year, month, day, hour = 0, minute = 0, second = 0 }, tz) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = naive + offsetMs(naive, tz);
  utc = naive + offsetMs(utc, tz);
  return utc;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The most recent moment at or before `now` that was `hour`:00 on `weekday` in `tz`.
 *
 * This is how a recurring local deadline is turned into something comparable: "3am
 * Thursday" is not a time you can test against, but "the last time it was 3am on a
 * Thursday in America/New_York" is an instant, and a week whose deal predates it is a
 * week whose deadline has passed.
 *
 * WHY A LOOKING-BACK DEADLINE RATHER THAN "is it 3am right now". A job that only acts
 * in the hour matching its cron does nothing at all if that one tick is missed - a
 * Netlify hiccup, a deploy, a cold start - and the league sits there for a week. Asking
 * "has the deadline passed and has nothing happened since" fires on the NEXT tick
 * instead, and cannot fire twice because the phase has moved by then.
 *
 * @param {number} now      epoch milliseconds
 * @param {string} tz       IANA zone name
 * @param {{weekday: number, hour: number}} deadline  0=Sunday
 * @returns {number} epoch milliseconds, always <= now
 */
export function lastLocalDeadline(now, tz, { weekday, hour }) {
  const here = wallClock(now, tz);
  /* How many days back the most recent `weekday` was, in local days. 0 means today -
   * which is only the answer if the hour has actually arrived; before that the answer
   * is a week ago. */
  let back = (here.weekday - weekday + 7) % 7;
  if (back === 0 && here.hour < hour) back = 7;

  /* STEP BACK IN CALENDAR DAYS, NOT IN MILLISECONDS, and this is the bug the whole
   * file exists to avoid. Subtracting `back * 24h` from the instant is wrong across a
   * DST transition, because those local days are not 24 hours long: 1 November 2026 is
   * 25 hours, so 24 hours back from late on the 1st lands at 00:30 ON THE 1ST rather
   * than on the 31st, and the deadline silently moves a day. Doing the arithmetic on a
   * date-only UTC value instead is exact - UTC has no transitions - and `instantOf`
   * then resolves that local date to a real instant with the right offset. */
  const cal = new Date(Date.UTC(here.year, here.month - 1, here.day) - back * DAY_MS);
  return instantOf(
    { year: cal.getUTCFullYear(), month: cal.getUTCMonth() + 1, day: cal.getUTCDate(), hour },
    tz
  );
}

/** "Thu 3:00 am" in a league's own zone, for a sentence a human reads. */
export function describeDeadline({ weekday, hour }) {
  const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday];
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return day + " " + h12 + (hour < 12 ? "am" : "pm");
}
