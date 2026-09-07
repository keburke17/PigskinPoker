/* Which week of NFL football a league period is playing.
 *
 * `periods.number` is the LEAGUE's week - the third week THIS LEAGUE has played - and
 * nflverse only publishes by NFL week. Nothing connects the two. A league that opened
 * on opening weekend has them equal; a league that started late, one playing through a
 * bye, and next season all break that. So the mapping is stored per period, defaulted
 * here, and correctable by the commissioner - which is what `periods.nfl_week` was
 * added for (20260828010000_pool_feed_sync.sql).
 *
 * DELIBERATELY NOT IN THE APP-STATE BLOB. The artifact's state shape has no field for
 * it, so putting `nfl_week` into decompose.js's period row would write it on every
 * ordinary blob write - deal, process schemes, finalize, every pool edit - and any path
 * where the blob did not carry it would write null straight over a correction. That is
 * precisely the bug `external_ids` hit (see the comment in decompose.js). It is a
 * server-owned column in the same family as `deal_seed` and `scheme_seed`: written by
 * direct update from operations.js, never derived from state.
 *
 * No I/O here on purpose, same as server/pool.js - the rule is the thing worth testing.
 */

/* The range `periods.nfl_week` accepts. 18 regular-season weeks plus the postseason;
 * the check constraint in the migration says the same thing and this must not drift
 * from it, or a write fails at the database with a message nobody can act on. */
export const NFL_WEEK_MIN = 1;
export const NFL_WEEK_MAX = 23;

/** A week the column will actually accept. */
export function isValidNflWeek(week) {
  return Number.isInteger(week) && week >= NFL_WEEK_MIN && week <= NFL_WEEK_MAX;
}

/**
 * The NFL week a newly created period should start out mapped to.
 *
 * One later than the furthest-along mapping the season already has, so A CORRECTION
 * CARRIES FORWARD: tell it league week 3 is NFL week 5 and week 4 becomes NFL week 6
 * on its own, and every week after it. That is the whole reason to count from the
 * existing mapping rather than from the league's week number.
 *
 * WITH NOTHING MAPPED YET IT ASKS THE CALENDAR (issue #45). This used to fall back
 * straight to the league's own week number, which is right for a league opening on
 * opening weekend and wrong in a way that LOOKS right for every other one: a league
 * created in October mapped its week 1 to NFL week 1, so the stats pull fetched
 * September's numbers and - the more damaging half - the lineup lock fired on
 * September's kickoff times. Given `weekStarts`, the answer is instead the week that is
 * about to be played, and the old fallback only applies when no schedule was available.
 *
 * A playoff round with nothing to count from stays NULL rather than guessing: its
 * `number` is the round, not a week of football, and "playoff round 1" is no evidence
 * at all about which Sunday it lands on. Unmapped is a question the commissioner can
 * answer; a wrong number that looks right is not.
 *
 * @param {Array}  periods  every period row in the season, mapped or not
 * @param {{type: string, number: number}} period  the one being created
 * @param {Object<number,string>|null} weekStarts  NFL week -> ISO of its first kickoff,
 *        from the caller (server/feed's `fetchWeekStarts`). Absent falls back to the
 *        league's week number, which is what this did before #45.
 * @param {number} now  epoch ms, injected so the rule is testable with a frozen clock
 * @returns {number|null}
 */
export function nextNflWeek({ periods = [], period, weekStarts = null, now = Date.now() }) {
  const mapped = periods.filter((p) => isValidNflWeek(p.nfl_week)).map((p) => p.nfl_week);
  if (mapped.length) {
    const next = Math.max(...mapped) + 1;
    /* Past week 23 there is no more football to fetch. Null says "unmapped" and a pull
     * refuses cleanly; a clamp to 23 would silently pull the wrong week's numbers. */
    return isValidNflWeek(next) ? next : null;
  }
  /* AN EXISTING MAPPING ALWAYS WINS over the calendar, and that ordering is the point:
   * a commissioner's correction has to keep carrying forward. The calendar only speaks
   * for a season nobody has mapped anything in yet. */
  if (period && period.type === "week") {
    const fromCalendar = weekInProgress(weekStarts, now);
    if (fromCalendar != null) return fromCalendar;
    if (isValidNflWeek(period.number)) return period.number;
  }
  return null;
}

/**
 * The NFL week a league starting RIGHT NOW would be playing: the earliest week whose
 * first kickoff is still ahead.
 *
 * WHY "NOT YET KICKED OFF" RATHER THAN "STILL RUNNING". A deal happens on a Tuesday or
 * a Wednesday, which sits after one week's last game and before the next week's first -
 * so "the week whose games are in progress" has no answer on the day the question is
 * actually asked. It also gets the awkward case right on its own: a league created on
 * the Sunday afternoon of week 5 gets week 6, because week 5 is half played and dealing
 * into it would hand people players whose games are over.
 *
 * ONCE EVERY WEEK HAS KICKED OFF this returns the last one known rather than null. A
 * league created in January is in the postseason and the commissioner has to say which
 * round anyway; the alternative fallback - the league's own week number - would confidently
 * answer "week 1", which is the failure #45 is about.
 *
 * @returns {number|null} null when there is no schedule to read
 */
export function weekInProgress(weekStarts, now = Date.now()) {
  if (!weekStarts) return null;
  const weeks = Object.keys(weekStarts)
    .map(Number)
    .filter((w) => isValidNflWeek(w))
    .sort((a, b) => a - b);
  if (!weeks.length) return null;

  for (const week of weeks) {
    const at = Date.parse(weekStarts[week]);
    if (Number.isFinite(at) && at > now) return week;
  }
  return weeks[weeks.length - 1];
}
