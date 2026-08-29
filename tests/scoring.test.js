/* The 2026-08-28 scoring split (OQ-4c).
 *
 * Yards and touchdowns count separately as passing, rushing and receiving, each at its
 * own commissioner-editable rate. Lines recorded before the split keep the artifact's
 * combined shape and score under the old rates - tests/parity.test.js proves those still
 * match the artifact exactly; this file covers everything new.
 *
 * See docs/PHASE-4-PLAN.md section 3.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCORING,
  computeStarterPoints,
  createDefaultState,
  hasSplitStats,
  statLineTotals,
} from "../src/engine/index.js";

const state = (overrides) => ({
  scoringConfig: { ...DEFAULT_SCORING, ...(overrides || {}) },
});

describe("split scoring - the designer's defaults", () => {
  const s = state();

  it("scores a quarterback's passing at 1 point per 25 yards and 4 per TD", () => {
    // The example that drove the decision: a 300-yard, 3-TD day.
    const line = { passYards: "300", passTds: "3" };
    expect(computeStarterPoints(s, line, "QB")).toBe(12 + 12);
  });

  it("is a real reduction from what the artifact would have scored the same day", () => {
    const legacy = { yards: "300", tds: "3" };
    expect(computeStarterPoints(s, legacy, "QB")).toBe(30 + 15); // 45, the old rule
    expect(computeStarterPoints(s, { passYards: "300", passTds: "3" }, "QB")).toBe(24);
  });

  it("scores receiving at 1 per 10 and 6 per TD", () => {
    expect(computeStarterPoints(s, { recYards: "120", recTds: "1" }, "WR")).toBe(12 + 6);
  });

  it("scores rushing at 1 per 10 and 6 per TD", () => {
    expect(computeStarterPoints(s, { rushYards: "94", rushTds: "2" }, "RB")).toBe(9 + 12);
  });

  it("adds a quarterback's rushing on top of his passing", () => {
    const line = { passYards: "250", passTds: "2", rushYards: "40", rushTds: "1" };
    expect(computeStarterPoints(s, line, "QB")).toBe(10 + 8 + 4 + 6);
  });

  it("counts a back's receiving yards alongside his rushing", () => {
    const line = { rushYards: "60", rushTds: "1", recYards: "30" };
    expect(computeStarterPoints(s, line, "RB")).toBe(6 + 6 + 3);
  });

  it("brings a quarterback and a good receiver into the same range", () => {
    const qb = computeStarterPoints(s, { passYards: "300", passTds: "3" }, "QB");
    const wr = computeStarterPoints(s, { recYards: "120", recTds: "1" }, "WR");
    expect(Math.abs(qb - wr)).toBeLessThanOrEqual(10);
  });
});

describe("split scoring - the rules around the edges", () => {
  const s = state();

  it("floors each category on its own, because the rates differ", () => {
    /* 15 rushing plus 15 receiving is 1 + 1, not 3. Yards at different rates cannot be
     * added before dividing, and rushing and receiving only share a rate by default. */
    expect(computeStarterPoints(s, { rushYards: "15", recYards: "15" }, "RB")).toBe(2);
  });

  it("scores a starter who did not play as zero", () => {
    // The designer's answer: a blank line is a bad break, not an exemption.
    expect(computeStarterPoints(s, { passYards: "0", passTds: "0" }, "QB")).toBe(0);
    expect(computeStarterPoints(s, {}, "QB")).toBe(0);
    expect(computeStarterPoints(s, null, "QB")).toBe(0);
  });

  it("treats an explicit zero as entered, and an empty box as not", () => {
    expect(hasSplitStats({ passYards: "0" })).toBe(true);
    expect(hasSplitStats({ passYards: "" })).toBe(false);
    expect(hasSplitStats({ yards: "80", tds: "1" })).toBe(false);
    expect(hasSplitStats(null)).toBe(false);
  });

  it("leaves the Coach slot exactly as it was", () => {
    expect(computeStarterPoints(s, { result: "Win" }, "Coach")).toBe(2);
    expect(computeStarterPoints(s, { result: "Tie" }, "Coach")).toBe(1);
    expect(computeStarterPoints(s, { result: "Loss" }, "Coach")).toBe(0);
    expect(computeStarterPoints(s, { result: null }, "Coach")).toBe(0);
  });
});

describe("split scoring - the rates are the commissioner's", () => {
  it("honours a custom passing rate", () => {
    const s = state({ passYardsPerPoint: 50 });
    expect(computeStarterPoints(s, { passYards: "300" }, "QB")).toBe(6);
  });

  it("honours custom touchdown values, including zero", () => {
    const s = state({ pointsPerPassTD: 0, pointsPerRecTD: 10 });
    expect(computeStarterPoints(s, { passTds: "4" }, "QB")).toBe(0);
    expect(computeStarterPoints(s, { recTds: "1" }, "WR")).toBe(10);
  });

  it("falls back to the defaults for a config stored before the split", () => {
    // An existing league's scoring_config has only the artifact's keys. It must score
    // new lines sensibly rather than dividing by undefined.
    const stale = { scoringConfig: { yardsPerPoint: 10, pointsPerTD: 5, coachWin: 2, coachTie: 1, coachLoss: 0 } };
    expect(computeStarterPoints(stale, { passYards: "300", passTds: "3" }, "QB")).toBe(24);
  });

  it("ignores a nonsense yards rate rather than dividing by zero", () => {
    const s = state({ recYardsPerPoint: 0 });
    expect(computeStarterPoints(s, { recYards: "100" }, "WR")).toBe(10);
  });
});

describe("statLineTotals - what the tiebreakers count", () => {
  it("combines every category for a split line", () => {
    const line = { passYards: "250", rushYards: "40", recYards: "10", passTds: "2", rushTds: "1" };
    expect(statLineTotals(line)).toEqual({ yards: 300, tds: 3 });
  });

  it("reads a legacy line unchanged, so Total Yards keeps its meaning", () => {
    expect(statLineTotals({ yards: "300", tds: "3" })).toEqual({ yards: 300, tds: 3 });
  });

  it("is zero for a missing or empty line", () => {
    expect(statLineTotals(null)).toEqual({ yards: 0, tds: 0 });
    expect(statLineTotals({})).toEqual({ yards: 0, tds: 0 });
  });
});

describe("the defaults that ship", () => {
  it("are the values the designer chose on 2026-08-28", () => {
    const cfg = createDefaultState().scoringConfig;
    expect(cfg.passYardsPerPoint).toBe(25);
    expect(cfg.rushYardsPerPoint).toBe(10);
    expect(cfg.recYardsPerPoint).toBe(10);
    expect(cfg.pointsPerPassTD).toBe(4);
    expect(cfg.pointsPerRushTD).toBe(6);
    expect(cfg.pointsPerRecTD).toBe(6);
  });

  it("still carry the artifact's rule for lines recorded before the split", () => {
    const cfg = createDefaultState().scoringConfig;
    expect(cfg.yardsPerPoint).toBe(10);
    expect(cfg.pointsPerTD).toBe(5);
  });
});
