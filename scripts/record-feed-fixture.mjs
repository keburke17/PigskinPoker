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
const statsWeek = Number(flag("stats-week", 1));

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

/* ------------------------------------------------------------------ stats -- */

/* Filtered to the players the recorded pool actually contains, because a stat line for
 * somebody no league can deal is noise in a fixture. */
const chart = await fetchDepthChart({ season });
const { coaches } = await fetchHeadCoaches({ season });
const { players: pool, gaps } = buildPool({ depthPlayers: chart.players, coaches });
const poolGsis = new Set(pool.map((p) => p.externalIds && p.externalIds.gsis).filter(Boolean));

const statsRes = await fetch(WEEKLY_STATS_URL(statsSeason));
if (!statsRes.ok) throw new Error("weekly stats: HTTP " + statsRes.status + " for " + statsSeason);
const statRows = parseCsv(await statsRes.text()).filter(
  (r) => Number(r.week) === statsWeek && r.season_type === "REG" && poolGsis.has(r.player_id)
);
/* Relabelled to the season the fixture stands in for. The numbers are real and last
 * season's; the label is what makes them line up with a demo league playing week 1. */
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
    sourceWeek: statsWeek,
    relabelledTo: { season, week: statsWeek },
    rows: statRows.length,
  },
};
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("  manifest.json");
console.log(
  "\nPool from this snapshot: " + pool.length + " players, " + gaps.length + " gap(s). " +
  "Stat lines: " + statRows.length + " (real " + statsSeason + " week " + statsWeek +
  " numbers, relabelled " + season + ")."
);
