import { describe, it, expect } from "vitest";
import { rankTeamsWithTiebreak } from "../src/engine/index.js";

const row = (teamId, rawScore, tb) => ({ teamId, rawScore, tb });
const order = (ranked) => ranked.map((r) => r.teamId);
const ranks = (ranked) => ranked.map((r) => r.rank);

describe("rankTeamsWithTiebreak", () => {
  it("ranks by raw score first", () => {
    const out = rankTeamsWithTiebreak([
      row("a", 10, [0, 0, 0, 0, 0, 0]),
      row("b", 30, [0, 0, 0, 0, 0, 0]),
      row("c", 20, [0, 0, 0, 0, 0, 0]),
    ]);
    expect(order(out)).toEqual(["b", "c", "a"]);
    expect(ranks(out)).toEqual([1, 2, 3]);
  });

  /* The documented chain (RulesTab, legacy line 1784):
       Standings Points -> Week Wins -> Coach Wins -> Total TDs -> Total Yards
       -> Best single-player score
     The first five are exercised here. The sixth is OQ-A, below. */
  describe("the tiebreak chain, one level at a time", () => {
    const cases = [
      ["standings points", 0],
      ["week wins", 1],
      ["coach wins", 2],
      ["total TDs", 3],
      ["total yards", 4],
    ];
    for (const [label, idx] of cases) {
      it("breaks a tie on " + label + " when everything above is level", () => {
        const lo = [5, 5, 5, 5, 5, 5].slice();
        const hi = lo.slice();
        hi[idx] = 9; // strictly better at this level only
        const out = rankTeamsWithTiebreak([row("lo", 42, lo), row("hi", 42, hi)]);
        expect(order(out)).toEqual(["hi", "lo"]);
        expect(ranks(out)).toEqual([1, 2]);
      });
    }

    it("respects precedence: an earlier level outranks a later one", () => {
      // 'a' wins on week wins (idx 1); 'b' is far ahead on yards (idx 4) but loses.
      const out = rankTeamsWithTiebreak([
        row("a", 42, [5, 9, 0, 0, 0, 0]),
        row("b", 42, [5, 1, 99, 99, 9999, 99]),
      ]);
      expect(order(out)).toEqual(["a", "b"]);
    });
  });

  it("gives tied teams the same rank and skips the next (1224 ranking)", () => {
    const tie = [1, 1, 1, 1, 1, 1];
    const out = rankTeamsWithTiebreak([
      row("a", 50, tie.slice()),
      row("b", 50, tie.slice()),
      row("c", 40, tie.slice()),
    ]);
    expect(ranks(out)).toEqual([1, 1, 3]);
  });

  it("handles an empty field and a single team", () => {
    expect(rankTeamsWithTiebreak([])).toEqual([]);
    const one = rankTeamsWithTiebreak([row("solo", 7, [0, 0, 0, 0, 0, 0])]);
    expect(ranks(one)).toEqual([1]);
  });

  it("treats missing tiebreak entries as zero", () => {
    const out = rankTeamsWithTiebreak([row("a", 10, []), row("b", 10, [1])]);
    expect(order(out)).toEqual(["b", "a"]);
  });

  /* ===================================================================== *
   *  OQ-A - ANSWERED 2026-09-06 by Scott: the sixth tiebreaker applies.
   *
   *  Until then the comparator looped `i < 5` over a SIX-element tb array, so
   *  best single-player score never broke a tie - while the rank-grouping check
   *  compared all six. Two teams level on the first five but differing on the
   *  sixth sorted by INPUT ORDER (team creation order) yet received DIFFERENT
   *  ranks, and so different standings points.
   *
   *  The two now agree. See src/engine/standings.js and docs/OPEN-QUESTIONS.md.
   * ===================================================================== */
  describe("OQ-A: sixth tiebreaker (best single-player score)", () => {
    const worseBest = [5, 5, 5, 5, 5, 10];
    const betterBest = [5, 5, 5, 5, 5, 99];

    it("the better best-player score wins the tie, whatever the input order", () => {
      const fromWorseFirst = rankTeamsWithTiebreak([
        row("worse", 42, worseBest),
        row("better", 42, betterBest),
      ]);
      const fromBetterFirst = rankTeamsWithTiebreak([
        row("better", 42, betterBest),
        row("worse", 42, worseBest),
      ]);
      expect(order(fromWorseFirst)).toEqual(["better", "worse"]);
      expect(order(fromBetterFirst)).toEqual(["better", "worse"]);
    });

    it("team creation order no longer decides it", () => {
      // The old behaviour ranked whichever team was listed first as #1.
      const out = rankTeamsWithTiebreak([
        row("worse", 42, worseBest),
        row("better", 42, betterBest),
      ]);
      expect(ranks(out)).toEqual([1, 2]);
      expect(order(out)).toEqual(["better", "worse"]);
    });

    it("teams level on all six still share a rank", () => {
      const out = rankTeamsWithTiebreak([
        row("a", 42, worseBest),
        row("b", 42, worseBest),
      ]);
      expect(ranks(out)).toEqual([1, 1]);
    });
  });
});
