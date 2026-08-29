/* Deciding what a pool refresh changes.
 *
 * Split out of operations.js and kept free of I/O so the rule that matters can be
 * tested directly: A REFRESH MAY CORRECT ITS OWN WORK AND NOTHING A PERSON DECIDED.
 *
 * Three kinds of row, and the refresh treats them differently:
 *
 *   source 'seed'   - came from the hand-typed template every league is created from.
 *                     Replaceable: it was never a decision, it was the only thing
 *                     available before a feed existed (OQ-4b).
 *   source 'feed'   - the refresh put it there. Its own to correct.
 *   source 'manual' - the commissioner added this player himself. NEVER TOUCHED.
 *
 * And separately, `status_source`: if a person set a player's status, the feed records
 * what it thinks in `feed_status` and leaves `status` alone. Marking someone OUT is a
 * statement about this league, and the feed does not get to argue.
 *
 * See docs/PHASE-4-PLAN.md section 4.5.
 */

/** Names differ in punctuation and suffixes far more than in spelling. */
export function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/['`]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const matchKey = (name, position) => normalizeName(name) + "|" + position;

/**
 * Work out the writes a refresh implies.
 *
 * @param {Array}  existing  players rows for this league
 * @param {Array}  wanted    the pool the feed says should exist (server/feed/nflverse.js)
 * @param {string} at        ISO timestamp of the feed snapshot
 * @returns {{ inserts, updates, retires, untouched, report }}
 */
export function planPoolRefresh({ existing, wanted, at }) {
  const byGsis = new Map();
  const byName = new Map();
  for (const row of existing) {
    const gsis = row.external_ids && row.external_ids.gsis;
    if (gsis) byGsis.set(String(gsis), row);
    const key = matchKey(row.name, row.position);
    // First one wins; a duplicate name at the same position is reported, not guessed at.
    if (!byName.has(key)) byName.set(key, row);
  }

  const inserts = [];
  const updates = [];
  const claimed = new Set();
  const renamed = [];
  const added = [];
  const disagreements = [];

  for (const p of wanted) {
    const gsis = p.externalIds && p.externalIds.gsis;
    let row = gsis ? byGsis.get(String(gsis)) : null;
    let matchedBy = row ? "id" : null;
    if (!row) {
      row = byName.get(matchKey(p.name, p.position));
      if (row) matchedBy = "name";
    }
    // A row already claimed by another feed player is not reused - that is the
    // double-match the unique index exists to prevent.
    if (row && claimed.has(row.id)) row = null;

    if (!row) {
      inserts.push({
        name: p.name,
        position: p.position,
        nfl_team: p.team,
        status: "Active",
        external_ids: p.externalIds || {},
        depth_rank: p.depthRank ?? null,
        source: "feed",
        status_source: "feed",
        feed_status: "Active",
        feed_updated_at: at,
      });
      added.push({ name: p.name, position: p.position, team: p.team });
      continue;
    }

    claimed.add(row.id);

    if (row.source === "manual") {
      // The commissioner put this player here. The feed may not restyle him.
      continue;
    }

    const patch = {
      id: row.id,
      name: p.name,
      nfl_team: p.team,
      external_ids: { ...(row.external_ids || {}), ...(p.externalIds || {}) },
      depth_rank: p.depthRank ?? null,
      source: "feed",
      feed_status: "Active",
      feed_updated_at: at,
    };
    // Only the feed's own status decisions are the feed's to revise.
    if (row.status_source !== "manual") {
      patch.status = "Active";
      patch.status_source = "feed";
    } else if (row.status !== "Active") {
      /* He is a starter again as far as the feed is concerned, and the commissioner has
       * him sidelined. That disagreement is the single most useful thing this screen can
       * say, so it is surfaced rather than silently obeyed. */
      disagreements.push({
        name: row.name,
        position: row.position,
        why: "the depth chart has him starting, you have him " + row.status,
      });
    }
    if (matchedBy === "name" && row.name !== p.name) {
      renamed.push({ from: row.name, to: p.name, position: p.position, team: p.team });
    }
    updates.push(patch);
  }

  /* Anything the feed did not claim is no longer a starter. It is retired from the
   * dealt pool rather than deleted - a deleted player would break the rosters and
   * results that already reference him. */
  const retires = [];
  const untouched = [];
  for (const row of existing) {
    if (claimed.has(row.id)) continue;
    if (row.source === "manual") {
      untouched.push({ name: row.name, position: row.position, why: "you added this player" });
      continue;
    }
    if (row.status_source === "manual") {
      untouched.push({
        name: row.name,
        position: row.position,
        why: "you set this player's status by hand",
      });
      continue;
    }
    if (row.status === "OUT" && row.status_source === "feed") continue; // already retired
    retires.push({
      id: row.id,
      status: "OUT",
      status_source: "feed",
      feed_status: "OUT",
      feed_updated_at: at,
      depth_rank: null,
    });
  }

  return {
    inserts,
    updates,
    retires,
    untouched,
    report: {
      at,
      added,
      renamed,
      retired: retires.length,
      updated: updates.length,
      untouched: untouched.concat(disagreements),
    },
  };
}

/* --------------------------------------------------------------- writing -- */

/**
 * How many rows go in one write. PostgREST runs one statement per request, so the cost
 * of a refresh is round trips, not rows: 224 sends 2 requests instead of 224.
 */
export const POOL_WRITE_CHUNK = 200;

/**
 * Turn the plan's patches into whole rows, batched.
 *
 * WHY THIS EXISTS. The patches from `planPoolRefresh` each carry an id and only the
 * columns that change, which is the natural shape for `update().eq("id", id)` - one
 * request per player. Locally that is free and it stayed invisible; against hosted
 * Postgres from a Netlify function it is a few hundred sequential round trips against a
 * 10-second default timeout, and the FIRST live refresh is the worst case because every
 * matched row needs its provider ids written. An upsert takes many rows per request but
 * needs COMPLETE rows, so each patch is merged onto the row it came from.
 *
 * A patch whose row has vanished between the read and the write is dropped rather than
 * written: upserting a patch on its own would INSERT a half-built player, which is a
 * far worse outcome than skipping a correction the next refresh will make anyway.
 *
 * `version` is carried through untouched, exactly as the per-row updates left it - a
 * refresh is not an edit anybody is holding a stale view of.
 *
 * @returns {Array<Array>} chunks of full rows, ready to upsert on `id`
 */
export function poolWriteRows({ patches, existing, chunkSize = POOL_WRITE_CHUNK }) {
  const byId = new Map(existing.map((r) => [r.id, r]));
  const rows = [];
  for (const patch of patches) {
    const before = byId.get(patch.id);
    if (!before) continue;
    rows.push({ ...before, ...patch });
  }
  const size = Math.max(1, Math.floor(chunkSize) || 0);
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}
