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
  kickoffsFromGames,
  parseCsv,
  parseInjuries,
  parseWeeklyStats,
  resultsFromGames,
  seasonResultsFrom,
  weekStartsFromGames,
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

/**
 * The recorded weeks' stat lines. Same signature and same return shape as the live
 * `fetchWeeklyStats`, so `pullStats` calls one or the other without knowing which.
 *
 * A WEEK THAT WAS NOT RECORDED COMES BACK EMPTY, and that is deliberate rather than a
 * limitation to work around: it is exactly what the live feed does before a game is
 * played, so the "the feed has nothing for this week yet" path is reachable locally
 * instead of existing only in production. `manifest().stats.weeks` says which weeks are
 * real. Serving the one recorded week whatever was asked for would answer a different
 * question than the one put to it - the same mistake feed/index.js refuses to make
 * about production.
 */
export async function fetchWeeklyStats({ season, week } = {}) {
  return {
    season,
    week: Number(week),
    lines: parseWeeklyStats(read("stats-week.csv"), { week }),
    stoppedEarly: false,
  };
}

/**
 * Every recorded week from 1 through `throughWeek` - OQ-28's season history, the same
 * shape as the live `fetchSeasonStats`. Weeks that were not recorded are simply absent,
 * which is what the live file does for a week not yet played.
 */
export async function fetchSeasonStats({ season, throughWeek } = {}) {
  const last = Number(throughWeek);
  return {
    season,
    throughWeek: last,
    lines: parseWeeklyStats(read("stats-week.csv")).filter((l) => l.week >= 1 && l.week <= last),
    stoppedEarly: false,
  };
}

/** The recorded weeks' results, split by week - the live `fetchSeasonResults`'s shape. */
export async function fetchSeasonResults({ season, throughWeek } = {}) {
  return {
    season,
    throughWeek: Number(throughWeek),
    byWeek: seasonResultsFrom(parseCsv(read("results-week.csv")), { season, throughWeek }),
  };
}

/**
 * The recorded weeks' game results, for the Coach slot.
 *
 * Recorded separately from `games.csv` because those two files answer different
 * questions here: games.csv holds THIS season's schedule, which is where the head
 * coaches come from and which has no scores in it before the season starts, while this
 * holds a real past week's finished games relabelled to the fixture season. Matched by
 * team, so a team that has changed coach since still resolves.
 */
export async function fetchGameResults({ season, week } = {}) {
  return {
    season,
    week: Number(week),
    results: resultsFromGames(parseCsv(read("results-week.csv")), { season, week }),
  };
}

/**
 * The recorded season's kickoff times, for the lineup lock.
 *
 * Read from games.csv rather than results-week.csv, and that is the point: games.csv is
 * THIS fixture season's real schedule, so a locally dealt week locks on the days and
 * times that week is genuinely played. The relabelled past week the stat lines come
 * from would put Sunday's kickoffs in the wrong season entirely.
 *
 * A WEEK WITH NO TIMES COMES BACK EMPTY, exactly as the live feed does for a schedule
 * that has not been published - so "nothing to lock on" is reachable locally instead of
 * only in production.
 */
export async function fetchKickoffs({ season, week } = {}) {
  return {
    season,
    week: Number(week),
    kickoffs: kickoffsFromGames(parseCsv(read("games.csv")), { season, week }),
  };
}

/**
 * When each week of the recorded season starts (issue #45).
 *
 * games.csv again, for the same reason `fetchKickoffs` uses it: it is THIS fixture
 * season's real schedule, so a league created locally in "October" defaults to the week
 * October is actually playing. The relabelled past week the stat lines come from would
 * put the season in the wrong year entirely.
 */
export async function fetchWeekStarts({ season } = {}) {
  return {
    season,
    weekStarts: weekStartsFromGames(parseCsv(read("games.csv")), { season }),
  };
}

/**
 * This season's recorded injury report - the live `fetchInjuries`'s shape. OQ-29.
 *
 * THE PUBLISH TIME IS THE ONE THING THAT IS NOT THE RECORDING'S. The live file is dated by
 * when nflverse published it, and a reading only counts as a practice day if that date
 * falls in the player's three practice days that week. The recording was published in
 * October; the demo league plays September. Handing back October would file every reading
 * outside every window and leave the notepads with no days in them - which is a true
 * answer to a question nobody local is asking.
 *
 * So when the caller names the weeks it wants, the copy is dated as if it had been read on
 * the evening of the newest week's final report day (the Friday before its Sunday games),
 * which is what the recorded rows actually are: each week's last reading. Without weeks it
 * is the recording's own publish time.
 */
export async function fetchInjuries({ season, weeks = null } = {}) {
  const recorded = manifest().injuries || {};
  let publishedAt = recorded.publishedAt || null;
  if (weeks && weeks.length) {
    const week = Math.max(...weeks.map(Number));
    const kickoffs = kickoffsFromGames(parseCsv(read("games.csv")), { season, week });
    const sundays = Object.values(kickoffs)
      .map((k) => (typeof k === "string" ? k : k && k.at))
      .filter(Boolean)
      .map((iso) => new Date(iso))
      .filter((d) => d.getUTCDay() === 0 || (d.getUTCDay() === 1 && d.getUTCHours() < 8))
      .sort((a, b) => a - b);
    if (sundays.length) {
      /* Friday 5pm Eastern is Friday 21:00 or 22:00 UTC; 22:00 is after 4pm Eastern
       * either side of the clock change, which is all reportDateOf asks. */
      const sunday = sundays[0];
      const friday = Date.UTC(sunday.getUTCFullYear(), sunday.getUTCMonth(), sunday.getUTCDate() - 2, 22);
      publishedAt = new Date(friday).toISOString();
    }
  }
  return { season, publishedAt, rows: parseInjuries(read("injuries.csv"), { weeks }) };
}

export { buildPool };
