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

import { SEAT, SEAT_STATES, emptyCumulative, normalizeLineupLock } from "../engine/index.js";
import { SPLIT_COLUMN, SPLIT_STAT_FIELDS } from "./statLine.js";

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
/* OQ-28. player_week_lines rows -> { [legacyPlayerId]: { [nflWeek]: line } }. */
function playerWeeksFrom(rows, seasonId, playerLegacy) {
  const out = {};
  for (const r of rows) {
    if (r.season_id !== seasonId) continue;
    const pid = playerLegacy.get(r.player_id);
    if (!pid) continue;
    const line = r.coach_result ? { result: r.coach_result } : {};
    if (!r.coach_result) {
      SPLIT_STAT_FIELDS.forEach((field) => {
        const v = r[SPLIT_COLUMN[field]];
        line[field] = v == null ? "" : Number(v);
      });
    }
    (out[pid] || (out[pid] = {}))[r.nfl_week] = line;
  }
  return out;
}

/* OQ-32. players rows -> { [legacyPlayerId]: depthRank }, leaving out anyone without one. */
function depthRanksFrom(playerRows) {
  const out = {};
  for (const p of playerRows) {
    const rank = Number(p.depth_rank);
    if (p.depth_rank != null && Number.isFinite(rank) && rank >= 1) out[p.legacy_id] = rank;
  }
  return out;
}

/* OQ-29. player_injuries rows -> { [legacyPlayerId]: { [nflWeek]: report } }. */
function injuriesFrom(rows, seasonId, playerLegacy) {
  const out = {};
  for (const r of rows) {
    if (r.season_id !== seasonId) continue;
    const pid = playerLegacy.get(r.player_id);
    if (!pid) continue;
    (out[pid] || (out[pid] = {}))[r.nfl_week] = {
      status: r.game_status || null,
      injury: r.injury || null,
      practice: r.practice && typeof r.practice === "object" ? r.practice : {},
      reportDate: r.report_date || null,
      updatedAt: r.updated_at || null,
    };
  }
  return out;
}

/* Issue #75. Everything a table knows, in the `_meta` shape src/engine/table.js reads.
 * A season gets `mode: "season"` and nothing else, so no season screen can trip over it.
 *
 * WHO IS IN THE HAND. Before the deal it is whoever is seated now, so the dealer sees the
 * hand form as people sit down and get up. From the deal on it is the snapshot the deal
 * wrote to `participant_team_ids` - so a player who sits out or leaves mid-hand still
 * plays out the hand they were dealt, and somebody who joins mid-hand waits for the next. */
function tableMeta(league, teamRows, current, teamLegacy) {
  if (league.mode !== "table") return { mode: "season" };
  const seats = {};
  teamRows.forEach((t) => {
    seats[t.legacy_id] = SEAT_STATES.includes(t.seat) ? t.seat : SEAT.SEATED;
  });
  const dealt = current && current.phase !== "pre-deal";
  const seatedTeamIds = dealt
    ? (current.participant_team_ids || []).map((id) => teamLegacy.get(id)).filter(Boolean)
    : teamRows.filter((t) => seats[t.legacy_id] === SEAT.SEATED).map((t) => t.legacy_id);
  return { mode: "table", tableSeats: league.table_seats ?? null, seats, seatedTeamIds };
}

/**
 * OQ-31. Which period's weekly recaps a read should fetch: the season's most recently
 * finalized regular week, or null before the first one. Both readers (the browser's
 * storage/supabase.js and the server's league.js) ask this before they fetch, so the
 * league read carries one week of recaps - twelve small rows - not a season of them.
 */
export function recapPeriodId(seasons, periods, seasonId) {
  const season = seasonId ? (seasons || []).find((s) => s.id === seasonId) : (seasons || [])[0];
  if (!season) return null;
  const done = (periods || [])
    .filter((p) => p.season_id === season.id && p.type === "week" && p.phase === "finalized")
    .sort((a, b) => b.number - a.number);
  return done.length ? done[0].id : null;
}

/* weekly_recaps rows -> { week, byTeam: { [legacyTeamId]: recap } }, or null. */
function recapsFrom(rows, periodRows, teamLegacy) {
  if (!rows || !rows.length) return null;
  const period = periodRows.find((p) => p.id === rows[0].period_id);
  if (!period) return null;
  const byTeam = {};
  for (const r of rows) {
    if (r.period_id !== period.id) continue;
    const id = teamLegacy.get(r.team_id);
    if (id && r.recap && typeof r.recap === "object") byTeam[id] = r.recap;
  }
  return { week: period.number, byTeam };
}

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
  /* Yards and TDs split into passing / rushing / receiving on 2026-08-28 (OQ-4c). A row
   * written before that has only the combined columns and is handed back in the old
   * shape, which is what makes the engine score it under the old rates. A row written
   * since carries the six split columns and nothing combined. Either way the values go
   * back as STRINGS: the inputs are controlled and the scoring coerces with Number(). */
  const statLineFromRow = (s) => {
    const split = {};
    let any = false;
    SPLIT_STAT_FIELDS.forEach((field) => {
      const col = SPLIT_COLUMN[field];
      if (s[col] == null) return;
      any = true;
      split[field] = String(s[col]);
    });
    if (any) return split;
    return {
      yards: s.yards == null ? "" : String(s.yards),
      tds: s.tds == null ? "" : String(s.tds),
    };
  };

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
            : statLineFromRow(s);
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
    teams,
    playerPool: playerRows.map((p) => ({
      id: p.legacy_id,
      name: p.name,
      position: p.position,
      team: p.nfl_team,
      status: p.status,
      /* Dropped from the pool by a refresh: the commissioner's screen shows him, the
       * managers' Free Agents screen does not. He stays IN playerPool rather than being
       * filtered out here, because a week he already played still references him and
       * `legacyOf` resolves a missing player to null - which would blank a starter slot
       * in a finalized week. Added 2026-09-04; see the migration of the same date. */
      retired: !!p.retired,
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
      /* Null for every league created before 2026-09-07, and that reads as "the playoffs
       * will never start on their own" - see the migration. `?? null` rather than a
       * default, because inventing a playoff week for an existing league would be
       * choosing their season for them. */
      startNflWeek: season.playoff_start_nfl_week ?? null,
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
      /* Which week of NFL football this league period plays. It lives in _meta rather
       * than in the state proper because the artifact's shape has no field for it and
       * parity depends on that shape staying exactly as it was - see server/schedule.js
       * for why it is a server-owned column. Null means unmapped, which is a stats pull
       * refusing to guess rather than an error. */
      nflWeek: current?.nfl_week ?? null,
      /* The league's lineup-lock policy, and the kickoff times this week locks on.
       * Same reasoning as nflWeek: neither exists in the artifact's state shape, and
       * `kickoffs` is a server-owned column that decompose deliberately does not carry,
       * so an ordinary blob write cannot put null over a week's times.
       *
       * The browser is given the times so it reaches the SAME verdict the server does -
       * a player greys out at his kickoff without a round trip - but the server is
       * still the only thing that refuses a write. See src/engine/lineupLock.js. */
      lineupLock: normalizeLineupLock(season.lineup_lock),
      kickoffs: current?.kickoffs ?? {},
      kickoffsReadAt: current?.kickoffs_read_at ?? null,
      /* OQ-32: where each player sits on his NFL team's depth chart - player id -> rank,
       * from the last pool refresh. The deal reads it to give each team's top healthy RB
       * and WR better odds; see src/engine/deal.js. In _meta for the reason kickoffs is:
       * the artifact's shape has no field for it, and `depth_rank` is the feed's column,
       * which decompose deliberately does not carry. A player added by hand has none. */
      depthRanks: depthRanksFrom(playerRows),
      /* OQ-28: every pool player's feed line, by NFL week - player id -> week -> a stat
       * line in the same view shape statsEntry uses, so the engine scores it with the
       * same function. In _meta for the reason nflWeek is: the artifact's shape has no
       * field for it, and decompose must never carry it - NOTHING SCORES FROM THESE. They
       * are the bench and free-agent points and the season averages, and no more.
       * `?? []` because a database without the table yet hands back nothing. */
      playerWeeks: playerWeeksFrom(db.player_week_lines ?? [], season.id, playerLegacy),
      /* OQ-29: the NFL injury report - player id -> NFL week -> game status, injury and
       * practice days. In _meta for the same reason as playerWeeks, and with the same
       * promise: NOTHING DEALS, SCORES OR LOCKS FROM IT. It is the pill and the notepad on
       * a roster row. See src/engine/injuries.js. */
      injuries: injuriesFrom(db.player_injuries ?? [], season.id, playerLegacy),
      /* OQ-31: the latest finalized week's recaps - the pop-up a manager sees once when
       * they next open the app, and the strip on My Team after it. Written by the server
       * at finalize and never edited. Display only: NOTHING IN THE GAME READS IT. Null
       * before the first finalized week, and on a database without the table yet. */
      recaps: recapsFrom(db.weekly_recaps ?? [], periodRows, teamLegacy),
      /* Whether a scheduled job may run the stats pull for this league. An operational
       * setting rather than a game rule - it says who presses the button, not what the
       * button does - so it lives on `leagues` and, like nflWeek, is deliberately not
       * in the state proper: the artifact's shape has no field for it and decompose
       * must not carry it. See server/autoPull.js. */
      autoPullStats: league.auto_pull_stats === true,
      /* Issue #52: whether the weekly cycle runs on a clock for this league, and which
       * clock. Same family as autoPullStats - operational, server-owned, deliberately
       * not in the state proper, because the artifact's shape has no field for it and
       * decompose must not carry it.
       *
       * The BROWSER needs these to tell people what happens next and when: the Help
       * tab, the welcome card and the "your next step" line all read them, so a manager
       * finds out the scheme deadline is a real time from the app rather than from
       * losing a week. See src/components/guidance.js. */
      autoProcessSchemes: league.auto_process_schemes === true,
      autoAdvanceWeek: league.auto_advance_week === true,
      /* Issue #57: whether this league emails its managers when the week moves. Same
       * family again - operational, server-owned, not in the artifact's state shape, so
       * decompose must not carry it. The browser needs it for one checkbox on the
       * commissioner's screen and for saying, where the app tells somebody what happens
       * next, whether they will be told by email or have to come and look. */
      notifyMembers: league.notify_members === true,
      tz: league.tz || "America/New_York",
      /* Issue #75: a table, rather than a season. Chosen once, at creation; see
       * src/engine/table.js for what each of these means and who reads them. */
      ...tableMeta(league, teamRows, current, teamLegacy),
      versions: buildVersionMap(db, season, current, slotsForCurrent, teamLegacy),
    },
  };
}
