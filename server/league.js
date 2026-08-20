/* Loading and persisting the normalized league, server-side.
 *
 * Reuses src/storage/hydrate.js and src/storage/decompose.js rather than
 * reimplementing the mapping - so the engine that runs here is literally the code the
 * parity tests cover, and the row shapes are literally the ones the round-trip test
 * pins. A second implementation would be free to drift; this one cannot.
 */

import { hydrateLeague } from "../src/storage/hydrate.js";
import { decomposeLeague } from "../src/storage/decompose.js";

/* Every table hydrate() needs. `schemes` is selected by explicit columns because the
 * secret key can read submitted_at but we keep the shape identical to the client's. */
const TABLES = [
  "leagues", "seasons", "teams", "team_totals", "players",
  "periods", "roster_slots", "stat_lines", "schemes", "period_results", "events",
];

export async function fetchLeagueRows(db, leagueId) {
  const rows = {};
  const league = await db.from("leagues").select("*").eq("id", leagueId).maybeSingle();
  if (league.error) throw new Error("leagues: " + league.error.message);
  if (!league.data) return null;
  rows.leagues = [league.data];

  const seasons = await db.from("seasons").select("*").eq("league_id", leagueId);
  if (seasons.error) throw new Error("seasons: " + seasons.error.message);
  rows.seasons = seasons.data;
  const seasonIds = seasons.data.map((s) => s.id);

  const [teams, players] = await Promise.all([
    db.from("teams").select("*").eq("league_id", leagueId),
    db.from("players").select("*").eq("league_id", leagueId),
  ]);
  rows.teams = teams.data ?? [];
  rows.players = players.data ?? [];

  const periods = await db.from("periods").select("*").in("season_id", seasonIds);
  rows.periods = periods.data ?? [];
  const periodIds = rows.periods.map((p) => p.id);

  const [totals, slots, stats, schemes, results, events] = await Promise.all([
    db.from("team_totals").select("*").in("season_id", seasonIds),
    periodIds.length ? db.from("roster_slots").select("*").in("period_id", periodIds) : { data: [] },
    periodIds.length ? db.from("stat_lines").select("*").in("period_id", periodIds) : { data: [] },
    periodIds.length ? db.from("schemes").select("*").in("period_id", periodIds) : { data: [] },
    periodIds.length ? db.from("period_results").select("*").in("period_id", periodIds) : { data: [] },
    db.from("events").select("*").in("season_id", seasonIds),
  ]);
  rows.team_totals = totals.data ?? [];
  rows.roster_slots = slots.data ?? [];
  rows.stat_lines = stats.data ?? [];
  rows.schemes = schemes.data ?? [];
  rows.period_results = results.data ?? [];
  rows.events = events.data ?? [];

  for (const t of TABLES) if (!rows[t]) rows[t] = [];
  return rows;
}

export function hydrate(rows) {
  return hydrateLeague(rows);
}

/**
 * Persist an engine-produced blob back to the database.
 *
 * Used only by the COARSE lifecycle operations (deal, process schemes, finalize, start
 * playoffs), which legitimately rewrite most of the league. The fine-grained
 * operations never come through here - they update one row and bump its version, which
 * is what keeps stat entry cheap and conflict-free.
 *
 * Versions are carried forward and bumped only where content actually changed, so a
 * client holding a pre-deal view is correctly told it is stale.
 */
export async function persistBlob(db, previous, blob, opts) {
  const next = decomposeLeague(blob, {
    leagueKey: opts.leagueKey,
    year: opts.year,
    hashCode: () => "unused-secrets-are-not-rewritten",
    // Identity comes from what is already in the database, not from leagueKey. See the
    // long comment in decompose.js - getting this wrong deletes the league.
    existing: previous,
  });

  const VERSIONED = new Set([
    "seasons", "teams", "players", "periods", "roster_slots", "stat_lines", "schemes", "team_totals",
  ]);
  // Never touch secrets from a blob write - they are not derivable from app state.
  const WRITABLE = TABLES;

  /* Deleting a league cascades to EVERYTHING, including its league_members rows -
   * i.e. it locks the commissioner out permanently. No ordinary state write should ever
   * remove one, so the delete pass simply refuses to consider these tables. Belt and
   * braces alongside the identity fix in decompose.js. */
  const NEVER_DELETE_FROM = new Set(["leagues", "seasons"]);

  for (const table of WRITABLE) {
    const before = new Map((previous?.[table] ?? []).map((r) => [r.id, r]));
    const rows = (next[table] ?? []).map((row) => {
      const prev = before.get(row.id);
      if (!VERSIONED.has(table)) return row;
      const changed =
        !prev ||
        JSON.stringify({ ...prev, version: 0 }) !== JSON.stringify({ ...row, version: 0 });
      return { ...row, version: (prev?.version ?? 0) + (changed ? 1 : 0) || 1 };
    });

    if (rows.length) {
      const { error } = await db.from(table).upsert(rows, { onConflict: "id" });
      if (error) throw new Error("upsert " + table + ": " + error.message);
    }

    // Delete rows that no longer exist (e.g. a removed team, a cleared scheme).
    if (NEVER_DELETE_FROM.has(table)) continue;
    const keep = new Set(rows.map((r) => r.id));
    const gone = (previous?.[table] ?? []).filter((r) => !keep.has(r.id)).map((r) => r.id);
    if (gone.length) {
      const { error } = await db.from(table).delete().in("id", gone);
      if (error) throw new Error("delete " + table + ": " + error.message);
    }
  }
}
