/**
 * "Schemes close in 12 hours, and you have nothing in."
 *
 * Issue #57. The only one of the three emails with a schedule of its own, which makes it
 * the only one that can go wrong while nobody is doing anything - so every branch is
 * pinned here, with the clock frozen.
 *
 * What these tests are really protecting:
 *
 *   1. A LEAGUE WITH NO CLOCK IS NEVER REMINDED. Where the commissioner processes
 *      schemes himself there is no deadline, and an email claiming one invents a rule
 *      his league does not have.
 *   2. THE DEADLINE IS THE ONE THIS WEEK ACTUALLY CLOSES ON, anchored to `dealt_at`. A
 *      week dealt on Friday closes the FOLLOWING Thursday, and "the next Thursday from
 *      now" would be wrong for exactly the weeks already running late.
 *   3. NOBODY IS REMINDED ABOUT SOMETHING THEY WERE JUST TOLD. A week dealt inside the
 *      window has already emailed everyone a roster with the deadline on it.
 *   4. THE ARITHMETIC SURVIVES 1 NOVEMBER. The 2026 season crosses the daylight-saving
 *      change, which is the failure this whole hourly design exists to avoid.
 */

import { describe, it, expect } from "vitest";
import { REMINDER_LEAD_MS, reminderEligibility } from "../server/autoCycle.js";
import { nextLocalDeadline } from "../server/tz.js";

const TZ = "America/New_York";
const SCHEMES = { weekday: 4, hour: 3 };

/* The week the league is playing: dealt Tuesday 6am Eastern, closing at 3am on the
 * Thursday - which is 07:00Z while the clocks are still on daylight time. */
const DEALT = "2026-09-15T10:00:00Z";        // Tue 15 Sep, 06:00 EDT
const DEADLINE = Date.parse("2026-09-17T07:00:00Z"); // Thu 17 Sep, 03:00 EDT
const WINDOW_OPENS = DEADLINE - REMINDER_LEAD_MS;    // Wed 16 Sep, 15:00 EDT

const league = (over = {}) => ({
  id: "L1",
  tz: TZ,
  notify_members: true,
  auto_process_schemes: true,
  ...over,
});
const period = (over = {}) => ({ id: "P1", phase: "dealt", dealt_at: DEALT, ...over });

describe("when the deadline actually falls", () => {
  it("is the first one after the week was dealt", () => {
    expect(nextLocalDeadline(Date.parse(DEALT), TZ, SCHEMES)).toBe(DEADLINE);
  });

  /* A week dealt LATE - a commissioner who got to it on Friday - waits for its own
   * deadline rather than closing hours later. Same anchor `deadlinePassed` uses. */
  it("is next week's for a week dealt after this week's", () => {
    const friday = Date.parse("2026-09-18T16:00:00Z"); // Fri 18 Sep, 12:00 EDT
    expect(nextLocalDeadline(friday, TZ, SCHEMES)).toBe(Date.parse("2026-09-24T07:00:00Z"));
  });

  /* THE ONE THAT MATTERS IN NOVEMBER. 3am Eastern is 07:00Z under EDT and 08:00Z under
   * EST; stepping forward seven times 24 hours would land an hour out and move the
   * league's deadline without anybody touching anything. */
  it("holds across the daylight-saving change", () => {
    const beforeChange = Date.parse("2026-10-29T12:00:00Z"); // Thu 29 Oct, 08:00 EDT
    const next = nextLocalDeadline(beforeChange, TZ, SCHEMES);
    expect(next).toBe(Date.parse("2026-11-05T08:00:00Z")); // Thu 5 Nov, 03:00 EST
  });
});

describe("who gets reminded, and when", () => {
  it("sends inside the window, to a league with the clock on and email on", () => {
    const now = WINDOW_OPENS + 30 * 60 * 1000; // half an hour into the window
    const verdict = reminderEligibility({ league: league(), period: period(), now });
    expect(verdict.eligible).toBe(true);
    expect(verdict.at).toBe(DEADLINE);
    expect(verdict.hoursLeft).toBe(12);
  });

  /* The hourly job fires at any point inside the window, so the number in the subject
   * line is measured rather than assumed - "12 hours" when there are four is worse than
   * saying four. */
  it("counts the hours that are actually left", () => {
    const now = DEADLINE - 4 * 60 * 60 * 1000;
    expect(reminderEligibility({ league: league(), period: period(), now }).hoursLeft).toBe(4);
  });

  it("says nothing before the window opens", () => {
    const now = WINDOW_OPENS - 60 * 1000;
    const verdict = reminderEligibility({ league: league(), period: period(), now });
    expect(verdict.eligible).toBe(false);
    expect(verdict.why).toContain("more than 12 hours");
  });

  it("says nothing once the deadline has passed", () => {
    const verdict = reminderEligibility({ league: league(), period: period(), now: DEADLINE + 1000 });
    expect(verdict.eligible).toBe(false);
    expect(verdict.why).toContain("already passed");
  });

  /* A week dealt at 8pm on Wednesday has just emailed everybody a roster with the
   * deadline printed on it. A reminder an hour later is noise, and noise is how a
   * sender ends up filtered - which would take the magic links down with it. */
  it("does not remind about a week dealt inside the window", () => {
    const dealtLate = new Date(WINDOW_OPENS + 60 * 60 * 1000).toISOString();
    const verdict = reminderEligibility({
      league: league(),
      period: period({ dealt_at: dealtLate }),
      now: WINDOW_OPENS + 2 * 60 * 60 * 1000,
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.why).toContain("deal email already said so");
  });
});

describe("the two switches, and the week's own state", () => {
  const now = WINDOW_OPENS + 30 * 60 * 1000;

  it("never emails a league that has not asked to be emailed", () => {
    const verdict = reminderEligibility({
      league: league({ notify_members: false }), period: period(), now,
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.why).toContain("league email is off");
  });

  /* THE RULE THAT MUST NOT BEND. Without the clock there is no deadline to be reminded
   * of, so a reminder would be announcing a rule the commissioner never made. */
  it("never invents a deadline for a league that processes schemes by hand", () => {
    const verdict = reminderEligibility({
      league: league({ auto_process_schemes: false }), period: period(), now,
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.why).toContain("not on a clock");
  });

  it("says nothing about a week that is no longer open", () => {
    for (const phase of ["pre-deal", "schemes-processed", "stats", "finalized"]) {
      const verdict = reminderEligibility({ league: league(), period: period({ phase }), now });
      expect(verdict.eligible, phase).toBe(false);
      expect(verdict.why, phase).toContain(phase);
    }
  });

  it("waits rather than guessing when a week has no deal time", () => {
    const verdict = reminderEligibility({
      league: league(), period: period({ dealt_at: null }), now,
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.why).toContain("no deal time");
  });

  it("has nothing to say about a league or a week that is not there", () => {
    expect(reminderEligibility({ league: null, period: period(), now }).eligible).toBe(false);
    expect(reminderEligibility({ league: league(), period: null, now }).eligible).toBe(false);
  });

  /* A league whose stored zone this runtime cannot use falls back to Eastern rather
   * than throwing out of a cron at 3am - the same fallback every other deadline takes. */
  it("falls back to Eastern for an unusable timezone", () => {
    const verdict = reminderEligibility({
      league: league({ tz: "Mars/Olympus_Mons" }), period: period(), now,
    });
    expect(verdict.eligible).toBe(true);
    expect(verdict.at).toBe(DEADLINE);
  });
});
