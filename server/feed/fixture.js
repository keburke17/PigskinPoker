/* The recorded feed. Local development and tests only.
 *
 * Same API as ./nflverse.js, reading files in ./fixture/ instead of the network, and
 * reusing that module's own parsing and pool-building - so what a fixture run exercises
 * is the real code path with the network swapped out, not a second implementation.
 *
 * WHY IT EXISTS. The live feed is a moving target: refreshing against it retires
 * whoever the depth chart moved this morning, so nothing about a refresh can be
 * asserted. And the stats half cannot be developed against it at all before the season
 * starts - `stats_player_week_2026.csv` is a 404 until games are played. The recorded
 * week is real numbers from a real past week, filtered to players in the pool and
 * relabelled to the season the fixture stands in for. Real, and NOT this season's.
 *
 * WHAT SELECTS IT: server/feed/index.js, which will not serve it against a non-local
 * Supabase URL whatever the environment says. Re-record with `npm run feed:record`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPool,
  fetchDepthChart as fetchDepthChartFrom,
  fetchHeadCoaches as fetchHeadCoachesFrom,
  parseWeeklyStats,
} from "./nflverse.js";

export const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixture");

const read = (name) => fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");

/** What was recorded, when, and what the stat lines really are. */
export const manifest = () => JSON.parse(read("manifest.json"));

/* A `fetch` that answers from disk. nflverse.js already falls back to reading the whole
 * body when a response carries no stream, which is the door this walks through - so the
 * fixture runs the same parse, the same team mapping and the same depth-rank rules. */
const fileFetch = (name) => async () => ({ ok: true, text: async () => read(name) });

export async function fetchDepthChart({ season } = {}) {
  return fetchDepthChartFrom({ season, fetchImpl: fileFetch("depth-charts.csv") });
}

export async function fetchHeadCoaches({ season } = {}) {
  return fetchHeadCoachesFrom({ season, fetchImpl: fileFetch("games.csv") });
}

/** The recorded week's stat lines. Stage 5's fetch does not exist yet; this does. */
export function readWeeklyStats({ week } = {}) {
  return parseWeeklyStats(read("stats-week.csv"), { week });
}

export { buildPool };
