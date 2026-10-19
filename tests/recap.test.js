/* OQ-31: the weekly recap - the pure half (src/recap/). Runs anywhere.
 *
 * What these hold the recap to: its numbers ARE the week's result; it never makes up
 * what it does not know (bench points with no feed line, schemes nobody recorded); it
 * captures a steal correctly at the one moment it can; and it does not repeat a line in a
 * season. tests/server.test.js covers it being written and read back.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultState,
  dealRosters,
  deepClone,
  emptyCumulative,
  finalizeCurrentPeriod,
  processSchemes,
  seededRng,
} from "../src/engine/index.js";
import { makeDeck, recapsApply, schemeMoves, writeWeekRecaps } from "../src/recap/index.js";
import * as LINES from "../src/recap/lines.js";
import { recapPeriodId } from "../src/storage/hydrate.js";
import { createPreviewLeague } from "../src/preview/previewLeague.js";
import { freeRecapsByWeek } from "../src/preview/freeRecap.js";

const SLOTS = ["Coach", "QB", "WR", "RB", "TE", "FLEX"];

function league(teams = 8) {
  const s = createDefaultState();
  s.teams = Array.from({ length: teams }, (_, i) => ({
    id: "t" + (i + 1), name: "Team " + (i + 1), roster: null,
    cumulative: emptyCumulative(), playoffCumulative: emptyCumulative(),
  }));
  return s;
}

function deal(s, seed) {
  const res = dealRosters(s, s.teams.map((t) => t.id), seededRng(seed));
  Object.entries(res.rosters).forEach(([id, r]) => (s.teams.find((t) => t.id === id).roster = r));
  s.currentPeriod.phase = "dealt";
  return s;
}

/* Every starter gets a line; `feed` also gives the bench and everyone else one. */
function score(s, seed, { feed = true } = {}) {
  const rng = seededRng(seed);
  const lines = {};
  s.playerPool.forEach((p) => {
    lines[p.id] = p.position === "Coach"
      ? { result: rng() < 0.5 ? "Win" : "Loss" }
      : { recYards: Math.floor(rng() * 120), recTds: rng() < 0.3 ? 1 : 0, rushYards: Math.floor(rng() * 40) };
  });
  s.teams.forEach((t) => {
    s.statsEntry[t.id] = {};
    SLOTS.forEach((slot) => (s.statsEntry[t.id][slot] = lines[t.roster.starters[slot]]));
  });
  if (feed) {
    const playerWeeks = {};
    Object.entries(lines).forEach(([pid, line]) => (playerWeeks[pid] = { [s.currentPeriod.number]: line }));
    s._meta = { nflWeek: s.currentPeriod.number, playerWeeks, injuries: {} };
  } else {
    s._meta = { nflWeek: s.currentPeriod.number, playerWeeks: {}, injuries: {} };
  }
  s.currentPeriod.phase = "stats";
  return s;
}

/* One week: deal, schemes, process (recording moves), score, finalize. */
function playWeek(s, seed, schemesFor, opts) {
  deal(s, seed);
  s.schemes = schemesFor ? schemesFor(s) : {};
  const before = deepClone(s);
  let after = processSchemes(s, seededRng(seed + 1));
  const moves = schemeMoves(before, after);
  after = score(after, seed + 2, opts);
  const done = finalizeCurrentPeriod(after, seededRng(seed + 3));
  return { before: after, after: done.state, moves };
}

const starter = (s, id, slot) => s.teams.find((t) => t.id === id).roster.starters[slot];

describe("schemeMoves - what a scheme did, captured as it ran", () => {
  it("records the steal's catch, where it came from, the redraw, and the block's would-be thieves", () => {
    const s = deal(league(), 101);
    s.schemes = {
      t1: { type: "steal", position: "WR", playerId: starter(s, "t1", "WR") },
      t2: { type: "redraw", position: "RB", playerId: starter(s, "t2", "RB") },
      t3: { type: "block", position: "WR", playerId: starter(s, "t3", "WR") },
    };
    const before = deepClone(s);
    const after = processSchemes(s, seededRng(7));
    const moves = schemeMoves(before, after);

    const steal = moves.find((m) => m.teamId === "t1");
    expect(steal.type).toBe("steal");
    expect(steal.gotId).toBe(starter(after, "t1", "WR"));
    expect(steal.skipped).toBe(false);
    // It came off somebody's starters before processing - and it was not the block.
    const victim = before.teams.find((t) => t.id === steal.fromTeamId);
    expect(Object.values(victim.roster.starters)).toContain(steal.gotId);
    expect(steal.gotId).not.toBe(starter(before, "t3", "WR"));

    const redraw = moves.find((m) => m.teamId === "t2");
    expect(redraw.gotId).toBe(starter(after, "t2", "RB"));
    expect(redraw.gotId).not.toBe(redraw.playerId);

    expect(moves.find((m) => m.teamId === "t3")).toMatchObject({ type: "block", attempts: 1 });
  });
});

describe("writeWeekRecaps - the week, in words", () => {
  const week = () => {
    const s = league();
    s.currentPeriod.number = 3;
    return playWeek(s, 300, (st) => ({
      t1: { type: "steal", position: "QB", playerId: starter(st, "t1", "QB") },
      t4: { type: "block", position: "RB", playerId: starter(st, "t4", "RB") },
    }));
  };

  it("writes every team a recap whose numbers are the week's own result", () => {
    const { before, after, moves } = week();
    const { recaps, deck } = writeWeekRecaps({ before, after, moves, deckSeed: "season-1" });
    const results = after.weeklyResults.filter((r) => r.period.number === 3);
    expect(Object.keys(recaps).length).toBe(results.length);
    results.forEach((r) => {
      const recap = recaps[r.teamId];
      expect(recap.place).toBe(r.rank);
      expect(recap.score).toBe(r.rawScore);
      expect(recap.points).toBe(r.standingsPoints);
      expect(recap.week).toBe(3);
      expect(recap.headline.length).toBeGreaterThan(0);
      expect(recap.notes.length).toBeGreaterThan(0);
      expect(JSON.stringify(recap)).not.toMatch(/\{\w+\}|undefined|NaN/);
    });
    expect(Object.keys(deck.used).length).toBeGreaterThan(0);
  });

  it("never claims a team sat out its scheme when the moves were not recorded", () => {
    const { before, after } = week();
    const { recaps } = writeWeekRecaps({ before, after, moves: null, deckSeed: "s" });
    Object.values(recaps).forEach((r) => expect(r.notes.map((n) => n.title)).not.toContain("No scheme"));
  });

  it("leaves the bench out of it when nobody knows what the bench scored", () => {
    const s = league();
    const { before, after, moves } = playWeek(s, 500, null, { feed: false });
    const { recaps } = writeWeekRecaps({ before, after, moves, deckSeed: "s" });
    Object.values(recaps).forEach((r) => expect(r.notes.map((n) => n.title)).not.toContain("Bench check"));
  });

  it("does not repeat a line the saved deck already used", () => {
    const { before, after, moves } = week();
    const first = writeWeekRecaps({ before, after, moves, deckSeed: "season-1" });
    const second = writeWeekRecaps({ before, after, moves, deckSeed: "season-1", deckSaved: first.deck });
    const said = (recaps) => new Set(Object.values(recaps).flatMap((r) => [r.headline, ...r.notes.map((n) => n.text)]));
    const a = said(first.recaps);
    [...said(second.recaps)].forEach((line) => expect(a.has(line)).toBe(false));
  });

  it("applies to a season's regular weeks only", () => {
    const s = league();
    expect(recapsApply(s)).toBe(true);
    expect(recapsApply({ ...s, currentPeriod: { type: "playoff", number: 1, phase: "stats" } })).toBe(false);
    expect(recapsApply({ ...s, _meta: { mode: "table" } })).toBe(false);
  });
});

describe("the deck", () => {
  it("deals each line of a list once, then nothing", () => {
    const deck = makeDeck("x");
    const list = ["a", "b", "c"];
    const got = [deck.fresh("L", list), deck.fresh("L", list), deck.fresh("L", list)];
    expect(new Set(got).size).toBe(3);
    expect(deck.fresh("L", list)).toBeNull();
  });

  it("keeps a used line used when lines are added to its list mid-season", () => {
    const deck = makeDeck("x");
    const first = deck.fresh("L", ["a", "b"]);
    const later = makeDeck("x", deck.save());
    const dealt = [later.fresh("L", ["a", "b", "c", "d"]), later.fresh("L", ["a", "b", "c", "d"]), later.fresh("L", ["a", "b", "c", "d"])];
    expect(dealt).not.toContain(first);
  });

  it("has nothing but plain ASCII in any line, and no list too short to rotate", () => {
    Object.entries(LINES).forEach(([name, list]) => {
      if (!Array.isArray(list)) return;
      expect(list.length, name).toBeGreaterThanOrEqual(4);
      list.forEach((line) => expect(/^[\x20-\x7e]+$/.test(line), name + ": " + line).toBe(true));
    });
  });
});

describe("a whole simulated season", () => {
  it("does not repeat a single line across 12 teams and 18 weeks", () => {
    const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
    const byWeek = freeRecapsByWeek(createPreviewLeague({ played: 18, recapWeeks: weeks, seed: 1 }), weeks);
    const seen = new Set();
    weeks.forEach((w) => byWeek[w].forEach((r) => {
      [r.headline, r.story, ...(r.mvp ? [r.mvp.note] : []), ...(r.dud ? [r.dud.note] : []), ...r.notes.map((n) => n.text)].forEach((t) => {
        expect(seen.has(t), "repeated: " + t).toBe(false);
        seen.add(t);
      });
    }));
  });
});

describe("recapPeriodId - which week's recaps a read fetches", () => {
  it("is the season's latest finalized regular week, and null before the first", () => {
    const seasons = [{ id: "s1" }];
    const periods = [
      { id: "p1", season_id: "s1", type: "week", number: 1, phase: "finalized" },
      { id: "p2", season_id: "s1", type: "week", number: 2, phase: "finalized" },
      { id: "p3", season_id: "s1", type: "week", number: 3, phase: "dealt" },
      { id: "x9", season_id: "s2", type: "week", number: 9, phase: "finalized" },
    ];
    expect(recapPeriodId(seasons, periods)).toBe("p2");
    expect(recapPeriodId(seasons, periods.slice(2))).toBeNull();
  });
});
