#!/usr/bin/env node
/* Records a snapshot of the live nflverse feed into server/feed/fixture/.
 *
 *   npm run feed:record                 # this year's depth charts, last year's week 1
 *   npm run feed:record -- --season 2026 --stats-season 2025 --stats-week 1
 *
 * WHY A RECORDED FEED EXISTS AT ALL. Two reasons, and the second is the load-bearing
 * one:
 *
 *   1. Determinism. The refresh against the live feed retires whoever the depth chart
 *      happens to have moved this morning, so "press Refresh and see what happens" is a
 *      different test every day and cannot be asserted on.
 *
 *   2. There is nothing to pull yet. `stats_player_week_2026.csv` is a 404 until games
 *      are played, so the stats half of Phase 4 cannot be built against the live feed
 *      before the season starts. Recording a real past week is the only way to have
 *      numbers to work against - so the fixture's stat lines are LAST SEASON'S, filtered
 *      to players who are in the pool now and relabelled to the target season. They are
 *      real numbers from a real game week. They are NOT a prediction and they are not
 *      that week in this season.
 *
 * The fixture is LOCAL ONLY - see server/feed/index.js, which refuses to serve it
 * against anything but a local Supabase URL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEPTH_CHART_URL,
  GAMES_URL,
  NFL_TEAMS,
  buildPool,
  fetchDepthChart,
  fetchHeadCoaches,
  parseCsv,
  readLatestSnapshot,
  STATS_COLUMNS,
  WEEKLY_STATS_URL,
} from "../server/feed/nflverse.js";
import { FIXTURE_DIR } from "../server/feed/fixture.js";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const season = Number(flag("season", new Date().getUTCFullYear()));
const statsSeason = Number(flag("stats-season", season - 1));

/* SEVERAL WEEKS, NOT ONE. The demo league is dealt further along than week 1, so a
 * single recorded week left a pull asking for a week the fixture had nothing for and
 * getting an empty answer that looked like a bug. Recording a few weeks also keeps the
 * empty case reachable on purpose - ask for a week beyond this range and the fixture
 * honestly has nothing, which is what the live feed does before a game is played.
 * Weeks keep their own numbers; only the SEASON is relabelled. */
const statsWeeks = String(flag("stats-weeks", "1-4"))
  .split(",")
  .flatMap((part) => {
    const [a, b] = part.split("-").map(Number);
    if (!Number.isFinite(a)) return [];
    const to = Number.isFinite(b) ? b : a;
    return Array.from({ length: to - a + 1 }, (_, i) => a + i);
  });
if (!statsWeeks.length) throw new Error("--stats-weeks parsed to nothing");
const statsWeekSet = new Set(statsWeeks.map(String));

const OUT = FIXTURE_DIR;
fs.mkdirSync(OUT, { recursive: true });

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (columns, rows) =>
  [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";

const write = (name, text) => {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, text);
  const kb = (Buffer.byteLength(text) / 1024).toFixed(0);
  const lines = text.split("\n").length - 1;
  console.log("  " + name.padEnd(20) + String(lines).padStart(4) + " lines, " + kb + "KB");
};

/* ------------------------------------------------------------ depth chart -- */

console.log("Recording from the live feed:");

const res = await fetch(DEPTH_CHART_URL(season));
if (!res.ok) throw new Error("depth charts: HTTP " + res.status + " for " + season);
const { snapshotAt, rows: depthRows } = await readLatestSnapshot(res.body);
if (!depthRows.length) throw new Error("depth charts: the newest snapshot was empty");
write("depth-charts.csv", toCsv(Object.keys(depthRows[0]), depthRows));

/* ---------------------------------------------------------------- coaches -- */

const gamesRes = await fetch(GAMES_URL);
if (!gamesRes.ok) throw new Error("games: HTTP " + gamesRes.status);
const gameRows = parseCsv(await gamesRes.text());
const GAME_COLUMNS = ["season", "week", "home_team", "away_team", "home_coach", "away_coach"];
/* games.csv carries every season back to 1999 and forty columns. The fixture keeps the
 * one season and the six columns coachesFromGames actually reads. */
const wantedSeason = gameRows.some((r) => r.season === String(season))
  ? String(season)
  : gameRows.reduce((a, r) => (Number(r.season) > Number(a) ? r.season : a), "0");
write("games.csv", toCsv(GAME_COLUMNS, gameRows.filter((r) => r.season === wantedSeason)));

/* ---------------------------------------------------------------- results -- */

/* WHY THIS IS A SECOND FILE. games.csv above is THIS season's schedule, recorded for
 * the head coaches - and before the season starts its score columns are empty, so the
 * Coach slot could not be developed against it at all. This is the same trick the stat
 * lines use: real finished games from the stats season, relabelled, and matched BY TEAM
 * when they are read - so a team that has changed coach since still resolves. */
const RESULT_COLUMNS = ["season", "week", "home_team", "away_team", "home_score", "away_score"];
const resultRows = gameRows.filter(
  (r) =>
    r.season === String(statsSeason) &&
    statsWeekSet.has(r.week) &&
    r.home_score !== "" &&
    r.away_score !== ""
);
if (!resultRows.length) {
  throw new Error(
    "results: no finished games for " + statsSeason + " weeks " + statsWeeks.join(",")
  );
}
write("results-week.csv", toCsv(RESULT_COLUMNS, resultRows.map((r) => ({ ...r, season: String(season) }))));

/* ------------------------------------------------------------------ stats -- */

/* Filtered to the players the recorded pool actually contains, because a stat line for
 * somebody no league can deal is noise in a fixture. */
const chart = await fetchDepthChart({ season });
/* Still fetched, and games.csv is still recorded above - the Coach slot scores off its
 * results. Its COACH columns stopped feeding the pool on 2026-09-04 (OQ-4d), so the pool
 * is 192 players and the 32 head coaches are the commissioner's. `coachSeason` below
 * records which season the recording read, which is still worth knowing. */
const { coaches } = await fetchHeadCoaches({ season });
const { players: pool, gaps } = buildPool({ depthPlayers: chart.players });
const poolGsis = new Set(pool.map((p) => p.externalIds && p.externalIds.gsis).filter(Boolean));

const statsRes = await fetch(WEEKLY_STATS_URL(statsSeason));
if (!statsRes.ok) throw new Error("weekly stats: HTTP " + statsRes.status + " for " + statsSeason);
const statRows = parseCsv(await statsRes.text()).filter(
  (r) => statsWeekSet.has(r.week) && r.season_type === "REG" && poolGsis.has(r.player_id)
);
/* Relabelled to the season the fixture stands in for. The numbers are real and last
 * season's; the label is what makes them line up with a demo league playing that week. */
write("stats-week.csv", toCsv(STATS_COLUMNS, statRows.map((r) => ({ ...r, season: String(season) }))));

/* ----------------------------------------------------------------- manifest -- */

const manifest = {
  recordedAt: new Date().toISOString(),
  season,
  depthChartSnapshotAt: snapshotAt,
  depthChartRows: depthRows.length,
  poolPlayers: pool.length,
  poolGaps: gaps.length,
  coachSeason: wantedSeason,
  stats: {
    source: "stats_player_week_" + statsSeason + ".csv",
    sourceSeason: statsSeason,
    /* WHICH WEEKS ARE REAL. Anything outside this comes back empty on purpose - see
     * fetchWeeklyStats in server/feed/fixture.js. */
    weeks: statsWeeks,
    relabelledTo: { season },
    rows: statRows.length,
  },
  results: {
    source: "games.csv",
    sourceSeason: statsSeason,
    weeks: statsWeeks,
    relabelledTo: { season },
    rows: resultRows.length,
  },
};
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("  manifest.json");
console.log(
  "\nPool from this snapshot: " + pool.length + " players, " + gaps.length + " gap(s). " +
  "Stat lines: " + statRows.length + " and " + resultRows.length + " game result(s) " +
  "(real " + statsSeason + " week(s) " + statsWeeks.join(",") + ", relabelled " + season + ")."
);
