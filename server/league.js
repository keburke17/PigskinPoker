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

  /* ORDERED, exactly as the client's read is (src/storage/supabase.js), and for the same
   * two reasons - which is the point: every write returns a freshly hydrated league that
   * the client adopts wholesale, so an unordered read here shuffles the cards under a
   * commissioner mid-entry and the ordered re-read a moment later shuffles them back.
   * That was issue #60. Rows move in the heap as they are rewritten, so "whatever
   * PostgREST hands back" changes on every save.
   *
   * The half that outlives the flicker is that `state.teams` order is load-bearing in
   * the engine: rankTeamsWithTiebreak leaves teams it cannot separate in INPUT order, so
   * a dead tie at the playoff cut or on the champion is sliced by array order. Finalize
   * runs HERE, on these rows - so this is the read that decides it, and ordering by
   * created_at is what makes OQ-A's "whichever team joined first" true rather than
   * aspirational. The client fix for issue #29 never reached this side.
   *
   * `players` is ordered for the same reason twice over: it is the pool and free-agent
   * lists on screen, and dealRosters shuffles it, so a seeded deal is only replayable
   * from a stable input order. `id` is the tiebreak of last resort so the order is
   * total. */
  const [teams, players] = await Promise.all([
    db.from("teams").select("*").eq("league_id", leagueId).order("created_at").order("id"),
    db.from("players").select("*").eq("league_id", leagueId).order("created_at").order("id"),
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
    newPlayerSource: opts.newPlayerSource,
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

  /* WHAT THE BLOB CAN ACTUALLY SPEAK FOR - issue #56.
   *
   * The delete pass below removes every row of a writable table that is absent from the
   * decomposed picture, on the reasoning that absence means the commissioner deleted it.
   * That reasoning is inherited from the artifact, where persistence was one key holding
   * the whole state (`window.storage.set(KEY, JSON.stringify(state))`, legacy line 2187)
   * and absence really did mean gone. On tables whose rows outlive a single write it is
   * simply false, and it was destroying data on the ORDINARY path, not just the unusual
   * one:
   *
   *   - `decomposeLeague` emits roster_slots and stat_lines for the CURRENT period only.
   *     The app-state shape has nowhere to put a finalized week's per-slot detail - see
   *     the header of decompose.js - and `finalizeCurrentPeriod` clears statsEntry and
   *     wipes every roster as it rolls to the next week. So on a finalize the picture
   *     legitimately contained zero of both, and the delete pass read that as "delete
   *     them all". Eighteen stat lines to none, every week, in every league, keeping only
   *     the aggregates in period_results - so there was no way to check or correct what
   *     an individual player scored in a finished week.
   *
   *   - `schemes` are worse than incomplete, they are invisible. Their RLS policy opens
   *     only once `resolved_at` is set (OQ-9), so a blob built in the browser - which is
   *     every replaceLeague call - can never carry an unresolved scheme, and hydrate()
   *     drops the resolved ones on purpose. No blob from any caller can speak for a
   *     scheme row, which is why they are not deletable through here at all.
   *
   * So deletion is scoped to what the picture is actually authoritative for. Anything
   * belonging to a finalized period is outside what a blob write knows about, and a
   * scheme is outside it entirely.
   *
   * Rows still go when they should: teams, players and stat/roster rows for the current
   * period are all fully carried by the blob, and removing a team or a player CASCADES
   * to its period-scoped rows in the database (see the foreign keys in
   * 20260818000000_initial_schema.sql) rather than relying on this pass. */
  const CURRENT_PERIOD_ONLY = new Set(["roster_slots", "stat_lines"]);
  const BLOB_CANNOT_SPEAK_FOR = new Set(["schemes"]);

  /* The current period's row id, as `next` knows it. decomposeLeague always emits a row
   * for state.currentPeriod - freshly, or as the historical one when the two coincide -
   * so this is a lookup rather than a second derivation of the id. */
  const curKey = blob.currentPeriod
    ? blob.currentPeriod.type + "-" + blob.currentPeriod.number
    : null;
  const curPeriodId = curKey
    ? next.periods.find((p) => p.type + "-" + p.number === curKey)?.id ?? null
    : null;

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

    // Delete rows that no longer exist (e.g. a removed team, a deleted player).
    if (NEVER_DELETE_FROM.has(table)) continue;
    if (BLOB_CANNOT_SPEAK_FOR.has(table)) continue;
    const keep = new Set(rows.map((r) => r.id));
    let absent = (previous?.[table] ?? []).filter((r) => !keep.has(r.id));
    if (CURRENT_PERIOD_ONLY.has(table)) {
      // Absent AND outside this period means unseen, not deleted. Leave it alone.
      if (!curPeriodId) continue;
      absent = absent.filter((r) => r.period_id === curPeriodId);
    }
    const gone = absent.map((r) => r.id);
    if (gone.length) {
      const { error } = await db.from(table).delete().in("id", gone);
      if (error) throw new Error("delete " + table + ": " + error.message);
    }
  }
}
