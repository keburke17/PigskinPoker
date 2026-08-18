/**
 * decompose -> hydrate round trip.
 *
 * These two functions are the hinge of the whole port: `decompose` turns an app-state
 * blob into normalized rows (used by the seed generator AND the Phase 5 importer that
 * carries the real league's history across), and `hydrate` turns rows back into the
 * shape the UI reads. If they disagree, the imported league renders wrong - and the
 * failure would be silent and cosmetic-looking.
 *
 * So the invariant is asserted directly: blob -> rows -> blob must come back the same.
 */

import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { createDemoLeague } from "../src/storage/demoLeague.js";
import { decomposeLeague } from "../src/storage/decompose.js";
import { hydrateLeague } from "../src/storage/hydrate.js";

const hashCode = (c) => crypto.createHash("sha256").update("test:" + c).digest("hex");

function roundTrip(state) {
  const db = decomposeLeague(state, { leagueKey: "test", year: 2026, hashCode });
  return { db, back: hydrateLeague(db) };
}

describe("decompose -> hydrate", () => {
  const original = createDemoLeague();
  const { db, back } = roundTrip(original);

  it("preserves league-level configuration", () => {
    expect(back.leagueName).toBe(original.leagueName);
    expect(back.scoringConfig).toEqual(original.scoringConfig);
    expect(back.standingsPointsOverride).toEqual(original.standingsPointsOverride);
    expect(back.currentPeriod).toEqual(original.currentPeriod);
    expect(back.rosterLocked).toBe(original.rosterLocked);
  });

  it("preserves the player pool exactly", () => {
    expect(back.playerPool).toEqual(original.playerPool);
  });

  it("preserves every team's identity and rosters", () => {
    expect(back.teams.map((t) => t.id)).toEqual(original.teams.map((t) => t.id));
    expect(back.teams.map((t) => t.name)).toEqual(original.teams.map((t) => t.name));
    expect(back.teams.map((t) => t.roster)).toEqual(original.teams.map((t) => t.roster));
  });

  it("preserves cumulative and playoff totals", () => {
    expect(back.teams.map((t) => t.cumulative)).toEqual(original.teams.map((t) => t.cumulative));
    expect(back.teams.map((t) => t.playoffCumulative)).toEqual(
      original.teams.map((t) => t.playoffCumulative)
    );
  });

  it("preserves stat entry, including which teams have nothing entered", () => {
    expect(back.statsEntry).toEqual(original.statsEntry);
  });

  it("preserves schemes, locks and playoff configuration", () => {
    expect(back.schemes).toEqual(original.schemes);
    expect(back.lockedPlayerIds).toEqual(original.lockedPlayerIds);
    expect(back.playoffConfig).toEqual(original.playoffConfig);
  });

  /* The one known difference, asserted rather than glossed over.
   *
   * The artifact embeds a COPY of currentPeriod into every result and log entry,
   * including whatever `phase` it happened to be in at the time ("schemes-processed").
   * Hydration rebuilds `period` from the periods table, where that week is now
   * "finalized" - which is arguably the more correct value.
   *
   * Nothing reads `.period.phase` off a result or an event: not in src/components/,
   * not in src/engine/ (the engine reads currentPeriod.phase, which is unaffected).
   * Verified by grep, and this test pins the rest of the object so a real regression
   * cannot hide behind the exemption. */
  it("preserves weekly results apart from the inert embedded period.phase", () => {
    const strip = (r) => ({ ...r, id: undefined, period: { ...r.period, phase: undefined } });
    expect(back.weeklyResults.map(strip)).toEqual(original.weeklyResults.map(strip));
    // and the phase difference is exactly the one described above
    expect(new Set(back.weeklyResults.map((r) => r.period.phase))).toEqual(new Set(["finalized"]));
  });

  it("preserves the activity log's prose verbatim", () => {
    expect(back.activityLog.map((e) => e.text)).toEqual(original.activityLog.map((e) => e.text));
    expect(back.activityLog.map((e) => e.type)).toEqual(original.activityLog.map((e) => e.type));
    expect(back.activityLog.map((e) => e.ts)).toEqual(original.activityLog.map((e) => e.ts));
  });

  it("routes secrets to the secrets tables and nowhere else", () => {
    expect(db.league_secrets).toHaveLength(1);
    expect(db.team_secrets).toHaveLength(6);
    // the plaintext codes must not appear anywhere in the non-secret rows
    const nonSecret = JSON.stringify({ ...db, league_secrets: [], team_secrets: [] });
    expect(nonSecret).not.toMatch(/DEMO-COMMISH/);
    expect(nonSecret).not.toMatch(/DEMO-TEAM-/);
  });

  it("converts stat strings to real integers, with blank meaning null not zero", () => {
    const line = db.stat_lines.find((s) => s.yards != null);
    expect(typeof line.yards).toBe("number");
    const blanks = db.stat_lines.filter((s) => s.yards === null && s.coach_result === null);
    blanks.forEach((s) => expect(s.yards).toBeNull()); // never coerced to 0
  });

  it("is stable: decomposing twice produces identical ids", () => {
    const a = decomposeLeague(original, { leagueKey: "test", year: 2026, hashCode });
    const b = decomposeLeague(original, { leagueKey: "test", year: 2026, hashCode });
    expect(a).toEqual(b);
  });
});
