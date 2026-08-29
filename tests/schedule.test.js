/* League week is not NFL week (stage 3 of docs/PHASE-4-PLAN.md).
 *
 * `periods.number` counts the weeks THIS LEAGUE has played; nflverse publishes by NFL
 * week. Nothing connects them, so the mapping is stored per period and defaulted by
 * server/schedule.js. No I/O in that module, which is what makes the rule itself - not
 * a round trip - the thing under test.
 */

import { describe, expect, it } from "vitest";
import { NFL_WEEK_MAX, isValidNflWeek, nextNflWeek } from "../server/schedule.js";

const week = (number, nfl_week = null) => ({ type: "week", number, nfl_week });
const playoff = (number, nfl_week = null) => ({ type: "playoff", number, nfl_week });

describe("isValidNflWeek", () => {
  it("accepts the range the column's check constraint accepts", () => {
    expect(isValidNflWeek(1)).toBe(true);
    expect(isValidNflWeek(NFL_WEEK_MAX)).toBe(true);
    expect(isValidNflWeek(0)).toBe(false);
    expect(isValidNflWeek(NFL_WEEK_MAX + 1)).toBe(false);
  });

  it("refuses anything that is not a whole number", () => {
    /* These reach it from a text input and from JSON, so none of them is theoretical.
     * A float or a numeric string would fail at the database with a message nobody on
     * the commissioner's screen could act on. */
    expect(isValidNflWeek(2.5)).toBe(false);
    expect(isValidNflWeek("3")).toBe(false);
    expect(isValidNflWeek(null)).toBe(false);
    expect(isValidNflWeek(undefined)).toBe(false);
    expect(isValidNflWeek(NaN)).toBe(false);
  });
});

describe("nextNflWeek", () => {
  it("maps a brand new league's week 1 to NFL week 1", () => {
    // The reset league's case: it opens on opening weekend, so they coincide.
    expect(nextNflWeek({ periods: [], period: week(1) })).toBe(1);
  });

  it("counts on from the furthest-along mapping, not from the league's week number", () => {
    /* THE POINT OF THE WHOLE FUNCTION. A league that started in NFL week 4 has league
     * week 2 playing NFL week 5, and nothing about `number` would say so. */
    const periods = [week(1, 4), week(2)];
    expect(nextNflWeek({ periods, period: week(2) })).toBe(5);
  });

  it("carries a correction forward without anyone touching it again", () => {
    /* Correct league week 3 to NFL week 5 - a bye, say - and week 4 becomes NFL week 6
     * on its own. That is what makes this a once-a-season control rather than a weekly
     * chore, and it is the reason the default counts from the mapping. */
    const periods = [week(1, 1), week(2, 2), week(3, 5)];
    expect(nextNflWeek({ periods, period: week(4) })).toBe(6);
  });

  it("ignores the period being created, mapped or not", () => {
    const periods = [week(1, 1), week(2, null)];
    expect(nextNflWeek({ periods, period: week(2) })).toBe(2);
  });

  it("continues the season's count into the playoffs", () => {
    // Playoff round 1 is a week of football like any other; it just is not week 1.
    const periods = [week(1, 1), week(2, 2), week(3, 3)];
    expect(nextNflWeek({ periods, period: playoff(1) })).toBe(4);
  });

  it("leaves an unanchored playoff round unmapped rather than guessing", () => {
    /* "Playoff round 1" is no evidence at all about which Sunday it lands on. Null is a
     * question the commissioner can answer; a wrong number that looks right is not. */
    expect(nextNflWeek({ periods: [], period: playoff(1) })).toBe(null);
  });

  it("stops rather than clamping once the season runs out", () => {
    /* Past week 23 there is no more football to fetch. Clamping to 23 would silently
     * pull one week's numbers into another week, which is worse than refusing. */
    const periods = [week(1, NFL_WEEK_MAX)];
    expect(nextNflWeek({ periods, period: week(2) })).toBe(null);
  });

  it("treats an out-of-range stored value as no mapping at all", () => {
    // Nothing should ever write one, but a hand-edited row must not poison the count.
    const periods = [week(1, 99)];
    expect(nextNflWeek({ periods, period: week(2) })).toBe(2);
  });

  it("falls back to the league's own week number when nothing is mapped", () => {
    expect(nextNflWeek({ periods: [week(1), week(2)], period: week(2) })).toBe(2);
  });
});
