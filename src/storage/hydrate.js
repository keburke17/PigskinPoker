/* Hydrate normalized rows into the view the UI reads.
 *
 * The inverse of decompose.js, and THE decision that keeps this port tractable:
 * `hydrate()` returns an object structurally identical to createDefaultState() -
 * state.teams[].roster.starters.QB, state.playerPool, state.currentPeriod, and so on.
 *
 * That means the ~90 components extracted in Phase 1 keep reading exactly what they
 * read in the artifact and do not get rewritten. Only the WRITE path changed: the
 * blanket `update(s => ...)` is gone, replaced by named operations that each touch one
 * thing. Without this, decomposing the schema would have cascaded into rewriting the
 * entire UI.
 *
 * The view is DERIVED on every read. There is no blob stored anywhere.
 *
 * SECURITY (Phase 2c): this view NEVER carries the commissioner code or any team's join
 * code. The artifact kept both inside the league blob, so every visitor's browser
 * downloaded all of them (P2). They now live hashed in tables the publishable key
 * cannot read, and are verified server-side. All the view exposes is whether a code has
 * been set, which is what the UI actually needs to decide what to render.
 */

import { emptyCumulative } from "../engine/index.js";

const STARTER_SLOTS = ["Coach", "QB", "WR", "RB", "TE", "FLEX"];

const byId = (rows) => new Map(rows.map((r) => [r.id, r]));

/* Version keys. One namespace, used by both the view and the store, so a caller can
 * only ever quote a version for a thing that actually exists. */
export const vkey = {
  period: () => "period",
  season: () => "season",
  statLine: (teamId, slot) => "stat:" + teamId + ":" + slot,
  starterSlot: (teamId, slot) => "slot:" + teamId + ":s:" + slot,
  benchSlot: (teamId, i) => "slot:" + teamId + ":b:" + i,
  scheme: (teamId) => "scheme:" + teamId,
};

function buildVersionMap(db, season, current, slotsForCurrent, teamLegacy) {
  const legacy = (uuid) => teamLegacy.get(uuid) ?? null;
  const versions = { season: season.version ?? 1 };
  /* IDENTITY-QUALIFIED ON PURPOSE.
   * A bare integer here is unsafe: finalizing a week makes the *current period* a
   * different row, and a fresh row also starts at version 1. A client holding "period
   * v1" for Week 2 would then match Week 3's v1 and its stale write would be accepted.
   * Encoding the period's identity alongside its version closes that. The value is
   * opaque and only ever compared for equality. Caught by tests/operations.test.js. */
  if (current) versions.period = current.type + "-" + current.number + "#" + (current.version ?? 1);

  slotsForCurrent.forEach((r) => {
    const t = legacy(r.team_id);
    if (!t) return;
    const key = r.area === "starter" ? vkey.starterSlot(t, r.slot) : vkey.benchSlot(t, r.bench_index);
    versions[key] = r.version ?? 1;
  });

  if (current) {
    db.stat_lines
      .filter((s) => s.period_id === current.id)
      .forEach((s) => {
        const t = legacy(s.team_id);
        if (t) versions[vkey.statLine(t, s.slot)] = s.version ?? 1;
      });
    db.schemes
      .filter((s) => s.period_id === current.id && s.resolved_at == null)
      .forEach((s) => {
        const t = legacy(s.team_id);
        if (t) versions[vkey.scheme(t)] = s.version ?? 1;
      });
  }
  return versions;
}

/**
 * @param {object} db  normalized tables, as produced by decompose.js
 * @param {object} [opts]
 * @param {string} [opts.seasonId]  which season to hydrate (defaults to the only one)
 */
export function hydrateLeague(db, opts = {}) {
  const league = db.leagues[0];
  const season = opts.seasonId
    ? db.seasons.find((s) => s.id === opts.seasonId)
    : db.seasons[0];
  if (!league || !season) return null;

  const teamRows = db.teams.filter((t) => t.league_id === league.id && t.active);
  const playerRows = db.players.filter((p) => p.league_id === league.id && p.active);

  // Legacy ids are what the engine and UI use as player/team identity.
  const playerLegacy = new Map(playerRows.map((p) => [p.id, p.legacy_id]));
  const teamLegacy = new Map(teamRows.map((t) => [t.id, t.legacy_id]));
  const legacyOf = (uuid, map) => (uuid == null ? null : (map.get(uuid) ?? null));

  const periodRows = db.periods
    .filter((p) => p.season_id === season.id)
    .slice()
    .sort((a, b) => (a.type === b.type ? a.number - b.number : a.type === "week" ? -1 : 1));

  // The current period is the one that has not been finalized; if all are finalized,
  // the most recent. Mirrors the artifact's single `currentPeriod`.
  const current =
    periodRows.find((p) => p.phase !== "finalized") ?? periodRows[periodRows.length - 1];

  const slotsForCurrent = current
    ? db.roster_slots.filter((r) => r.period_id === current.id)
    : [];

  /* ---- teams, with the current period's roster attached ---- */
  const totalsFor = (teamId, scope) =>
    db.team_totals.find(
      (t) => t.season_id === season.id && t.team_id === teamId && t.scope === scope
    );

  const toCumulative = (row) =>
    row
      ? {
          standingsPoints: row.standings_points,
          weekWins: row.week_wins,
          coachWins: row.coach_wins,
          totalTDs: row.total_tds,
          totalYards: row.total_yards,
          bestPlayer: row.best_player ?? null,
        }
      : emptyCumulative();

  const teams = teamRows.map((t) => {
    const mine = slotsForCurrent.filter((r) => r.team_id === t.id);
    let roster = null;
    if (mine.length) {
      const starters = {};
      STARTER_SLOTS.forEach((slot) => {
        const row = mine.find((r) => r.area === "starter" && r.slot === slot);
        starters[slot] = row ? legacyOf(row.player_id, playerLegacy) : null;
      });
      const bench = [null, null, null, null, null, null];
      mine
        .filter((r) => r.area === "bench")
        .forEach((r) => {
          bench[r.bench_index] = legacyOf(r.player_id, playerLegacy);
        });
      roster = { starters, bench };
    }
    return {
      id: t.legacy_id,
      name: t.name,
      hasJoinCode: !!(t.has_join_code ?? t.hasJoinCode), // never the code itself
      roster,
      cumulative: toCumulative(totalsFor(t.id, "regular")),
      playoffCumulative: toCumulative(totalsFor(t.id, "playoff")),
    };
  });

  /* ---- locked players (the artifact keyed these by player, we key by slot) ---- */
  const lockedPlayerIds = {};
  slotsForCurrent.forEach((r) => {
    if (r.locked && r.player_id) {
      const legacy = legacyOf(r.player_id, playerLegacy);
      if (legacy) lockedPlayerIds[legacy] = true;
    }
  });

  /* ---- stats for the current period ---- */
  const statsEntry = {};
  if (current) {
    db.stat_lines
      .filter((s) => s.period_id === current.id)
      .forEach((s) => {
        const teamKey = legacyOf(s.team_id, teamLegacy);
        if (!teamKey) return;
        if (!statsEntry[teamKey]) statsEntry[teamKey] = {};
        statsEntry[teamKey][s.slot] =
          s.slot === "Coach" || s.coach_result != null
            ? { result: s.coach_result ?? null }
            : {
                // Back to strings: the inputs are controlled and the artifact's
                // scoring coerces with Number(). Keeps the UI byte-identical.
                yards: s.yards == null ? "" : String(s.yards),
                tds: s.tds == null ? "" : String(s.tds),
              };
      });
  }

  /* ---- unresolved schemes for the current period ---- */
  const schemes = {};
  if (current) {
    db.schemes
      .filter((s) => s.period_id === current.id && s.resolved_at == null)
      .forEach((s) => {
        const teamKey = legacyOf(s.team_id, teamLegacy);
        if (!teamKey) return;
        schemes[teamKey] = {
          type: s.type,
          position: s.position ?? null,
          playerId: legacyOf(s.player_id, playerLegacy),
          submittedAt: s.submitted_at ?? null,
        };
      });
  }

  /* ---- finalized results ---- */
  const periodById = byId(periodRows);
  const weeklyResults = db.period_results
    .filter((r) => periodById.has(r.period_id))
    .map((r) => {
      const p = periodById.get(r.period_id);
      const period = { type: p.type, number: p.number, phase: "finalized" };
      const teamKey = legacyOf(r.team_id, teamLegacy);
      return {
        id: r.id,
        period,
        periodLabel: (p.type === "playoff" ? "Playoff Round " : "Week ") + p.number,
        teamId: teamKey,
        teamName: teamRows.find((t) => t.id === r.team_id)?.name ?? "",
        rank: r.rank,
        rawScore: r.raw_score,
        standingsPoints: r.standings_points,
        coachResult: r.coach_result,
        tds: r.tds,
        yards: r.yards,
        bestPlayer: r.best_player ?? null,
      };
    })
    .sort((a, b) => a.period.number - b.period.number || a.rank - b.rank);

  /* ---- activity log ---- */
  const activityLog = db.events
    .filter((e) => e.season_id === season.id)
    .slice()
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
    .map((e) => {
      const p = e.period_id ? periodById.get(e.period_id) : null;
      return {
        id: e.id,
        period: p ? { type: p.type, number: p.number, phase: p.phase } : null,
        periodLabel: p ? (p.type === "playoff" ? "Playoff Round " : "Week ") + p.number : "",
        ts: e.created_at,
        type: e.type,
        text: e.text,
      };
    });

  return {
    schemaVersion: season.schema_version,
    leagueName: league.name,
    commissionerCodeSet: !!(league.has_commissioner_code ?? league.commissionerCodeSet),
    teams,
    playerPool: playerRows.map((p) => ({
      id: p.legacy_id,
      name: p.name,
      position: p.position,
      team: p.nfl_team,
      status: p.status,
    })),
    scoringConfig: season.scoring_config,
    standingsPointsOverride: season.standings_points_override ?? null,
    currentPeriod: current
      ? { type: current.type, number: current.number, phase: current.phase }
      : { type: "week", number: 1, phase: "pre-deal" },
    schemes,
    rosterLocked: current ? current.roster_locked : false,
    lockedPlayerIds,
    statsEntry,
    weeklyResults,
    activityLog,
    playoffConfig: {
      bracketSize: season.playoff_bracket_size,
      advancement: season.playoff_advancement,
      started: season.playoff_started,
      completed: season.playoff_completed,
      currentRoundIndex: season.playoff_round_index,
      activeTeamIds:
        current && current.type === "playoff"
          ? (current.participant_team_ids || []).map((id) => legacyOf(id, teamLegacy)).filter(Boolean)
          : (periodRows.filter((p) => p.type === "playoff").slice(-1)[0]?.participant_team_ids || [])
              .map((id) => legacyOf(id, teamLegacy))
              .filter(Boolean),
      champion: season.champion_team_id ? legacyOf(season.champion_team_id, teamLegacy) : null,
    },
    /* Not part of the artifact's shape. Callers never build `expect` by hand - they
     * pass the version from the view they acted on, so "every write carries the version
     * it was based on" is structural rather than something to remember. */
    _meta: {
      leagueId: league.id,
      seasonId: season.id,
      periodId: current?.id ?? null,
      versions: buildVersionMap(db, season, current, slotsForCurrent, teamLegacy),
    },
  };
}
