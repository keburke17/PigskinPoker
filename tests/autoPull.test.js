/* Which leagues the scheduled pull touches, and - the half that actually matters -
 * which it leaves alone.
 *
 * These run anywhere: `pullEligibility` takes two rows and returns a verdict, with no
 * database and no network in the way. That is the point of splitting it out of
 * operations.js. The database-backed half (that the scheduler really does write the
 * same lines the button writes, and really does refuse an unlocked week against a live
 * PostgREST) lives in tests/server.test.js and needs the local stack.
 */

import { describe, expect, it } from "vitest";

import { PULLABLE_PHASES, pullEligibility, summarize } from "../server/autoPull.js";

const league = (over = {}) => ({ id: "L1", name: "Test League", auto_pull_stats: true, ...over });
const period = (over = {}) => ({
  id: "P1",
  phase: "stats",
  roster_locked: true,
  nfl_week: 3,
  ...over,
});

describe("pullEligibility", () => {
  it("pulls a locked, mapped week in a pullable phase", () => {
    const { eligible, why } = pullEligibility(league(), period());
    expect(eligible).toBe(true);
    expect(why).toContain("week 3");
  });

  it("allows both phases the button allows, and no others", () => {
    for (const phase of PULLABLE_PHASES) {
      expect(pullEligibility(league(), period({ phase })).eligible).toBe(true);
    }
    for (const phase of ["pre-deal", "dealt", "finalized"]) {
      expect(pullEligibility(league(), period({ phase })).eligible).toBe(false);
    }
  });

  /* The opt-in is the whole safety story: deploying the scheduler must not start
   * writing into leagues that never asked for it. */
  it("skips a league that has not opted in", () => {
    const { eligible, why } = pullEligibility(league({ auto_pull_stats: false }), period());
    expect(eligible).toBe(false);
    expect(why).toBe("automatic pulls are off");
  });

  it("treats a missing flag as off rather than as on", () => {
    expect(pullEligibility(league({ auto_pull_stats: undefined }), period()).eligible).toBe(false);
    expect(pullEligibility(league({ auto_pull_stats: null }), period()).eligible).toBe(false);
  });

  /* The same refusal setStatLine and pullStats make, for the same reason (OQ-E): stats
   * are keyed by slot, so numbers arriving while a lineup can still move would land on
   * a different player with nothing on screen to say so. */
  it("skips an unlocked week", () => {
    const { eligible, why } = pullEligibility(league(), period({ roster_locked: false }));
    expect(eligible).toBe(false);
    expect(why).toContain("not locked");
  });

  it("skips a week with no NFL week mapped rather than guessing one", () => {
    /* 1..23 is the range the column accepts - 18 regular-season weeks plus the
     * postseason (server/schedule.js). 24 is past the end of the football. */
    for (const nfl_week of [null, undefined, 0, 24, "3"]) {
      const { eligible } = pullEligibility(league(), period({ nfl_week }));
      expect(eligible, "nfl_week=" + String(nfl_week)).toBe(false);
    }
  });

  it("skips a league with no current week", () => {
    expect(pullEligibility(league(), null).eligible).toBe(false);
    expect(pullEligibility(null, period()).eligible).toBe(false);
  });

  /* Every skip is written for a human reading a log on a Monday, so none of them may
   * come back empty - "skipped, why: undefined" is how a job becomes unmaintainable. */
  it("always explains itself", () => {
    const cases = [
      [null, null],
      [league({ auto_pull_stats: false }), period()],
      [league(), null],
      [league(), period({ phase: "pre-deal" })],
      [league(), period({ roster_locked: false })],
      [league(), period({ nfl_week: null })],
    ];
    for (const [l, p] of cases) {
      const { why } = pullEligibility(l, p);
      expect(typeof why).toBe("string");
      expect(why.length).toBeGreaterThan(0);
    }
  });
});

describe("summarize", () => {
  /* A run that skipped everything is the normal Tuesday. If that reported failure the
   * log would cry wolf weekly and nobody would read the one run that mattered. */
  it("counts an all-skipped run as a success", () => {
    const s = summarize([
      { leagueId: "a", status: "skipped", why: "the week is in 'pre-deal'" },
      { leagueId: "b", status: "skipped", why: "the rosters are not locked yet" },
    ]);
    expect(s.ok).toBe(true);
    expect(s.pulled).toBe(0);
    expect(s.skipped).toBe(2);
    expect(s.considered).toBe(2);
  });

  it("is not ok when a league genuinely failed", () => {
    const s = summarize([
      { leagueId: "a", status: "pulled" },
      { leagueId: "b", status: "failed", why: "boom" },
    ]);
    expect(s.ok).toBe(false);
    expect(s.pulled).toBe(1);
    expect(s.failed).toBe(1);
  });

  it("keeps every league's outcome, not just the counts", () => {
    const s = summarize([{ leagueId: "a", status: "pulled", filled: 6 }]);
    expect(s.leagues).toHaveLength(1);
    expect(s.leagues[0].filled).toBe(6);
  });

  it("an empty run is ok and says it considered nothing", () => {
    expect(summarize([])).toMatchObject({ ok: true, considered: 0, pulled: 0 });
  });
});
