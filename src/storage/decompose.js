/* Decompose an app-state blob into normalized rows.
 *
 * ONE mapping, TWO consumers:
 *   1. scripts/generate-seed.mjs - turns the demo league into supabase/seed.sql
 *   2. backup restore            - turns an exported Backup JSON into rows
 *
 * Writing it once is the point: the restore path is exercised on every
 * `supabase db reset`, long before anyone relies on it with a real league.
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
import { splitColumnsFor } from "./statLine.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Keep an id that is ALREADY a database uuid; otherwise derive a stable one.
 *
 * Without this, re-decomposing a league that came back through hydrate() re-hashes
 * each existing uuid into a DIFFERENT uuid, so the same natural key (period, team)
 * arrives with a new id and the upsert collides with the row already there. Caught by
 * tests/server.test.js on the second lifecycle write. */
const keepOrDerive = (existing, derive) => (UUID_RE.test(existing ?? "") ? existing : derive());

const STARTER_SLOTS = ["Coach", "QB", "WR", "RB", "TE", "FLEX"];

const periodKey = (p) => p.type + "-" + p.number;

/**
 * @param {object} state    an app-state blob (createDefaultState shape)
 * @param {object} opts
 * @param {string} opts.leagueKey   stable key for the league (e.g. 'demo')
 * @param {number} opts.year        season year
 * @param {string} [opts.newPlayerSource] 'seed' (default) for generated/restored pools a
 *   refresh may replace; 'manual' when a person is adding the player, which makes the
 *   pool refresh leave it alone forever.
 */
export function decomposeLeague(state, opts) {
  const { leagueKey, year, existing, newPlayerSource = "seed" } = opts;
  const ns = (kind) => leagueKey + ":" + kind;
  const uid = (kind, key) => stableUuid(ns(kind), key);

  /* ------------------------------------------------------------------------
   * IDENTITY: PRESERVE, THEN DERIVE.
   *
   * Derived ids are a function of `leagueKey`, so two callers passing different
   * leagueKeys for the SAME league produce different ids for every row. When that
   * happened, persisting an edit inserted a whole new league and deleted the old one -
   * cascading away its memberships, i.e. permanently locking the
   * commissioner out of their own league on the first "Add Team".
   *
   * The demo league never hit it because "demo" was hardcoded on both sides, which is
   * exactly why a green test suite missed it. So identity no longer depends on callers
   * agreeing: when a row already exists, its id is looked up by NATURAL KEY and reused.
   * Derivation is only ever the fallback for genuinely new rows.
   * --------------------------------------------------------------------- */
  const prev = existing || {};
  const uuidToTeamLegacy = new Map((prev.teams ?? []).map((t) => [t.id, t.legacy_id]));
  const uuidToPeriodKey = new Map((prev.periods ?? []).map((p) => [p.id, p.type + "-" + p.number]));

  const known = {
    league: prev.leagues?.[0]?.id ?? null,
    season: new Map((prev.seasons ?? []).map((s) => [String(s.year), s.id])),
    team: new Map((prev.teams ?? []).map((t) => [t.legacy_id, t.id])),
    player: new Map((prev.players ?? []).map((p) => [p.legacy_id, p.id])),
    playerRow: new Map((prev.players ?? []).map((p) => [p.legacy_id, p])),
    period: new Map((prev.periods ?? []).map((p) => [p.type + "-" + p.number, p.id])),
    totals: new Map(
      (prev.team_totals ?? []).map((t) => [uuidToTeamLegacy.get(t.team_id) + ":" + t.scope, t.id])
    ),
    slot: new Map(
      (prev.roster_slots ?? []).map((r) => [
        uuidToPeriodKey.get(r.period_id) + ":" + uuidToTeamLegacy.get(r.team_id) +
          ":" + (r.area === "starter" ? "s:" + r.slot : "b:" + r.bench_index),
        r.id,
      ])
    ),
    stat: new Map(
      (prev.stat_lines ?? []).map((r) => [
        uuidToPeriodKey.get(r.period_id) + ":" + uuidToTeamLegacy.get(r.team_id) + ":" + r.slot,
        r.id,
      ])
    ),
    scheme: new Map(
      (prev.schemes ?? []).map((r) => [
        uuidToPeriodKey.get(r.period_id) + ":" + uuidToTeamLegacy.get(r.team_id),
        r.id,
      ])
    ),
    result: new Map(
      (prev.period_results ?? []).map((r) => [
        uuidToPeriodKey.get(r.period_id) + ":" + uuidToTeamLegacy.get(r.team_id),
        r.id,
      ])
    ),
  };

  const leagueId = known.league ?? uid("league", leagueKey);
  const seasonId = known.season.get(String(year)) ?? uid("season", String(year));
  const teamId = (legacy) => known.team.get(legacy) ?? uid("team", legacy);
  const playerId = (legacy) => known.player.get(legacy) ?? uid("player", legacy);
  const knownPlayerRow = known.playerRow;
  const periodId = (p) => known.period.get(periodKey(p)) ?? uid("period", periodKey(p));

  const out = {
    leagues: [
      {
        id: leagueId,
        name: state.leagueName || "Pigskin Poker",
      },
    ],
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
      id: known.totals.get(t.id + ":" + scope) ?? uid("totals", t.id + ":" + scope),
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
  });

  /* ---- players ----
   *
   * THIS PATH IS THE HUMAN ONE. A blob write only ever comes from the commissioner's own
   * screens; the pool refresh writes through server/operations.js and never through here.
   * So a status that differs from the row already in the database is, by construction, a
   * decision somebody made - and it is recorded as such, which is what stops the next
   * refresh from quietly putting it back. Found by setting a player OUT in the running
   * app on 2026-08-28 and watching the feed's rule fail to protect it.
   *
   * `newPlayerSource` distinguishes the two callers that create players from nothing:
   * the demo seed generator (rows that a refresh may replace) from a commissioner adding
   * a player by hand (rows it must never touch). */
  state.playerPool.forEach((p) => {
    const before = knownPlayerRow.get(p.id);
    const statusChanged = before ? before.status !== p.status : false;
    out.players.push({
      id: playerId(p.id),
      league_id: leagueId,
      name: p.name,
      position: p.position,
      nfl_team: p.team,
      status: p.status,
      source: before ? before.source : newPlayerSource,
      status_source: statusChanged ? "manual" : (before?.status_source ?? "default"),
      /* PRESERVED, NOT RESET. The app-state blob has no field for a player's provider
       * ids, so writing `{}` here - as this did until 2026-08-28 - silently cleared
       * them on every ordinary pool edit, and the next stats pull would have had
       * nothing to match on. They are carried forward from the row already in the
       * database instead. A genuinely new player has none yet, which is correct. */
      external_ids: knownPlayerRow.get(p.id)?.external_ids ?? {},
      /* Carried, not reset. The commissioner CAN clear this from his own screen - the
       * Restore button on a retired player - so the blob's value wins when it has one,
       * and the row already in the database fills in for a caller that has never heard
       * of the field. Resetting it to false here would un-retire the whole pool on the
       * first ordinary edit. */
      retired: p.retired ?? knownPlayerRow.get(p.id)?.retired ?? false,
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
        // Natural key is (period, team) - never the engine's random result id.
        id:
          known.result.get(periodKey(period) + ":" + r.teamId) ??
          keepOrDerive(r.id, () => uid("result", periodKey(period) + ":" + r.teamId)),
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
        id:
          known.slot.get(curKey + ":" + t.id + ":s:" + slot) ??
          uid("slot", curKey + ":" + t.id + ":s:" + slot),
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
        id:
          known.slot.get(curKey + ":" + t.id + ":b:" + i) ??
          uid("slot", curKey + ":" + t.id + ":b:" + i),
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
        id:
          known.stat.get(curKey + ":" + legacyTeamId + ":" + slot) ??
          uid("stat", curKey + ":" + legacyTeamId + ":" + slot),
        period_id: curPeriodId,
        team_id: teamId(legacyTeamId),
        slot,
        player_id: legacyPid ? playerId(legacyPid) : null,
        // The artifact stored yards/tds as STRINGS straight off the input element.
        // They become real integers here; "" becomes null, not 0.
        //
        // Both shapes are carried: the six per-category columns for anything entered
        // since the 2026-08-28 split, and the combined pair for anything recorded
        // before it. A line only ever has one or the other - the entry UI drops the
        // combined keys the moment a category is typed into.
        ...splitColumnsFor(line),
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
      id: known.scheme.get(curKey + ":" + legacyTeamId) ?? uid("scheme", curKey + ":" + legacyTeamId),
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
      id: keepOrDerive(e.id, () => uid("event", e.id || "idx:" + i)),
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
