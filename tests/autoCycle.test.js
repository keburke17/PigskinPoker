/* When the clock may move a league's week along, and - the half that actually matters -
 * when it must leave it alone.
 *
 * These run anywhere: the eligibility rules take rows and return a verdict, with no
 * database and no network in the way. That is the point of splitting them out of
 * operations.js, and it is the same split server/autoPull.js made for the stats pull.
 * The database-backed half - that the scheduler really writes what the buttons write,
 * and really refuses what the buttons refuse - lives in tests/server.test.js.
 *
 * THE TIMEZONE CASES ARE THE ONES TO READ. A single UTC cron would fire an hour wrong
 * for half the season, and the 2026 season crosses the daylight-saving change on 1
 * November, mid-season. Those cases are pinned below with real instants.
 */

import { describe, expect, it } from "vitest";

import {
  DEADLINES,
  DEFAULT_TZ,
  FINALIZABLE_PHASES,
  LAST_REGULAR_WEEK,
  PROCESSABLE_PHASES,
  advanceEligibility,
  deadlinePassed,
  dealEligibility,
  dealWindowOpen,
  schemesEligibility,
  summarize,
  weekIsComplete,
  zoneOf,
} from "../server/autoCycle.js";
import { instantOf, lastLocalDeadline, wallClock } from "../server/tz.js";

const ET = "America/New_York";
const at = (iso) => Date.parse(iso);

const league = (over = {}) => ({
  id: "L1",
  name: "Test League",
  tz: ET,
  auto_process_schemes: true,
  auto_advance_week: true,
  ...over,
});

/* A week dealt on Tuesday of an October week, mapped, locked, with two teams playing. */
const period = (over = {}) => ({
  id: "P1",
  phase: "dealt",
  nfl_week: 6,
  dealt_at: "2026-10-13T14:00:00Z", // Tuesday 10am ET
  roster_locked: false,
  kickoffs: {
    "Kansas City Chiefs": "2026-10-16T00:15:00Z",
    "Buffalo Bills": "2026-10-16T00:15:00Z",
  },
  ...over,
});

const allDone = { "Kansas City Chiefs": "Win", "Buffalo Bills": "Loss" };

/* ============================== the local clock ============================= */

describe("the local clock", () => {
  /* THE BUG A UTC CRON WOULD SHIP. Same wall-clock deadline, two different instants,
   * and the season runs straight through the change. */
  it("puts Thursday 3am at 07:00Z under EDT and 08:00Z under EST", () => {
    const edt = lastLocalDeadline(at("2026-10-29T12:00:00Z"), ET, DEADLINES.schemes);
    const est = lastLocalDeadline(at("2026-11-05T12:00:00Z"), ET, DEADLINES.schemes);
    expect(new Date(edt).toISOString()).toBe("2026-10-29T07:00:00.000Z");
    expect(new Date(est).toISOString()).toBe("2026-11-05T08:00:00.000Z");
  });

  it("has not reached today's deadline a minute before it, and has a minute after", () => {
    const before = lastLocalDeadline(at("2026-10-29T06:59:00Z"), ET, DEADLINES.schemes);
    const after = lastLocalDeadline(at("2026-10-29T07:01:00Z"), ET, DEADLINES.schemes);
    expect(new Date(before).toISOString()).toBe("2026-10-22T07:00:00.000Z"); // last week's
    expect(new Date(after).toISOString()).toBe("2026-10-29T07:00:00.000Z");
  });

  /* 1 November 2026 is a 25-HOUR LOCAL DAY. Stepping back by a fixed 24 hours from late
   * on that Sunday lands on the same date rather than the day before, which would move
   * the deadline by a day. This is why server/tz.js does calendar arithmetic. */
  it("steps back a whole local day across the fall-back Sunday", () => {
    const sundayNight = at("2026-11-02T04:30:00Z"); // Sun 1 Nov, 23:30 EST
    const found = lastLocalDeadline(sundayNight, ET, DEADLINES.schemes);
    expect(new Date(found).toISOString()).toBe("2026-10-29T07:00:00.000Z");
    expect(found).toBeLessThan(sundayNight);
  });

  it("never returns a deadline in the future", () => {
    for (let h = 0; h < 24 * 21; h += 1) {
      const now = at("2026-10-20T00:00:00Z") + h * 3600 * 1000;
      for (const d of Object.values(DEADLINES)) {
        expect(lastLocalDeadline(now, ET, d)).toBeLessThanOrEqual(now);
      }
    }
  });

  it("lands on the right weekday and hour, every hour for three weeks", () => {
    for (let h = 0; h < 24 * 21; h += 1) {
      const now = at("2026-10-20T00:00:00Z") + h * 3600 * 1000;
      const w = wallClock(lastLocalDeadline(now, ET, DEADLINES.schemes), ET);
      expect(w.weekday).toBe(DEADLINES.schemes.weekday);
      expect(w.hour).toBe(DEADLINES.schemes.hour);
    }
  });

  it("answers for a league that is not on Eastern", () => {
    const pt = lastLocalDeadline(at("2026-10-29T12:00:00Z"), "America/Los_Angeles", DEADLINES.schemes);
    expect(new Date(pt).toISOString()).toBe("2026-10-29T10:00:00.000Z"); // 3am PDT
  });

  it("round-trips a wall clock through an instant", () => {
    const parts = { year: 2026, month: 11, day: 5, hour: 3 };
    const back = wallClock(instantOf(parts, ET), ET);
    expect(back.year).toBe(2026);
    expect(back.month).toBe(11);
    expect(back.day).toBe(5);
    expect(back.hour).toBe(3);
  });

  it("falls back to Eastern for a zone this runtime cannot use", () => {
    expect(zoneOf(league({ tz: "Mars/Olympus_Mons" }))).toBe(DEFAULT_TZ);
    expect(zoneOf(league({ tz: null }))).toBe(DEFAULT_TZ);
    expect(zoneOf(league({ tz: "America/Denver" }))).toBe("America/Denver");
  });
});

/* ============================ the scheme deadline =========================== */

describe("deadlinePassed", () => {
  /* The whole idempotency story: measured against when the week was DEALT, not against
   * the current hour. */
  it("is passed for a week dealt before the deadline", () => {
    const { passed } = deadlinePassed(league(), "2026-10-13T14:00:00Z", DEADLINES.schemes, at("2026-10-15T12:00:00Z"));
    expect(passed).toBe(true);
  });

  it("is NOT passed for a week dealt after the most recent deadline", () => {
    // Dealt Friday; the last Thursday 3am is behind it, the next one is days away.
    const { passed } = deadlinePassed(league(), "2026-10-16T14:00:00Z", DEADLINES.schemes, at("2026-10-17T12:00:00Z"));
    expect(passed).toBe(false);
  });

  /* A MISSED TICK MUST NOT COST A WEEK. Netlify hiccups, deploys and cold starts all
   * eat an hour; the answer is still yes at 4am, 5am and noon. */
  it("stays passed for every hour after the deadline until the week moves", () => {
    for (const hour of ["07:01", "08:00", "12:00", "23:00"]) {
      const now = at("2026-10-15T" + hour + ":00Z");
      expect(deadlinePassed(league(), "2026-10-13T14:00:00Z", DEADLINES.schemes, now).passed).toBe(true);
    }
  });

  it("waits rather than guessing when the week has no deal time", () => {
    expect(deadlinePassed(league(), null, DEADLINES.schemes, at("2026-10-15T12:00:00Z")).passed).toBe(false);
  });
});

describe("schemesEligibility", () => {
  const now = at("2026-10-15T12:00:00Z"); // Thursday, after 3am ET

  it("processes a dealt week once the deadline has passed", () => {
    const { eligible } = schemesEligibility({ league: league(), period: period(), teamCount: 6, now });
    expect(eligible).toBe(true);
  });

  /* The opt-in is the safety story: deploying the scheduler must not start moving
   * leagues that never asked for it. */
  it("skips a league that has not opted in", () => {
    const { eligible, why } = schemesEligibility({
      league: league({ auto_process_schemes: false }), period: period(), teamCount: 6, now,
    });
    expect(eligible).toBe(false);
    expect(why).toBe("automatic scheme processing is off");
  });

  it("treats a missing flag as off rather than as on", () => {
    for (const flag of [undefined, null]) {
      expect(schemesEligibility({
        league: league({ auto_process_schemes: flag }), period: period(), teamCount: 6, now,
      }).eligible).toBe(false);
    }
  });

  it("allows only the phase the button allows", () => {
    for (const phase of PROCESSABLE_PHASES) {
      expect(schemesEligibility({ league: league(), period: period({ phase }), teamCount: 6, now }).eligible).toBe(true);
    }
    for (const phase of ["pre-deal", "schemes-processed", "stats", "finalized"]) {
      expect(schemesEligibility({ league: league(), period: period({ phase }), teamCount: 6, now }).eligible).toBe(false);
    }
  });

  /* THE COMMISSIONER WHO DID IT HIMSELF. The phase has already moved, so the job finds
   * nothing to do and says so quietly - no error, no second processing. */
  it("does nothing when the commissioner already processed the week", () => {
    const { eligible, why } = schemesEligibility({
      league: league(), period: period({ phase: "schemes-processed" }), teamCount: 6, now,
    });
    expect(eligible).toBe(false);
    expect(why).toContain("schemes-processed");
  });

  /* A WEEK DEALT LATE waits for the NEXT Thursday rather than processing on the spot,
   * which is what a naive "is it after 3am Thursday" check would do. */
  it("waits a full week for a week dealt after the deadline", () => {
    const late = period({ dealt_at: "2026-10-16T14:00:00Z" }); // Friday
    expect(schemesEligibility({ league: league(), period: late, teamCount: 6, now: at("2026-10-17T12:00:00Z") }).eligible).toBe(false);
    expect(schemesEligibility({ league: league(), period: late, teamCount: 6, now: at("2026-10-18T12:00:00Z") }).eligible).toBe(false);
    // The following Thursday, it is due.
    expect(schemesEligibility({ league: league(), period: late, teamCount: 6, now: at("2026-10-22T12:00:00Z") }).eligible).toBe(true);
  });

  it("skips a league with no teams and a league with no week", () => {
    expect(schemesEligibility({ league: league(), period: period(), teamCount: 0, now }).why).toContain("no teams");
    expect(schemesEligibility({ league: league(), period: null, teamCount: 6, now }).why).toBe("no current week");
  });

  it("always explains itself", () => {
    const cases = [
      { league: null, period: period(), teamCount: 6 },
      { league: league({ auto_process_schemes: false }), period: period(), teamCount: 6 },
      { league: league(), period: null, teamCount: 6 },
      { league: league(), period: period({ phase: "pre-deal" }), teamCount: 6 },
      { league: league(), period: period(), teamCount: 0 },
      { league: league(), period: period({ dealt_at: "2026-10-16T14:00:00Z" }), teamCount: 6 },
    ];
    for (const c of cases) {
      const { eligible, why } = schemesEligibility({ ...c, now });
      expect(eligible).toBe(false);
      expect(typeof why).toBe("string");
      expect(why.length).toBeGreaterThan(0);
    }
  });
});

/* =========================== is the football over? ========================= */

describe("weekIsComplete", () => {
  it("is complete when every team with a kickoff has a result", () => {
    expect(weekIsComplete(period().kickoffs, allDone).complete).toBe(true);
  });

  it("accepts the Map the feed actually returns", () => {
    const asMap = new Map(Object.entries(allDone));
    expect(weekIsComplete(period().kickoffs, asMap).complete).toBe(true);
  });

  /* THE CASE AN UNATTENDED FINALIZE WOULD DO THE MOST DAMAGE IN. A postponed game has a
   * kickoff and no result, so the job waits and tries again next hour. */
  it("is not complete while one game is still unplayed", () => {
    const { complete, why } = weekIsComplete(period().kickoffs, { "Kansas City Chiefs": "Win" });
    expect(complete).toBe(false);
    expect(why).toContain("1 team");
  });

  /* NOT VACUOUSLY TRUE. A league whose schedule was never read has no kickoffs, and
   * "nothing is unfinished" must not read as "everything is done". */
  it("is not complete when the week's kickoff times were never read", () => {
    const { complete, why } = weekIsComplete({}, allDone);
    expect(complete).toBe(false);
    expect(why).toContain("kickoff times");
  });

  /* Deliberately NOT "the stats pull found nothing missing": a missing stat line is
   * also what a healthy starter who was inactive looks like, and OQ-4c says he scores
   * zero. The readiness question is about football, not about stat boxes. */
  it("is complete even though a team's players may have no stats", () => {
    expect(weekIsComplete(period().kickoffs, allDone).complete).toBe(true);
  });
});

/* ============================ finalize and deal ============================ */

describe("advanceEligibility", () => {
  const now = at("2026-10-20T12:00:00Z"); // Tuesday, after 6am ET
  const ready = () => period({ phase: "stats", roster_locked: true });

  it("advances a finished week on Tuesday morning", () => {
    const { eligible } = advanceEligibility({ league: league(), period: ready(), teamCount: 6, results: allDone, now });
    expect(eligible).toBe(true);
  });

  it("skips a league that has not opted in", () => {
    const { eligible, why } = advanceEligibility({
      league: league({ auto_advance_week: false }), period: ready(), teamCount: 6, results: allDone, now,
    });
    expect(eligible).toBe(false);
    expect(why).toBe("automatic week advance is off");
  });

  it("allows only the phases the button allows", () => {
    for (const phase of FINALIZABLE_PHASES) {
      expect(advanceEligibility({
        league: league(), period: period({ phase, roster_locked: true }), teamCount: 6, results: allDone, now,
      }).eligible).toBe(true);
    }
    for (const phase of ["pre-deal", "dealt", "finalized"]) {
      expect(advanceEligibility({
        league: league(), period: period({ phase }), teamCount: 6, results: allDone, now,
      }).eligible).toBe(false);
    }
  });

  /* A WEEK IN `dealt` HAS NOT HAD ITS SCHEMES RESOLVED. Finalizing over the top of it
   * would score a week nobody actually played. */
  it("refuses to finalize a week whose schemes were never processed", () => {
    const { eligible, why } = advanceEligibility({
      league: league(), period: period({ phase: "dealt" }), teamCount: 6, results: allDone, now,
    });
    expect(eligible).toBe(false);
    expect(why).toContain("dealt");
  });

  /* THE GUARD AGAINST A WEEK OF ZEROS. finalizePeriod is legal from schemes-processed
   * and will happily commit blank stat boxes; this is what stops it. */
  it("refuses while a game of the week is still unfinished", () => {
    const { eligible, why } = advanceEligibility({
      league: league(), period: ready(), teamCount: 6, results: { "Buffalo Bills": "Win" }, now,
    });
    expect(eligible).toBe(false);
    expect(why).toContain("not finished playing");
  });

  /* THE GUARDS RUN IN COST ORDER: everything answerable from two rows is answered
   * before the feed is worth fetching, which is what keeps an hourly job polite. */
  it("asks for results only after every free guard has passed", () => {
    const first = advanceEligibility({ league: league(), period: ready(), teamCount: 6, now });
    expect(first.needsResults).toBe(true);

    for (const bad of [
      { league: league({ auto_advance_week: false }), period: ready(), teamCount: 6 },
      { league: league(), period: period({ phase: "pre-deal" }), teamCount: 6 },
      { league: league(), period: ready(), teamCount: 0 },
      { league: league(), period: period({ phase: "stats", nfl_week: null }), teamCount: 6 },
    ]) {
      expect(advanceEligibility({ ...bad, now }).needsResults).toBeUndefined();
    }
  });

  it("skips a week with no NFL week mapped rather than guessing one", () => {
    const { eligible, why } = advanceEligibility({
      league: league(), period: period({ phase: "stats", nfl_week: null }), teamCount: 6, results: allDone, now,
    });
    expect(eligible).toBe(false);
    expect(why).toContain("not mapped");
  });

  it("waits until Tuesday morning even when the football is over", () => {
    // Monday lunchtime: the week is done, the deadline is not.
    const monday = at("2026-10-19T16:00:00Z");
    expect(advanceEligibility({ league: league(), period: ready(), teamCount: 6, results: allDone, now: monday }).eligible).toBe(false);
  });
});

describe("dealWindowOpen", () => {
  const TUESDAY_MORNING = at("2026-10-20T14:00:00Z"); // Tue 10am ET
  const MONDAY_NIGHT = at("2026-10-20T03:00:00Z"); // Mon 11pm ET

  /* SCOTT ASKED FOR TUESDAY MORNING, and the commissioner very often finalizes on
   * Monday night. Dealing at the next hourly tick would hand everyone a new roster at
   * 11pm, which is not what was asked for. */
  it("does not deal on Monday night just because the week ended", () => {
    const { open } = dealWindowOpen(league(), "2026-10-20T02:00:00Z", MONDAY_NIGHT);
    expect(open).toBe(false);
  });

  it("deals on Tuesday morning, for a week that ended the night before", () => {
    const { open } = dealWindowOpen(league(), "2026-10-20T02:00:00Z", TUESDAY_MORNING);
    expect(open).toBe(true);
  });

  /* THE OTHER HALF: when the finalize itself happens on Tuesday - by the clock at 6am,
   * or by the commissioner at 10am - waiting for "the next Tuesday" would cost the
   * league a week of football. */
  it("deals in the same morning as a Tuesday finalize", () => {
    const { open } = dealWindowOpen(league(), "2026-10-20T13:00:00Z", TUESDAY_MORNING);
    expect(open).toBe(true);
  });

  it("deals for a week finalized days ago", () => {
    const { open } = dealWindowOpen(league(), "2026-10-14T02:00:00Z", at("2026-10-23T14:00:00Z"));
    expect(open).toBe(true);
  });

  /* THE FIRST WEEK OF A SEASON IS NEVER DEALT BY THE CLOCK: there is no finished week
   * behind it, and week 1 should wait for the teams to be in and the invites sent. */
  it("never opens for a league that has not finished a week yet", () => {
    expect(dealWindowOpen(league(), null, TUESDAY_MORNING).open).toBe(false);
    expect(dealWindowOpen(league(), "", TUESDAY_MORNING).open).toBe(false);
  });

  it("reads Tuesday in the league's own timezone", () => {
    // Tue 6:30am Eastern is Mon 3:30am Pacific - not Tuesday there yet.
    const early = at("2026-10-20T10:30:00Z");
    expect(dealWindowOpen(league({ tz: "America/Los_Angeles" }), "2026-10-20T09:00:00Z", early).open).toBe(false);
    const later = at("2026-10-20T14:30:00Z"); // 7:30am Pacific
    expect(dealWindowOpen(league({ tz: "America/Los_Angeles" }), "2026-10-20T09:00:00Z", later).open).toBe(true);
  });
});

describe("dealEligibility", () => {
  const now = at("2026-10-20T14:00:00Z"); // Tuesday 10am ET
  const ended = "2026-10-20T02:00:00Z"; // Monday night
  const next = (over = {}) => ({ type: "week", number: 7, phase: "pre-deal", nfl_week: 7, ...over });
  const args = (over = {}) => ({
    league: league(), next: next(), teamCount: 6, playoffsComplete: false,
    previousFinalizedAt: ended, now, ...over,
  });

  it("deals the week a finalize just created", () => {
    expect(dealEligibility(args()).eligible).toBe(true);
  });

  it("skips a league that has not opted in", () => {
    expect(dealEligibility(args({ league: league({ auto_advance_week: false }) })).eligible).toBe(false);
  });

  /* THE COMMISSIONER WHO FINALIZED HIMSELF ON MONDAY NIGHT. There is nothing left to
   * finalize, so this step has to be able to run on its own or the league is never
   * dealt at all. */
  it("deals a pre-deal week nobody just finalized", () => {
    expect(dealEligibility(args({ previousFinalizedAt: "2026-10-19T23:00:00Z" })).eligible).toBe(true);
  });

  /* THE STOP CONDITION. Nothing in the engine knows how long a regular season is, so
   * left alone an automated Tuesday would deal week 19, 20 and 21 into January.
   *
   * REACHING IT NOW MEANS SOMETHING WENT UNSET. Since OQ-16 the playoffs start
   * themselves at a week the league nominated, and finalize seeds the bracket rather
   * than opening another regular week - so a league with its playoffs configured never
   * gets here at all. A league that does left its playoff week null, and the message
   * says exactly that rather than pointing at a button that no longer exists. */
  it("stops at the end of the regular season and says why", () => {
    const { eligible, endOfSeason, why } = dealEligibility(
      args({ next: next({ number: 19, nfl_week: LAST_REGULAR_WEEK + 1 }) })
    );
    expect(eligible).toBe(false);
    expect(endOfSeason).toBe(true);
    expect(why).toContain("no playoff week set");
  });

  it("still deals week 18 itself", () => {
    expect(dealEligibility(args({ next: next({ number: 18, nfl_week: 18 }) })).eligible).toBe(true);
  });

  it("stops once a champion has been crowned", () => {
    const { eligible, why } = dealEligibility(args({ playoffsComplete: true }));
    expect(eligible).toBe(false);
    expect(why).toBe("the season is over");
  });

  /* A playoff round is still a week of football, and it IS dealt - what the clock never
   * does is decide to START the playoffs, which takes a bracket size. */
  it("deals a playoff round that the commissioner started", () => {
    expect(dealEligibility(args({
      next: { type: "playoff", number: 1, phase: "pre-deal", nfl_week: 19 }, teamCount: 4,
    })).eligible).toBe(true);
  });

  it("skips an unmapped next week rather than dealing one it cannot lock", () => {
    expect(dealEligibility(args({ next: next({ nfl_week: null }) })).eligible).toBe(false);
  });

  it("skips a week that has already been dealt", () => {
    expect(dealEligibility(args({ next: next({ phase: "dealt" }) })).eligible).toBe(false);
  });
});

/* ================================ the log line ============================= */

describe("summarize", () => {
  const out = (status, over = {}) => ({ league: "L", status, why: "because", ...over });

  it("counts an all-skipped run as a success", () => {
    const s = summarize([out("skipped"), out("skipped")]);
    expect(s.ok).toBe(true);
    expect(s.acted).toBe(0);
    expect(s.skipped).toBe(2);
    expect(s.considered).toBe(2);
  });

  it("is not ok when a league genuinely failed", () => {
    const s = summarize([out("acted"), out("failed")]);
    expect(s.ok).toBe(false);
    expect(s.failed).toBe(1);
    expect(s.acted).toBe(1);
  });

  it("keeps every league's outcome, not just the counts", () => {
    const s = summarize([out("acted", { league: "A" }), out("skipped", { league: "B" })]);
    expect(s.leagues.map((l) => l.league)).toEqual(["A", "B"]);
  });

  it("an empty run is ok and says it considered nothing", () => {
    expect(summarize([])).toMatchObject({ ok: true, considered: 0, acted: 0 });
  });
});
