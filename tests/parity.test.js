/**
 * PARITY WITH THE ORIGINAL ARTIFACT.
 *
 * This is the test that proves the Phase 1 move did not change the game.
 *
 * It lifts the pure-JS region of LegacyProject/PigskinPokerCode.jsx (lines 242-857 -
 * everything from TEAM_ROWS through startPlayoffs, stopping before the first JSX
 * component) into a temporary ES module, imports it, and runs it head-to-head against
 * src/engine/ on identical seeds.
 *
 * The legacy code calls Math.random() directly, so we monkeypatch the global with the
 * same seeded generator we hand to the new engine. Both then consume the same random
 * stream in the same order, and any behavioural drift shows up as a JSON mismatch.
 *
 * If this file ever fails, the engine has diverged from the original. That is either a
 * bug you just introduced, or a deliberate rule change - and a deliberate rule change
 * needs the original designer's sign-off (see docs/OPEN-QUESTIONS.md) plus an update
 * here explaining what changed and why.
 *
 * LegacyProject/ is kept in the repo untouched precisely so this test can exist.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as N from "../src/engine/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_SRC = path.join(ROOT, "LegacyProject", "PigskinPokerCode.jsx");

/** First line of TEAM_ROWS and last line of startPlayoffs, inclusive. */
const PURE_REGION = [242, 857];

let L; // the legacy module
const realRandom = Math.random;

beforeAll(async () => {
  const lines = fs.readFileSync(LEGACY_SRC, "utf8").split("\n");
  const body = lines.slice(PURE_REGION[0] - 1, PURE_REGION[1]).join("\n");

  // Guard: if the region ever picks up JSX, fail loudly rather than mysteriously.
  expect(body).not.toMatch(/<\/[A-Za-z]|\/>/);
  expect(body).toMatch(/^const TEAM_ROWS = \[/);
  expect(body).toMatch(/function startPlayoffs\(/);

  const exports = `
export { generatePlayerPool, shuffle, uid, deepClone, emptyCumulative, periodLabel,
  createDefaultState, dealRosters, processSchemes, computeStarterPoints,
  currentStandingsPointsArray, rankTeamsWithTiebreak, finalizeCurrentPeriod,
  seasonStandingsRows, startPlayoffs };
`;
  const tmp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "pigskin-parity-")),
    "legacy.mjs"
  );
  fs.writeFileSync(tmp, body + "\n" + exports);
  L = await import(/* @vite-ignore */ "file://" + tmp);
});

afterEach(() => {
  Math.random = realRandom;
  vi.useRealTimers();
});

/** Freeze the clock so uid()/nowStamp() agree across both engines. */
function freezeClock() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
}

const teamsFor = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: "team_" + i,
    name: "Team " + String.fromCharCode(65 + i),
    joinCode: "",
    roster: null,
    cumulative: {
      standingsPoints: 0, weekWins: 0, coachWins: 0,
      totalTDs: 0, totalYards: 0, bestPlayer: null,
    },
    playoffCumulative: {
      standingsPoints: 0, weekWins: 0, coachWins: 0,
      totalTDs: 0, totalYards: 0, bestPlayer: null,
    },
  }));

function legacyState(n) {
  const s = L.createDefaultState();
  s.teams = teamsFor(n);
  return s;
}

const SEEDS = [1, 7, 42, 1337, 99999];

describe("parity with the original artifact", () => {
  it("generates an identical player pool", () => {
    expect(N.generatePlayerPool()).toEqual(L.generatePlayerPool());
  });

  it("produces an identical default state shape", () => {
    const a = L.createDefaultState();
    const b = N.createDefaultState();
    expect(b).toEqual(a);
    expect(b.schemaVersion).toBe(1);
  });

  describe("dealRosters", () => {
    for (const seed of SEEDS) {
      it("matches on seed " + seed, () => {
        const s = legacyState(6);
        const ids = s.teams.map((t) => t.id);
        Math.random = N.seededRng(seed);
        const legacy = L.dealRosters(s, ids);
        const next = N.dealRosters(s, ids, N.seededRng(seed));
        expect(next).toEqual(legacy);
      });
    }

    for (const pos of ["Coach", "QB", "TE", "WR", "RB"]) {
      it("matches the pool-exhaustion error for " + pos, () => {
        const s = legacyState(6);
        s.playerPool.forEach((p) => {
          if (p.position === pos) p.status = "OUT";
        });
        const ids = s.teams.map((t) => t.id);
        Math.random = N.seededRng(5);
        const legacy = L.dealRosters(s, ids);
        const next = N.dealRosters(s, ids, N.seededRng(5));
        expect(next).toEqual(legacy);
        expect(next.error).toBe(legacy.error); // exact string, not just shape
      });
    }
  });

  describe("processSchemes", () => {
    function dealtFixture(seed, n = 6) {
      const s = legacyState(n);
      Math.random = N.seededRng(seed);
      const r = L.dealRosters(s, s.teams.map((t) => t.id));
      Object.entries(r.rosters).forEach(([id, ro]) => {
        s.teams.find((t) => t.id === id).roster = ro;
      });
      s.currentPeriod.phase = "dealt";
      return s;
    }

    for (const seed of SEEDS) {
      it("matches a mixed scheme round on seed " + seed, () => {
        freezeClock();
        const s = dealtFixture(seed);
        const st = (id, slot) => s.teams.find((t) => t.id === id).roster.starters[slot];
        s.schemes = {
          team_0: { type: "block", position: "QB", playerId: st("team_0", "QB"), submittedAt: "x" },
          team_1: { type: "steal", position: "QB", playerId: st("team_1", "QB"), submittedAt: "x" },
          team_2: { type: "redraw", position: "WR", playerId: st("team_2", "WR"), submittedAt: "x" },
          team_3: { type: "noaction", position: null, playerId: null, submittedAt: "x" },
          team_4: { type: "steal", position: "TE", playerId: st("team_4", "TE"), submittedAt: "x" },
        };
        Math.random = N.seededRng(seed + 1000);
        const legacy = L.processSchemes(s);
        const next = N.processSchemes(s, N.seededRng(seed + 1000));
        expect(next).toEqual(legacy);
      });
    }

    it("matches the no-victim path when every target is blocked", () => {
      freezeClock();
      const s = dealtFixture(11, 3);
      const qb = (id) => s.teams.find((t) => t.id === id).roster.starters.QB;
      s.schemes = {
        team_0: { type: "steal", position: "QB", playerId: qb("team_0"), submittedAt: "x" },
        team_1: { type: "block", position: "QB", playerId: qb("team_1"), submittedAt: "x" },
        team_2: { type: "block", position: "QB", playerId: qb("team_2"), submittedAt: "x" },
      };
      Math.random = N.seededRng(77);
      const legacy = L.processSchemes(s);
      const next = N.processSchemes(s, N.seededRng(77));
      expect(next).toEqual(legacy);
    });

    it("matches the empty free-agent-pool path on a redraw", () => {
      freezeClock();
      const s = dealtFixture(21, 3);
      const rostered = new Set();
      s.teams.forEach((t) => {
        Object.values(t.roster.starters).forEach((i) => i && rostered.add(i));
        t.roster.bench.forEach((i) => i && rostered.add(i));
      });
      s.playerPool.forEach((p) => {
        if (p.position === "TE" && !rostered.has(p.id)) p.status = "OUT";
      });
      s.schemes = {
        team_0: {
          type: "redraw", position: "TE",
          playerId: s.teams[0].roster.starters.TE, submittedAt: "x",
        },
      };
      Math.random = N.seededRng(88);
      const legacy = L.processSchemes(s);
      const next = N.processSchemes(s, N.seededRng(88));
      expect(next).toEqual(legacy);
    });
  });

  it("ranks identically across the whole tiebreak chain", () => {
    const rows = [
      { teamId: "a", rawScore: 50, tb: [10, 2, 3, 5, 400, 22] },
      { teamId: "b", rawScore: 50, tb: [10, 2, 3, 5, 400, 31] }, // differs only on tb[5] (OQ-A)
      { teamId: "c", rawScore: 50, tb: [10, 2, 3, 5, 390, 40] },
      { teamId: "d", rawScore: 60, tb: [1, 0, 0, 0, 0, 0] },
      { teamId: "e", rawScore: 50, tb: [10, 2, 3, 5, 400, 22] }, // exact duplicate of a
      { teamId: "f", rawScore: 50, tb: [10, 2, 1, 9, 999, 5] },
    ];
    expect(N.rankTeamsWithTiebreak(rows)).toEqual(L.rankTeamsWithTiebreak(rows));
  });

  it("scores starters identically, including coach results and rounding", () => {
    const state = { scoringConfig: { yardsPerPoint: 10, pointsPerTD: 5, coachWin: 2, coachTie: 1, coachLoss: 0 } };
    const cases = [
      [{ yards: "127", tds: "2" }, "QB"],
      [{ yards: "9", tds: "0" }, "WR"],
      [{ yards: "", tds: "" }, "RB"],
      [{ result: "Win" }, "Coach"],
      [{ result: "Tie" }, "Coach"],
      [{ result: "Loss" }, "Coach"],
      [{ result: null }, "Coach"],
      [null, "TE"],
    ];
    for (const [line, pos] of cases) {
      expect(N.computeStarterPoints(state, line, pos)).toBe(
        L.computeStarterPoints(state, line, pos)
      );
    }
  });

  /* The end-to-end proof: a whole season, both engines, compared as one object. */
  for (const SEED of [42, 2024]) {
    it("plays a full season identically (5 weeks + playoffs to a champion), seed " + SEED, () => {
      freezeClock();

      const fillStats = (E, s, seed) => {
        const rng = N.seededRng(seed);
        const ids =
          s.currentPeriod.type === "playoff"
            ? s.playoffConfig.activeTeamIds
            : s.teams.map((t) => t.id);
        s.statsEntry = {};
        ids.forEach((tid) => {
          const t = s.teams.find((x) => x.id === tid);
          if (!t || !t.roster) return;
          const entry = {};
          ["Coach", "QB", "WR", "RB", "TE", "FLEX"].forEach((slot) => {
            const p = s.playerPool.find((pp) => pp.id === t.roster.starters[slot]);
            if (!p) return;
            entry[slot] =
              p.position === "Coach"
                ? { result: ["Win", "Loss", "Tie"][Math.floor(rng() * 3)] }
                : { yards: String(Math.floor(rng() * 140)), tds: String(Math.floor(rng() * 4)) };
          });
          s.statsEntry[tid] = entry;
        });
      };

      const play = (E, isLegacy) => {
        let st = E.createDefaultState();
        st.teams = teamsFor(6);
        const R = (n) => N.seededRng(SEED + n);

        for (let wk = 1; wk <= 5; wk++) {
          if (isLegacy) Math.random = R(wk);
          const d = isLegacy
            ? E.dealRosters(st, st.teams.map((t) => t.id))
            : E.dealRosters(st, st.teams.map((t) => t.id), R(wk));
          Object.entries(d.rosters).forEach(([id, ro]) => {
            st.teams.find((t) => t.id === id).roster = ro;
          });
          st.currentPeriod.phase = "dealt";
          const sl = (id, slot) => st.teams.find((t) => t.id === id).roster.starters[slot];
          st.schemes = {
            team_0: { type: "block", position: "QB", playerId: sl("team_0", "QB"), submittedAt: "x" },
            team_1: { type: "steal", position: "QB", playerId: sl("team_1", "QB"), submittedAt: "x" },
            team_2: { type: "redraw", position: "WR", playerId: sl("team_2", "WR"), submittedAt: "x" },
            team_3: { type: "noaction", position: null, playerId: null, submittedAt: "x" },
          };
          if (isLegacy) Math.random = R(wk + 500);
          st = isLegacy ? E.processSchemes(st) : E.processSchemes(st, R(wk + 500));
          st.currentPeriod.phase = "schemes-processed";
          st.rosterLocked = true;
          fillStats(E, st, SEED + wk);
          if (isLegacy) Math.random = R(wk + 900);
          const f = isLegacy
            ? E.finalizeCurrentPeriod(st)
            : E.finalizeCurrentPeriod(st, R(wk + 900));
          st = f.state;
        }

        if (isLegacy) Math.random = R(7000);
        st = isLegacy
          ? E.startPlayoffs(st, 4, [4, 2, 1])
          : E.startPlayoffs(st, 4, [4, 2, 1], R(7000));

        let guard = 0;
        while (!st.playoffConfig.completed && guard++ < 10) {
          const ids = st.playoffConfig.activeTeamIds;
          if (isLegacy) Math.random = R(8000 + guard);
          const d = isLegacy ? E.dealRosters(st, ids) : E.dealRosters(st, ids, R(8000 + guard));
          Object.entries(d.rosters).forEach(([id, ro]) => {
            st.teams.find((t) => t.id === id).roster = ro;
          });
          st.currentPeriod.phase = "dealt";
          fillStats(E, st, SEED + 8000 + guard);
          if (isLegacy) Math.random = R(9000 + guard);
          const f = isLegacy
            ? E.finalizeCurrentPeriod(st)
            : E.finalizeCurrentPeriod(st, R(9000 + guard));
          st = f.state;
        }
        return st;
      };

      const legacyEnd = play(L, true);
      const newEnd = play(N, false);

      // Sanity: the simulation actually reached a champion.
      expect(legacyEnd.playoffConfig.completed).toBe(true);
      expect(legacyEnd.playoffConfig.champion).toBeTruthy();
      expect(legacyEnd.weeklyResults.length).toBeGreaterThan(30);

      expect(newEnd).toEqual(legacyEnd);
      expect(newEnd.playoffConfig.champion).toBe(legacyEnd.playoffConfig.champion);
    });
  }
});
