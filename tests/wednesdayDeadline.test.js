/* OQ-40 (Scott, 2026-11-24): in a week with a Wednesday game, schemes process at 3am
 * Wednesday instead of 3am Thursday. Every other week is unchanged. */
import { describe, expect, it } from "vitest";
import {
  CYCLE_DEADLINES,
  WEDNESDAY_SCHEME_DEADLINE,
  hasWednesdayGame,
  schemeDeadlineFor,
  schemeDeadlineWords,
  wednesdayDeadlineNote,
} from "../src/engine/weeklyClock.js";
import { reminderEligibility, schemesEligibility } from "../server/autoCycle.js";

const ET = "America/New_York";
/* NFL Week 12, 2026: a Wednesday night game, then Thanksgiving. */
const WED_WEEK = {
  "Dallas Cowboys": { at: "2026-11-26T01:15:00Z", opp: "NYG", home: true }, // Wed 8:15pm ET
  "New York Giants": { at: "2026-11-26T01:15:00Z", opp: "DAL", home: false },
  "Detroit Lions": { at: "2026-11-26T17:30:00Z", opp: "CHI", home: true }, // Thu 12:30pm ET
  "Kansas City Chiefs": { at: "2026-11-29T18:00:00Z", opp: "DEN", home: true }, // Sun
};
const NORMAL_WEEK = {
  "Dallas Cowboys": { at: "2026-12-04T01:15:00Z", opp: "NYG", home: true }, // Thu 8:15pm ET
  "Kansas City Chiefs": { at: "2026-12-06T18:00:00Z", opp: "DEN", home: true },
};
const TUESDAY_DEAL = "2026-11-24T11:05:00Z"; // Tue 6:05am ET

describe("which weeks have a Wednesday game", () => {
  it("sees the Wednesday night game", () => {
    expect(hasWednesdayGame(WED_WEEK, ET)).toBe(true);
  });
  it("an ordinary Thursday / Sunday / Monday week has none", () => {
    expect(hasWednesdayGame(NORMAL_WEEK, ET)).toBe(false);
  });
  it("reads the old bare-timestamp kickoff shape too", () => {
    expect(hasWednesdayGame({ "Dallas Cowboys": "2026-11-26T01:15:00Z" }, ET)).toBe(true);
  });
  it("no schedule read means no Wednesday game", () => {
    expect(hasWednesdayGame({}, ET)).toBe(false);
    expect(hasWednesdayGame(null, ET)).toBe(false);
  });
  it("judges the day in the league's own zone", () => {
    // Wed 8:15pm ET is Wed 5:15pm in Los Angeles - still a Wednesday game there.
    expect(hasWednesdayGame(WED_WEEK, "America/Los_Angeles")).toBe(true);
  });
});

describe("the scheme deadline", () => {
  it("is Thursday 3am in an ordinary week", () => {
    expect(schemeDeadlineFor({ kickoffs: NORMAL_WEEK, tz: ET, dealtAt: TUESDAY_DEAL })).toEqual(CYCLE_DEADLINES.schemes);
  });
  it("is Wednesday 3am in a Wednesday-game week dealt on the Tuesday", () => {
    expect(schemeDeadlineFor({ kickoffs: WED_WEEK, tz: ET, dealtAt: TUESDAY_DEAL })).toEqual(WEDNESDAY_SCHEME_DEADLINE);
  });
  it("is Wednesday 3am before the week is dealt", () => {
    expect(schemeDeadlineFor({ kickoffs: WED_WEEK, tz: ET, dealtAt: null })).toEqual(WEDNESDAY_SCHEME_DEADLINE);
  });
  it("falls back to Thursday 3am for a Wednesday-game week dealt late on the Wednesday", () => {
    expect(schemeDeadlineFor({ kickoffs: WED_WEEK, tz: ET, dealtAt: "2026-11-25T15:00:00Z" })).toEqual(CYCLE_DEADLINES.schemes);
  });
  it("a deal in the small hours of Wednesday still closes at Wednesday 3am", () => {
    expect(schemeDeadlineFor({ kickoffs: WED_WEEK, tz: ET, dealtAt: "2026-11-25T06:00:00Z" })).toEqual(WEDNESDAY_SCHEME_DEADLINE);
  });
});

describe("what the screens say", () => {
  const view = (kickoffs, dealtAt = TUESDAY_DEAL) => ({
    _meta: { kickoffs, tz: ET, dealtAt, autoProcessSchemes: true },
  });
  it("names Wednesday in a Wednesday-game week", () => {
    expect(schemeDeadlineWords(view(WED_WEEK), Date.parse(TUESDAY_DEAL))).toMatch(/^Wednesday 3am/);
    expect(wednesdayDeadlineNote(view(WED_WEEK))).toMatch(/Wednesday game.*Wednesday 3am instead of Thursday/);
  });
  it("says nothing extra in an ordinary week", () => {
    expect(schemeDeadlineWords(view(NORMAL_WEEK), Date.parse(TUESDAY_DEAL))).toMatch(/^Thursday 3am/);
    expect(wednesdayDeadlineNote(view(NORMAL_WEEK))).toBeNull();
  });
  it("owns up to a late deal", () => {
    expect(wednesdayDeadlineNote(view(WED_WEEK, "2026-11-25T15:00:00Z"))).toMatch(/dealt late.*Thursday 3am/);
  });
});

describe("the clock", () => {
  const league = { auto_process_schemes: true, notify_members: true, tz: ET };
  const period = { phase: "dealt", dealt_at: TUESDAY_DEAL, kickoffs: WED_WEEK };

  it("processes a Wednesday-game week at 3am Wednesday", () => {
    expect(schemesEligibility({ league, period, teamCount: 6, now: Date.parse("2026-11-25T08:30:00Z") }).eligible).toBe(true);
  });
  it("but not at 2am Wednesday", () => {
    expect(schemesEligibility({ league, period, teamCount: 6, now: Date.parse("2026-11-25T07:30:00Z") }).eligible).toBe(false);
  });
  it("an ordinary week still waits for Thursday", () => {
    const normal = { ...period, kickoffs: NORMAL_WEEK };
    expect(schemesEligibility({ league, period: normal, teamCount: 6, now: Date.parse("2026-11-25T08:30:00Z") }).eligible).toBe(false);
  });
  it("the reminder moves with it, to 3pm Tuesday", () => {
    const r = reminderEligibility({ league, period, now: Date.parse("2026-11-24T20:30:00Z") }); // Tue 3:30pm ET
    expect(r.eligible).toBe(true);
    expect(new Date(r.at).toISOString()).toBe("2026-11-25T08:00:00.000Z");
  });
});
