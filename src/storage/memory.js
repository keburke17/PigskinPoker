/* In-memory league store - the reference implementation of the storage interface.
 *
 * It holds NORMALIZED ROWS, the same shape the Postgres schema uses, not a blob. That
 * is deliberate: it makes this the honest reference for the Supabase adapter, so the
 * operation semantics and per-row version checks are proven here before any network is
 * involved. Phase 2c's adapter swaps the row store for PostgREST and keeps everything
 * else.
 *
 * TWO WRITE GRANULARITIES, on purpose:
 *
 *   Fine-grained  - setStatLine, swapLineupSlot, submitScheme, toggleSlotLock.
 *                   These touch ONE row (or two, for a swap) and carry the version
 *                   they were based on. They are the hot path, and the reason two
 *                   people editing different things can no longer clobber each other
 *                   (P1) or resend the whole league per keystroke (P3).
 *
 *   Coarse        - dealPeriod, processSchemes, finalizePeriod, startPlayoffs.
 *                   These legitimately rewrite most of the league, so they hydrate,
 *                   run the pure engine, and re-decompose. Ids are deterministic, so
 *                   re-decomposing is stable. They serialize on the PERIOD's version,
 *                   which is the natural lock for "the week moved on".
 *
 * Every operation also asserts the period is in a phase where it is legal. That guard
 * catches what a row version cannot: a finalize landing while someone is mid-edit.
 */

import {
  dealRosters,
  finalizeCurrentPeriod,
  newSeed,
  processSchemes,
  seedFromString,
  seededRng,
  startPlayoffs,
} from "../engine/index.js";
import { decomposeLeague } from "./decompose.js";
import { hydrateLeague, vkey } from "./hydrate.js";

const clone = (o) => JSON.parse(JSON.stringify(o));

/* Which phases each operation is legal in. */
const PHASE_RULES = {
  dealPeriod: ["pre-deal"],
  submitScheme: ["dealt"],
  swapLineupSlot: ["dealt", "schemes-processed"],
  processSchemes: ["dealt"],
  setStatLine: ["schemes-processed", "stats"],
  toggleSlotLock: ["schemes-processed", "stats"],
  toggleRosterLock: ["dealt", "schemes-processed", "stats"],
  finalizePeriod: ["schemes-processed", "stats"],
};

const ok = (view) => ({ ok: true, view });
const stale = (view, key, actual) => ({ ok: false, reason: "stale", view, key, actual });
const wrongPhase = (view, phase, allowed) => ({
  ok: false,
  reason: "phase",
  view,
  phase,
  allowed,
  message:
    "This week has moved on (it is now '" + phase + "'). Your change wasn't saved.",
});

/* Tables whose rows carry an optimistic-concurrency version.
 * decompose() does not emit `version` (the database supplies it via DEFAULT 1), so the
 * store initializes it. Without this, `existing.version + 1` is NaN and - because
 * NaN !== NaN - every second write to a row looks stale. Caught by tests/operations. */
const VERSIONED = ["seasons", "teams", "players", "periods", "roster_slots", "stat_lines", "schemes", "team_totals"];

function withVersions(db) {
  if (!db) return db;
  for (const table of VERSIONED) {
    if (!db[table]) continue;
    db[table] = db[table].map((r) => (r.version == null ? { ...r, version: 1 } : r));
  }
  return db;
}

export function createMemoryStore(initialDb, opts = {}) {
  let db = initialDb ? withVersions(clone(initialDb)) : null;
  const latency = opts.latencyMs ?? 0;
  const listeners = new Set();
  // Codes stay OUT of the row tables. Phase 2b still checks them client-side, exactly
  // as the artifact did; Phase 2c moves the check into a server function and drops
  // them from the view entirely.
  let codes = opts.codes ?? { commissioner: null, teams: {} };

  const wait = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());

  function view() {
    if (!db) return null;
    const v = hydrateLeague(db);
    if (!v) return null;
    v.commissionerCode = codes.commissioner;
    v.teams.forEach((t) => {
      t.joinCode = codes.teams[t.id] ?? "";
    });
    return v;
  }

  function notify() {
    const v = view();
    listeners.forEach((fn) => {
      try {
        fn(v);
      } catch {
        /* a bad subscriber must not break a write */
      }
    });
  }

  const currentPeriodRow = () => {
    const v = view();
    return db.periods.find((p) => p.id === v._meta.periodId) ?? null;
  };

  const teamRowByLegacy = (legacyId) => db.teams.find((t) => t.legacy_id === legacyId) ?? null;
  const playerRowByLegacy = (legacyId) =>
    legacyId == null ? null : (db.players.find((p) => p.legacy_id === legacyId) ?? null);

  /** Phase + version preflight shared by every operation. */
  function preflight(opName, expect, keys) {
    const v = view();
    const period = currentPeriodRow();
    const allowed = PHASE_RULES[opName];
    if (allowed && period && !allowed.includes(period.phase)) {
      return { fail: wrongPhase(v, period.phase, allowed) };
    }
    for (const key of keys ?? []) {
      if (expect == null || expect[key] == null) continue; // caller didn't quote one
      const actual = v._meta.versions[key];
      if (actual != null && actual !== expect[key]) {
        return { fail: stale(v, key, actual) };
      }
    }
    return { v, period };
  }

  /** Replace the whole league from an engine-produced blob, preserving version counters. */
  function rewriteFromBlob(blob) {
    const previous = db;
    const next = decomposeLeague(blob, {
      leagueKey: opts.leagueKey ?? "demo",
      year: opts.year ?? 2026,
      hashCode: () => "unused-in-memory",
    });
    // Carry version counters forward, bumping anything whose content changed, so a
    // client holding a pre-deal view is correctly told it is stale.
    for (const table of Object.keys(next)) {
      const prevRows = new Map((previous?.[table] ?? []).map((r) => [r.id, r]));
      next[table] = next[table].map((row) => {
        const before = prevRows.get(row.id);
        const changed = !before || JSON.stringify({ ...before, version: 0 }) !== JSON.stringify({ ...row, version: 0 });
        return { ...row, version: (before?.version ?? 0) + (changed ? 1 : 0) || 1 };
      });
    }
    // Secrets are not derivable from the blob in memory; keep whatever we had.
    next.league_secrets = previous?.league_secrets ?? [];
    next.team_secrets = previous?.team_secrets ?? [];
    db = withVersions(next);
  }

  const store = {
    /* ------------------------------- reads ------------------------------- */
    async loadLeague() {
      await wait();
      if (opts.failLoad) throw new Error(opts.failLoad);
      return view(); // null means "no league yet" - safe to start fresh
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /* --------------------- fine-grained: the hot path -------------------- */

    async setStatLine(teamLegacyId, slot, line, expect) {
      await wait();
      const pre = preflight("setStatLine", expect, [vkey.statLine(teamLegacyId, slot)]);
      if (pre.fail) return pre.fail;

      const team = teamRowByLegacy(teamLegacyId);
      if (!team) return { ok: false, reason: "forbidden", view: view() };

      const num = (x) => (x === "" || x == null ? null : Number(x));
      const slotRow = db.roster_slots.find(
        (r) => r.period_id === pre.period.id && r.team_id === team.id && r.slot === slot
      );
      const existing = db.stat_lines.find(
        (s) => s.period_id === pre.period.id && s.team_id === team.id && s.slot === slot
      );
      const fields = {
        yards: num(line.yards),
        tds: num(line.tds),
        coach_result: line.result ?? null,
        source: "manual",
        player_id: slotRow?.player_id ?? null,
        updated_at: new Date().toISOString(),
      };
      if (existing) Object.assign(existing, fields, { version: existing.version + 1 });
      else
        db.stat_lines.push({
          id: "stat_" + pre.period.id + "_" + team.id + "_" + slot,
          period_id: pre.period.id,
          team_id: team.id,
          slot,
          version: 1,
          ...fields,
        });
      notify();
      return ok(view());
    },

    async swapLineupSlot(teamLegacyId, slot, benchIndex, expect) {
      await wait();
      const keys = [vkey.starterSlot(teamLegacyId, slot), vkey.benchSlot(teamLegacyId, benchIndex)];
      const pre = preflight("swapLineupSlot", expect, keys);
      if (pre.fail) return pre.fail;

      const team = teamRowByLegacy(teamLegacyId);
      if (!team) return { ok: false, reason: "forbidden", view: view() };

      const starter = db.roster_slots.find(
        (r) => r.period_id === pre.period.id && r.team_id === team.id && r.area === "starter" && r.slot === slot
      );
      const bench = db.roster_slots.find(
        (r) => r.period_id === pre.period.id && r.team_id === team.id && r.area === "bench" && r.bench_index === benchIndex
      );
      if (!starter || !bench) return { ok: false, reason: "forbidden", view: view() };
      if (starter.locked || bench.locked) {
        return { ok: false, reason: "locked", view: view(), message: "That player is locked." };
      }

      const tmp = starter.player_id;
      starter.player_id = bench.player_id;
      bench.player_id = tmp;
      starter.version += 1;
      bench.version += 1;
      notify();
      return ok(view());
    },

    async submitScheme(teamLegacyId, scheme, expect) {
      await wait();
      const pre = preflight("submitScheme", expect, [vkey.scheme(teamLegacyId)]);
      if (pre.fail) return pre.fail;
      if (pre.period.roster_locked) {
        return { ok: false, reason: "locked", view: view(), message: "Schemes are locked." };
      }

      const team = teamRowByLegacy(teamLegacyId);
      if (!team) return { ok: false, reason: "forbidden", view: view() };

      const existing = db.schemes.find(
        (s) => s.period_id === pre.period.id && s.team_id === team.id && s.resolved_at == null
      );
      const fields = {
        type: scheme.type,
        position: scheme.type === "noaction" ? null : scheme.position,
        player_id:
          scheme.type === "noaction" ? null : (playerRowByLegacy(scheme.playerId)?.id ?? null),
        submitted_at: scheme.submittedAt ?? new Date().toISOString(),
      };
      if (existing) Object.assign(existing, fields, { version: existing.version + 1 });
      else
        db.schemes.push({
          id: "scheme_" + pre.period.id + "_" + team.id,
          period_id: pre.period.id,
          team_id: team.id,
          resolved_at: null,
          outcome: null,
          version: 1,
          ...fields,
        });
      notify();
      return ok(view());
    },

    async toggleSlotLock(teamLegacyId, playerLegacyId, expect) {
      await wait();
      const pre = preflight("toggleSlotLock", expect, []);
      if (pre.fail) return pre.fail;
      const team = teamRowByLegacy(teamLegacyId);
      const player = playerRowByLegacy(playerLegacyId);
      if (!team || !player) return { ok: false, reason: "forbidden", view: view() };
      const row = db.roster_slots.find(
        (r) => r.period_id === pre.period.id && r.team_id === team.id && r.player_id === player.id
      );
      if (!row) return { ok: false, reason: "forbidden", view: view() };
      row.locked = !row.locked;
      row.version += 1;
      notify();
      return ok(view());
    },

    async toggleRosterLock(expect) {
      await wait();
      const pre = preflight("toggleRosterLock", expect, [vkey.period()]);
      if (pre.fail) return pre.fail;
      pre.period.roster_locked = !pre.period.roster_locked;
      pre.period.version += 1;
      notify();
      return ok(view());
    },

    /* ----------------- coarse: whole-league lifecycle ops ---------------- */

    async dealPeriod(expect) {
      await wait();
      const pre = preflight("dealPeriod", expect, [vkey.period()]);
      if (pre.fail) return pre.fail;

      const v = pre.v;
      const teamIds =
        v.currentPeriod.type === "playoff"
          ? v.playoffConfig.activeTeamIds
          : v.teams.map((t) => t.id);
      if (teamIds.length === 0) {
        return { ok: false, reason: "invalid", view: v, message: "Add at least one team before dealing rosters." };
      }

      // Seed is minted HERE, server-side in the real adapter, and stored on the period
      // so the deal can be replayed and audited - and so a client cannot re-roll it.
      const seed = newSeed();
      const rng = seededRng(seedFromString(seed));
      const result = dealRosters(v, teamIds, rng);
      if (result.error) return { ok: false, reason: "invalid", view: v, message: result.error };

      const next = clone(v);
      Object.entries(result.rosters).forEach(([teamId, roster]) => {
        const t = next.teams.find((x) => x.id === teamId);
        if (t) t.roster = roster;
      });
      next.currentPeriod.phase = "dealt";
      next.schemes = {};
      next.statsEntry = {};
      next.lockedPlayerIds = {};
      next.rosterLocked = false;
      next.activityLog.push({
        id: "act_deal_" + next.currentPeriod.type + next.currentPeriod.number,
        period: { ...next.currentPeriod },
        periodLabel:
          (next.currentPeriod.type === "playoff" ? "Playoff Round " : "Week ") + next.currentPeriod.number,
        ts: new Date().toISOString(),
        type: "deal",
        text:
          "Rosters dealt for " +
          ((next.currentPeriod.type === "playoff" ? "Playoff Round " : "Week ") + next.currentPeriod.number) +
          " (" + teamIds.length + " team" + (teamIds.length === 1 ? "" : "s") + ").",
      });

      rewriteFromBlob(next);
      const row = currentPeriodRow();
      if (row) {
        row.deal_seed = seed;
        row.dealt_at = new Date().toISOString();
      }
      notify();
      return ok(view());
    },

    async processSchemes(expect) {
      await wait();
      const pre = preflight("processSchemes", expect, [vkey.period()]);
      if (pre.fail) return pre.fail;

      const seed = newSeed();
      const next = processSchemes(pre.v, seededRng(seedFromString(seed)));
      next.currentPeriod.phase = "schemes-processed";
      next.rosterLocked = true;

      rewriteFromBlob(next);
      const row = currentPeriodRow();
      if (row) row.scheme_seed = seed;
      notify();
      return ok(view());
    },

    async finalizePeriod(expect) {
      await wait();
      const pre = preflight("finalizePeriod", expect, [vkey.period()]);
      if (pre.fail) return pre.fail;

      const result = finalizeCurrentPeriod(pre.v);
      if (result.error) return { ok: false, reason: "invalid", view: pre.v, message: result.error };
      rewriteFromBlob(result.state);
      notify();
      return ok(view());
    },

    async startPlayoffs(bracketSize, advancement, expect) {
      await wait();
      const pre = preflight("startPlayoffs", expect, [vkey.season()]);
      if (pre.fail) return pre.fail;
      rewriteFromBlob(startPlayoffs(pre.v, bracketSize, advancement));
      notify();
      return ok(view());
    },

    /* --------------------- league administration ------------------------- */

    async mutateLeague(fn) {
      // Escape hatch for the remaining commissioner admin operations (teams, player
      // pool, scoring config). These are low-frequency, single-user, and genuinely
      // league-wide; giving each its own row-level path would be ceremony without
      // benefit. They still go through decompose, so they cannot corrupt the shape.
      await wait();
      const next = clone(view());
      fn(next);
      rewriteFromBlob(next);
      notify();
      return ok(view());
    },

    /* ------------------------------- codes ------------------------------- */
    // Phase 2b: still client-checked, exactly as the artifact did. Phase 2c moves
    // verification into a server function and stops sending these to the browser.
    getCodes: () => clone(codes),
    setCommissionerCode(code) {
      codes.commissioner = code;
      notify();
    },
    setTeamJoinCode(teamLegacyId, code) {
      codes.teams[teamLegacyId] = code;
      notify();
    },

    /** Test/debug only. Not part of the interface. */
    _rows: () => clone(db),
  };

  return store;
}
