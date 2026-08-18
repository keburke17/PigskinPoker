/* Decompose an app-state blob into normalized rows.
 *
 * ONE mapping, TWO consumers:
 *   1. scripts/generate-seed.mjs - turns the demo league into supabase/seed.sql
 *   2. the Phase 5 importer      - turns the real league's Backup JSON into rows
 *
 * Writing it once is the point: the importer that carries the league's real history
 * across is exercised on every `supabase db reset` long before it touches real data.
 *
 * WHAT THE BLOB CANNOT TELL US, and how that is handled:
 *   - Only the CURRENT period has rosters, stats and schemes; the artifact wiped
 *     rosters at finalize. Historical periods are reconstructed from weeklyResults,
 *     so they get period + period_results rows but no roster_slots. That is a real
 *     and permanent gap in the imported history, not a bug here - it is the data the
 *     artifact destroyed. From the first period played on this schema, it stops.
 *   - There is no season/year in the blob (seasons did not exist). The caller supplies
 *     one; see OQ-2.
 */

import { stableUuid } from "./ids.js";

const STARTER_SLOTS = ["Coach", "QB", "WR", "RB", "TE", "FLEX"];

const periodKey = (p) => p.type + "-" + p.number;

/**
 * @param {object} state    an app-state blob (createDefaultState shape)
 * @param {object} opts
 * @param {string} opts.leagueKey   stable key for the league (e.g. 'demo')
 * @param {number} opts.year        season year
 * @param {(code: string) => string} [opts.hashCode]  required if codes are present
 */
export function decomposeLeague(state, opts) {
  const { leagueKey, year, hashCode } = opts;
  const ns = (kind) => leagueKey + ":" + kind;
  const uid = (kind, key) => stableUuid(ns(kind), key);

  const leagueId = uid("league", leagueKey);
  const seasonId = uid("season", String(year));
  const teamId = (legacy) => uid("team", legacy);
  const playerId = (legacy) => uid("player", legacy);
  const periodId = (p) => uid("period", periodKey(p));

  const out = {
    leagues: [{ id: leagueId, name: state.leagueName || "Pigskin Poker" }],
    seasons: [
      {
        id: seasonId,
        league_id: leagueId,
        year,
        label: year + " Season",
        status: "active",
        schema_version: 2,
        scoring_config: state.scoringConfig,
        standings_points_override: state.standingsPointsOverride,
        playoff_bracket_size: state.playoffConfig.bracketSize,
        playoff_advancement: state.playoffConfig.advancement,
        playoff_started: state.playoffConfig.started,
        playoff_completed: state.playoffConfig.completed,
        playoff_round_index: state.playoffConfig.currentRoundIndex,
        champion_team_id: state.playoffConfig.champion
          ? teamId(state.playoffConfig.champion)
          : null,
      },
    ],
    teams: [],
    team_totals: [],
    players: [],
    periods: [],
    roster_slots: [],
    stat_lines: [],
    schemes: [],
    period_results: [],
    events: [],
    league_secrets: [],
    team_secrets: [],
  };

  /* ---- teams and their season totals ---- */
  state.teams.forEach((t) => {
    out.teams.push({
      id: teamId(t.id),
      league_id: leagueId,
      name: t.name,
      legacy_id: t.id,
      active: true,
    });
    const totals = (cum, scope) => ({
      id: uid("totals", t.id + ":" + scope),
      season_id: seasonId,
      team_id: teamId(t.id),
      scope,
      standings_points: cum?.standingsPoints ?? 0,
      week_wins: cum?.weekWins ?? 0,
      coach_wins: cum?.coachWins ?? 0,
      total_tds: cum?.totalTDs ?? 0,
      total_yards: cum?.totalYards ?? 0,
      best_player: cum?.bestPlayer ?? null,
    });
    out.team_totals.push(totals(t.cumulative, "regular"));
    out.team_totals.push(totals(t.playoffCumulative, "playoff"));

    if (t.joinCode) {
      if (!hashCode) throw new Error("decomposeLeague: hashCode is required when join codes are present");
      out.team_secrets.push({ team_id: teamId(t.id), join_code_hash: hashCode(t.joinCode) });
    }
  });

  if (state.commissionerCode) {
    if (!hashCode) throw new Error("decomposeLeague: hashCode is required when a commissioner code is present");
    out.league_secrets.push({
      league_id: leagueId,
      commissioner_code_hash: hashCode(state.commissionerCode),
    });
  }

  /* ---- players ---- */
  state.playerPool.forEach((p) => {
    out.players.push({
      id: playerId(p.id),
      league_id: leagueId,
      name: p.name,
      position: p.position,
      nfl_team: p.team,
      status: p.status,
      external_ids: {},
      legacy_id: p.id,
      active: true,
    });
  });

  /* ---- historical periods, reconstructed from weeklyResults ---- */
  const historical = new Map();
  (state.weeklyResults || []).forEach((r) => {
    const key = periodKey(r.period);
    if (!historical.has(key)) historical.set(key, { period: r.period, rows: [] });
    historical.get(key).rows.push(r);
  });

  for (const { period, rows } of historical.values()) {
    out.periods.push({
      id: periodId(period),
      season_id: seasonId,
      type: period.type,
      number: period.number,
      phase: "finalized",
      roster_locked: true,
      participant_team_ids: rows.map((r) => teamId(r.teamId)),
      finalized_at: null,
    });
    rows.forEach((r) => {
      out.period_results.push({
        id: uid("result", r.id || periodKey(period) + ":" + r.teamId),
        period_id: periodId(period),
        team_id: teamId(r.teamId),
        rank: r.rank,
        raw_score: r.rawScore,
        standings_points: r.standingsPoints,
        coach_result: r.coachResult,
        tds: r.tds ?? 0,
        yards: r.yards ?? 0,
        best_player: r.bestPlayer ?? null,
      });
    });
  }

  /* ---- the current, in-flight period ---- */
  const cur = state.currentPeriod;
  const curKey = periodKey(cur);
  if (!historical.has(curKey)) {
    out.periods.push({
      id: periodId(cur),
      season_id: seasonId,
      type: cur.type,
      number: cur.number,
      phase: cur.phase,
      roster_locked: !!state.rosterLocked,
      participant_team_ids:
        cur.type === "playoff"
          ? (state.playoffConfig.activeTeamIds || []).map(teamId)
          : state.teams.map((t) => teamId(t.id)),
      finalized_at: null,
    });
  }
  const curPeriodId = periodId(cur);
  const locks = state.lockedPlayerIds || {};

  state.teams.forEach((t) => {
    if (!t.roster) return;
    STARTER_SLOTS.forEach((slot) => {
      const legacyPid = t.roster.starters[slot];
      out.roster_slots.push({
        id: uid("slot", curKey + ":" + t.id + ":s:" + slot),
        period_id: curPeriodId,
        team_id: teamId(t.id),
        area: "starter",
        slot,
        bench_index: null,
        player_id: legacyPid ? playerId(legacyPid) : null,
        locked: !!(legacyPid && locks[legacyPid]),
      });
    });
    t.roster.bench.forEach((legacyPid, i) => {
      out.roster_slots.push({
        id: uid("slot", curKey + ":" + t.id + ":b:" + i),
        period_id: curPeriodId,
        team_id: teamId(t.id),
        area: "bench",
        slot: null,
        bench_index: i,
        player_id: legacyPid ? playerId(legacyPid) : null,
        locked: !!(legacyPid && locks[legacyPid]),
      });
    });
  });

  /* ---- stat lines for the current period ---- */
  Object.entries(state.statsEntry || {}).forEach(([legacyTeamId, entry]) => {
    const team = state.teams.find((t) => t.id === legacyTeamId);
    Object.entries(entry || {}).forEach(([slot, line]) => {
      if (!line) return;
      const legacyPid = team?.roster?.starters?.[slot] ?? null;
      const num = (v) => (v === "" || v == null ? null : Number(v));
      out.stat_lines.push({
        id: uid("stat", curKey + ":" + legacyTeamId + ":" + slot),
        period_id: curPeriodId,
        team_id: teamId(legacyTeamId),
        slot,
        player_id: legacyPid ? playerId(legacyPid) : null,
        // The artifact stored yards/tds as STRINGS straight off the input element.
        // They become real integers here; "" becomes null, not 0.
        yards: num(line.yards),
        tds: num(line.tds),
        coach_result: line.result ?? null,
        source: "manual",
      });
    });
  });

  /* ---- unresolved schemes for the current period ---- */
  Object.entries(state.schemes || {}).forEach(([legacyTeamId, sc]) => {
    if (!sc) return;
    out.schemes.push({
      id: uid("scheme", curKey + ":" + legacyTeamId),
      period_id: curPeriodId,
      team_id: teamId(legacyTeamId),
      type: sc.type,
      position: sc.type === "noaction" ? null : sc.position,
      player_id: sc.type === "noaction" || !sc.playerId ? null : playerId(sc.playerId),
      submitted_at: sc.submittedAt || null,
      resolved_at: null,
      outcome: null,
    });
  });

  /* ---- activity log -> events (prose preserved verbatim) ---- */
  (state.activityLog || []).forEach((e, i) => {
    const known = e.period && historical.has(periodKey(e.period));
    const isCurrent = e.period && periodKey(e.period) === curKey;
    out.events.push({
      id: uid("event", e.id || "idx:" + i),
      season_id: seasonId,
      period_id: known || isCurrent ? periodId(e.period) : null,
      type: e.type,
      text: e.text,
      payload: {},
      created_at: e.ts || null,
    });
  });

  return out;
}
