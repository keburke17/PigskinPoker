import { describe, it, expect } from "vitest";
import {
  dealRosters,
  finalizeCurrentPeriod,
  playoffWeekSpan,
  playoffsDueToStart,
  savePlayoffSettings,
  seededRng,
  startPlayoffs,
} from "../src/engine/index.js";
import { baseState, dealtState, fillStats, team } from "./helpers/fixtures.js";

const RNG = (n = 1) => seededRng(1000 + n);

/** Give teams distinct season standings so the bracket order is knowable. */
function withSeasonTotals(s, pointsByTeam) {
  Object.entries(pointsByTeam).forEach(([id, pts]) => {
    team(s, id).cumulative.standingsPoints = pts;
  });
  return s;
}

/** Deal, fill stats, finalize - one whole period. */
function playPeriod(s, seed) {
  const ids =
    s.currentPeriod.type === "playoff" ? s.playoffConfig.activeTeamIds : s.teams.map((t) => t.id);
  const dealt = dealRosters(s, ids, seededRng(seed));
  if (dealt.error) throw new Error(dealt.error);
  Object.entries(dealt.rosters).forEach(([id, roster]) => {
    team(s, id).roster = roster;
  });
  s.currentPeriod.phase = "dealt";
  fillStats(s, ids, seed + 1);
  const res = finalizeCurrentPeriod(s, seededRng(seed + 2));
  if (res.error) throw new Error(res.error);
  return res.state;
}

describe("startPlayoffs", () => {
  it("seeds the bracket by season standings, best first", () => {
    let s = baseState(6);
    s = withSeasonTotals(s, {
      team_0: 5,
      team_1: 40,
      team_2: 12,
      team_3: 33,
      team_4: 1,
      team_5: 27,
    });
    const next = startPlayoffs(s, 4, [4, 2, 1], RNG());
    expect(next.playoffConfig.activeTeamIds).toEqual(["team_1", "team_3", "team_5", "team_2"]);
    expect(next.playoffConfig.started).toBe(true);
    expect(next.playoffConfig.completed).toBe(false);
    expect(next.playoffConfig.champion).toBeNull();
  });

  it("moves to Playoff Round 1 and clears period working state", () => {
    const s = baseState(4);
    const next = startPlayoffs(s, 4, [4, 2, 1], RNG());
    expect(next.currentPeriod).toEqual({ type: "playoff", number: 1, phase: "pre-deal" });
    expect(next.schemes).toEqual({});
    expect(next.statsEntry).toEqual({});
    expect(next.lockedPlayerIds).toEqual({});
    expect(next.rosterLocked).toBe(false);
  });

  it("resets playoff cumulative totals for every team but keeps season totals", () => {
    let s = baseState(4);
    s = withSeasonTotals(s, { team_0: 20 });
    team(s, "team_0").playoffCumulative.standingsPoints = 99;
    const next = startPlayoffs(s, 4, [4, 2, 1], RNG());
    expect(team(next, "team_0").playoffCumulative.standingsPoints).toBe(0);
    expect(team(next, "team_0").cumulative.standingsPoints).toBe(20); // frozen, not wiped
  });

  it("logs the bracket", () => {
    const s = baseState(4);
    const next = startPlayoffs(s, 4, [4, 2, 1], RNG());
    const log = next.activityLog.find((e) => e.type === "playoffs-start");
    expect(log.text).toMatch(/Playoffs started!/);
    expect(log.text).toMatch(/Bracket \(4\)/);
  });
});

describe("playoff advancement", () => {
  it("cuts the field each round and crowns a champion (4 -> 2 -> 1)", () => {
    let s = dealtState(6, 20);
    s.teams.forEach((t) => (t.roster = null));
    s = withSeasonTotals(s, {
      team_0: 6,
      team_1: 5,
      team_2: 4,
      team_3: 3,
      team_4: 2,
      team_5: 1,
    });
    s = startPlayoffs(s, 4, [4, 2, 1], RNG());
    expect(s.playoffConfig.activeTeamIds).toHaveLength(4);

    // Round 1 -> 2 survivors
    s = playPeriod(s, 200);
    expect(s.playoffConfig.completed).toBe(false);
    expect(s.playoffConfig.activeTeamIds).toHaveLength(2);
    expect(s.playoffConfig.currentRoundIndex).toBe(1);
    expect(s.currentPeriod).toEqual({ type: "playoff", number: 2, phase: "pre-deal" });
    const advance = s.activityLog.find((e) => e.type === "advance");
    expect(advance.text).toMatch(/Advancing to Playoff Round 2/);

    // Round 2 -> champion (the last team never plays a round alone)
    s = playPeriod(s, 300);
    expect(s.playoffConfig.completed).toBe(true);
    expect(s.playoffConfig.champion).toBeTruthy();
    expect(s.playoffConfig.activeTeamIds).toHaveLength(2); // frozen at the final field

    const champLog = s.activityLog.find((e) => e.type === "champion");
    expect(champLog.text).toMatch(/wins the Pigskin Poker championship!/);
    const champ = team(s, s.playoffConfig.champion);
    expect(champLog.text).toContain(champ.name);
  });

  it("crowns the winner of the only round when advancement is [2, 1]", () => {
    let s = baseState(4);
    s = withSeasonTotals(s, { team_0: 9, team_1: 8, team_2: 2, team_3: 1 });
    s = startPlayoffs(s, 2, [2, 1], RNG());
    expect(s.playoffConfig.activeTeamIds).toEqual(["team_0", "team_1"]);
    s = playPeriod(s, 400);
    expect(s.playoffConfig.completed).toBe(true);
    expect(["team_0", "team_1"]).toContain(s.playoffConfig.champion);
  });

  it("scores playoff rounds into playoffCumulative, leaving season totals frozen", () => {
    let s = baseState(4);
    s = withSeasonTotals(s, { team_0: 50, team_1: 40, team_2: 30, team_3: 20 });
    s = startPlayoffs(s, 4, [4, 2, 1], RNG());
    const seasonBefore = s.teams.map((t) => t.cumulative.standingsPoints);
    s = playPeriod(s, 500);
    expect(s.teams.map((t) => t.cumulative.standingsPoints)).toEqual(seasonBefore);
    const anyPlayoffPoints = s.teams.some((t) => t.playoffCumulative.standingsPoints > 0);
    expect(anyPlayoffPoints).toBe(true);
  });

  it("labels playoff periods as rounds, not weeks", () => {
    let s = baseState(4);
    s = startPlayoffs(s, 4, [4, 2, 1], RNG());
    s = playPeriod(s, 600);
    const result = s.weeklyResults.find((r) => r.period.type === "playoff");
    expect(result.periodLabel).toBe("Playoff Round 1");
  });

  it("only finalizes the teams still alive in the bracket", () => {
    let s = baseState(6);
    s = withSeasonTotals(s, {
      team_0: 6, team_1: 5, team_2: 4, team_3: 3, team_4: 2, team_5: 1,
    });
    s = startPlayoffs(s, 4, [4, 2, 1], RNG());
    s = playPeriod(s, 700);
    const scored = s.weeklyResults.filter((r) => r.period.type === "playoff");
    expect(scored).toHaveLength(4); // the two eliminated teams produced no rows
    expect(scored.map((r) => r.teamId)).not.toContain("team_5");
  });
});


/* ===================================================================== *
 * OQ-16, answered by Scott on 2026-09-07: the playoffs start themselves.
 *
 * The Start Playoffs button is gone. A league nominates the NFL week its bracket takes
 * over, and finalize seeds it when that week arrives - whichever hand finalized the week
 * before, the commissioner's on Monday night or the clock's at 6am Tuesday.
 *
 * WHY IT HAD TO CHANGE, in Scott's words: "week 15 would end, new rosters would
 * automatically be dealt out at 6 am tuesday morning for week 16 to all teams in the
 * league. then if the commish hit start playoffs the rosters are already dealt, and
 * multiple teams that are not in playoff contention would have rosters. which shouldnt
 * happen."
 * ===================================================================== */

/** A state that believes it is playing a given NFL week. `_meta` is server-owned and
 *  absent from the artifact's shape - see src/storage/hydrate.js - so the tests set it
 *  the same way hydrate does. */
function atNflWeek(s, week) {
  s._meta = Object.assign({}, s._meta, { nflWeek: week });
  return s;
}

describe("playoffsDueToStart", () => {
  const cfg = (over) => {
    const s = baseState(4);
    s.playoffConfig = Object.assign({}, s.playoffConfig, over);
    return s;
  };

  it("is never due when the league has not nominated a week", () => {
    /* The trap the setup checklist exists to catch: null is "never", not "soon". */
    expect(playoffsDueToStart(cfg({ startNflWeek: null }), 18)).toBe(false);
    expect(playoffsDueToStart(cfg({ startNflWeek: null }), 23)).toBe(false);
  });

  it("waits until the nominated week comes round", () => {
    const s = cfg({ startNflWeek: 16 });
    expect(playoffsDueToStart(s, 14)).toBe(false);
    expect(playoffsDueToStart(s, 15)).toBe(false);
    expect(playoffsDueToStart(s, 16)).toBe(true);
  });

  it("still fires if the week was somehow overshot", () => {
    /* A league that set the week late, or a period that skipped one. Better to start the
     * bracket a week behind than to sail past it and never start at all. */
    expect(playoffsDueToStart(cfg({ startNflWeek: 16 }), 17)).toBe(true);
  });

  it("does not restart a bracket that is already running or finished", () => {
    expect(playoffsDueToStart(cfg({ startNflWeek: 16, started: true }), 17)).toBe(false);
    expect(playoffsDueToStart(cfg({ startNflWeek: 16, completed: true }), 17)).toBe(false);
  });

  it("says no when the league cannot say which week of football it is playing", () => {
    /* An unmapped season. Guessing would seed a bracket off a week nobody played. */
    expect(playoffsDueToStart(cfg({ startNflWeek: 16 }), null)).toBe(false);
  });
});

describe("finalize starts the playoffs when the week arrives", () => {
  const league = () => {
    let s = baseState(6);
    s = withSeasonTotals(s, {
      team_0: 5, team_1: 40, team_2: 12, team_3: 33, team_4: 1, team_5: 27,
    });
    s.playoffConfig = Object.assign({}, s.playoffConfig, {
      startNflWeek: 16,
      bracketSize: 4,
      advancement: [4, 2, 1],
    });
    return s;
  };

  it("opens an ordinary week when the playoffs are still ahead", () => {
    const s = atNflWeek(league(), 14);
    const next = playPeriod(s, 501);
    expect(next.currentPeriod.type).toBe("week");
    expect(next.playoffConfig.started).toBe(false);
  });

  it("seeds the bracket instead of dealing week 16", () => {
    /* Finalizing NFL week 15 - the next week would be 16, which is the nominated one. */
    const s = atNflWeek(league(), 15);
    const next = playPeriod(s, 502);
    expect(next.currentPeriod).toEqual({ type: "playoff", number: 1, phase: "pre-deal" });
    expect(next.playoffConfig.started).toBe(true);
    expect(next.playoffConfig.activeTeamIds).toHaveLength(4);
  });

  it("leaves the teams who missed the cut with no roster at all", () => {
    /* THE WHOLE POINT. Under the button, week 16 was dealt to all six teams before
     * anyone could press it. Here the two who missed out are simply not in the bracket,
     * and nothing was dealt to anybody yet. */
    const s = atNflWeek(league(), 15);
    const next = playPeriod(s, 503);
    const inBracket = next.playoffConfig.activeTeamIds;
    expect(inBracket).not.toContain("team_4");
    expect(inBracket).not.toContain("team_0");
    next.teams.forEach((t) => expect(t.roster).toBeNull());
  });

  it("keeps playing regular weeks for a league that never set a week", () => {
    const s = atNflWeek(league(), 15);
    s.playoffConfig.startNflWeek = null;
    const next = playPeriod(s, 504);
    expect(next.currentPeriod.type).toBe("week");
    expect(next.playoffConfig.started).toBe(false);
  });

  it("does not need the bracket to be as big as the league", () => {
    const s = atNflWeek(league(), 15);
    s.playoffConfig.bracketSize = 20;
    s.playoffConfig.advancement = [20, 10, 5, 1];
    const next = playPeriod(s, 505);
    /* Clamped to the teams that exist rather than refusing to start the season's end. */
    expect(next.playoffConfig.activeTeamIds).toHaveLength(6);
  });
});

describe("savePlayoffSettings", () => {
  const s = () => baseState(6);

  it("stores a week, a bracket size and a ladder", () => {
    const next = savePlayoffSettings(s(), { startNflWeek: 16, bracketSize: 4, advancement: [4, 2, 1] });
    expect(next.playoffConfig.startNflWeek).toBe(16);
    expect(next.playoffConfig.bracketSize).toBe(4);
    expect(next.playoffConfig.advancement).toEqual([4, 2, 1]);
    /* Saving settings must not start anything - that is the entire separation. */
    expect(next.playoffConfig.started).toBe(false);
  });

  it("accepts a blank week, meaning the league has not decided yet", () => {
    const next = savePlayoffSettings(s(), { startNflWeek: "", bracketSize: 4, advancement: [4, 2, 1] });
    expect(next.playoffConfig.startNflWeek).toBeNull();
  });

  it("refuses a week that is not an NFL week", () => {
    expect(savePlayoffSettings(s(), { startNflWeek: 0, bracketSize: 4, advancement: [4, 2, 1] }).error).toBeTruthy();
    expect(savePlayoffSettings(s(), { startNflWeek: 24, bracketSize: 4, advancement: [4, 2, 1] }).error).toBeTruthy();
    expect(savePlayoffSettings(s(), { startNflWeek: 2.5, bracketSize: 4, advancement: [4, 2, 1] }).error).toBeTruthy();
  });

  it("refuses a ladder that does not open with the bracket size", () => {
    const r = savePlayoffSettings(s(), { startNflWeek: 16, bracketSize: 8, advancement: [4, 2, 1] });
    expect(r.error).toMatch(/open with the bracket size/);
  });

  it("refuses a ladder that does not end at one champion", () => {
    const r = savePlayoffSettings(s(), { startNflWeek: 16, bracketSize: 8, advancement: [8, 4, 2] });
    expect(r.error).toMatch(/end at 1/);
  });

  it("refuses a round that is not smaller than the one before it", () => {
    const r = savePlayoffSettings(s(), { startNflWeek: 16, bracketSize: 8, advancement: [8, 8, 1] });
    expect(r.error).toMatch(/smaller than the one before/);
  });

  it("refuses to move the goalposts once the bracket is running", () => {
    const live = s();
    live.playoffConfig.started = true;
    const r = savePlayoffSettings(live, { startNflWeek: 16, bracketSize: 4, advancement: [4, 2, 1] });
    expect(r.error).toMatch(/already started/);
  });
});

describe("playoffWeekSpan", () => {
  it("counts Scott's own example as three weeks, not four", () => {
    /* "if there are 8 teams making playoffs and the format is 8, 4, 2 ,1 you would need
     * at least 3 weeks of playoffs to be played" - nobody plays a round to stay champion. */
    expect(playoffWeekSpan(16, [8, 4, 2, 1])).toEqual({ rounds: 3, firstWeek: 16, lastWeek: 18 });
  });

  it("handles a straight final", () => {
    expect(playoffWeekSpan(18, [2, 1])).toEqual({ rounds: 1, firstWeek: 18, lastWeek: 18 });
  });

  it("has nothing to say without a week or a ladder", () => {
    expect(playoffWeekSpan(null, [4, 2, 1])).toBeNull();
    expect(playoffWeekSpan(16, [])).toBeNull();
    expect(playoffWeekSpan(16, [1])).toBeNull();
  });
});
