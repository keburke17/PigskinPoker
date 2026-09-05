/* The stats feed, such as it is: two CSV files and no dependency.
 *
 * WHY NFLVERSE. Free, no key, no account, no terms-of-service exposure, and it is
 * `fetch` against a URL that returns a file - which keeps the promise in CLAUDE.md about
 * dependencies staying boring. Its depth charts are SOURCED FROM ESPN, so going direct
 * to ESPN would buy a few hours of freshness and cost a second set of player ids to
 * reconcile against an undocumented endpoint. See docs/PHASE-4-PLAN.md section 5.1.
 *
 * WHY THIS DOES NOT DOWNLOAD 45MB. depth_charts_<season>.csv is the whole season's
 * snapshots in one file, ~45MB, and it is written NEWEST FIRST. Every row carries the
 * `dt` of the snapshot it belongs to, so this reads until `dt` changes and then aborts
 * the request. That is a few hundred KB, not forty-five megabytes, and it is why the
 * refresh can live in an ordinary request handler. Verified against the live file on
 * 2026-08-28; if nflverse ever reorders it, `readLatestSnapshot` still returns the right
 * answer, it just reads further - so this is an optimisation, not a correctness bet.
 *
 * NOTHING HERE TOUCHES THE DATABASE. It fetches, parses, and returns plain objects.
 * The decisions about what to do with them live in server/operations.js.
 */

/* -------------------------------------------------------------- sources -- */

export const DEPTH_CHART_URL = (season) =>
  "https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_" +
  season +
  ".csv";

/* Carries away_coach / home_coach, and the game results the Coach slot will score from
 * when the stats pull lands.
 *
 * THE POOL REFRESH NO LONGER READS THE COACHES OUT OF IT. Scott's decision, 2026-09-04:
 * this file's coach columns were wrong for his league on the day he checked - it had
 * John Harbaugh with the Giants, Todd Monken at Cleveland, and it spelled Klint Kubiak
 * "Klint Kubliak" - so head coaches became commissioner-maintained. `coachesFromGames`
 * stays exported and tested because the results half of this file is still the plan for
 * Coach scoring; nothing calls the coach half any more. See docs/OPEN-QUESTIONS.md OQ-4d. */
export const GAMES_URL = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";

/* Weekly roster status - who is actually on the active roster, and who is on IR.
 *
 * WHY A SECOND FILE. The depth chart carries twelve columns and none of them is injury
 * status: the "IR" tag ESPN shows on its own site is dropped from the extract. Rank
 * alone catches most of it, because ESPN demotes an injured player down the chart - on
 * 2026-09-04 Jayden Higgins was Houston's WR7 the day after his season ended - but that
 * reordering lags by a day or two, and this file does not.
 *
 * WHY IT IS READ IN FULL. Unlike the depth chart this one is NOT grouped by snapshot and
 * is not in week order (2025 opens 16, 17, 9), so there is no prefix worth stopping
 * after and no suffix worth range-requesting. It is ~940KB per week and reached 15.4MB
 * by the end of 2025, uncompressed on the wire. That is why the caller treats a failure
 * here as survivable and refreshes on depth charts alone. */
export const ROSTER_URL = (season) =>
  "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_" +
  season +
  ".csv";

/* nflverse abbreviation -> the full names the player pool has always used. Hand-written
 * because it is 32 rows that change roughly never, and a lookup table is cheaper than a
 * dependency. LAR/LA and JAX/JAC are both accepted: the two files do not always agree. */
export const NFL_TEAMS = {
  ARI: "Arizona Cardinals",
  ATL: "Atlanta Falcons",
  BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills",
  CAR: "Carolina Panthers",
  CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals",
  CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys",
  DEN: "Denver Broncos",
  DET: "Detroit Lions",
  GB: "Green Bay Packers",
  HOU: "Houston Texans",
  IND: "Indianapolis Colts",
  JAX: "Jacksonville Jaguars",
  JAC: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs",
  LA: "Los Angeles Rams",
  LAR: "Los Angeles Rams",
  LAC: "Los Angeles Chargers",
  LV: "Las Vegas Raiders",
  MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings",
  NE: "New England Patriots",
  NO: "New Orleans Saints",
  NYG: "New York Giants",
  NYJ: "New York Jets",
  PHI: "Philadelphia Eagles",
  PIT: "Pittsburgh Steelers",
  SEA: "Seattle Seahawks",
  SF: "San Francisco 49ers",
  TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans",
  WAS: "Washington Commanders",
};

/* How deep the pool goes at each position, decided by the designer on 2026-08-28.
 * 1 QB, 2 RB, 2 WR, 1 TE per NFL team = 192 rows. Deliberately no WR3s, no second tight
 * ends, and no ranking step. Two backs because of committee backfields.
 * See docs/PHASE-4-PLAN.md section 4.2.
 *
 * Head coaches were part of this until 2026-09-04 and are not any more - they are the
 * commissioner's to keep, so the feed does not produce them. The pool is still 224 rows
 * in a league: 192 from here plus the 32 coaches nobody but him touches. */
export const POOL_DEPTH = { QB: 1, RB: 2, WR: 2, TE: 1 };

/* nflverse roster status -> the pool status the game already understands.
 *
 * `status` is the NFL's own roster designation, not an injury report: ACT is the active
 * roster, RES is reserve (injured reserve, PUP, non-football injury), DEV is the
 * practice squad, and CUT / RET / EXE / INA / TRD are the various ways of not being on
 * the team this week. Only RES means "hurt", which is why it is the only one that maps
 * to IR; everything else that is not ACT simply is not playing, which is OUT.
 *
 * Anything unrecognised maps to Active on purpose. A status nflverse adds later must not
 * silently bench a starter - a player wrongly OUT is a hole in the deal, and a player
 * wrongly Active is a bad week the commissioner can see and fix. */
export const ROSTER_STATUS = {
  ACT: "Active",
  RES: "IR",
  DEV: "OUT",
  CUT: "OUT",
  RET: "OUT",
  EXE: "OUT",
  INA: "OUT",
  TRD: "OUT",
  TRC: "OUT",
};

export const poolStatusOf = (rosterStatus) =>
  rosterStatus == null || rosterStatus === "" ? "Active" : (ROSTER_STATUS[rosterStatus] ?? "Active");

/* ----------------------------------------------------------------- csv -- */

/* A single CSV line. Small on purpose: it handles quoted fields and doubled quotes,
 * which is all these two files use, and nothing else. */
export function parseCsvLine(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

/** Rows as objects keyed by header, from whole CSV text. */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

/* ------------------------------------------------------- depth charts -- */

/**
 * Read a CSV stream row by row and stop as soon as the caller has seen enough.
 *
 * BOTH BIG FILES ARE READ THIS WAY, which is why this is generic. The depth chart is
 * ~45MB written newest-first, so the refresh stops when the snapshot `dt` changes; the
 * weekly stats file is ~8.7MB ordered by week ascending, so a pull stops once the week
 * it wants has gone by. Neither needs range requests, a cache, or new infrastructure -
 * just the discipline of not reading to the end. See docs/PHASE-4-PLAN.md section 5.2.
 *
 * `onRow` returns true to stop. `onEnough` is then called so the caller can abort the
 * HTTP request rather than let the rest of the file arrive.
 *
 * @returns {{ stoppedEarly: boolean }} false means the whole file was read, which is
 *   correct but slow - and is the signal that the file's order has changed.
 */
export async function readCsvRows(stream, { onRow, onEnough } = {}) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  let header = null;
  let done = false;

  const takeLine = (line) => {
    if (!line) return false;
    if (!header) {
      header = parseCsvLine(line);
      return false;
    }
    const cells = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return onRow(row) === true;
  };

  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (takeLine(line)) {
        done = true;
        break;
      }
    }
  }

  if (done && onEnough) onEnough();
  try {
    await reader.cancel();
  } catch {
    /* the stream is already going away; nothing to do */
  }
  if (!done) takeLine(buffer.replace(/\r$/, ""));

  return { stoppedEarly: done };
}

/**
 * Read only the newest snapshot out of a depth-chart stream, then stop.
 *
 * Keeps rows whose `dt` matches the first data row's and returns as soon as a different
 * `dt` appears - the file is written newest-first, so that is the whole current chart.
 */
export async function readLatestSnapshot(stream, { onEnough } = {}) {
  let snapshotAt = null;
  const rows = [];
  await readCsvRows(stream, {
    onEnough,
    onRow: (row) => {
      if (snapshotAt === null) snapshotAt = row.dt;
      if (row.dt !== snapshotAt) return true; // a different snapshot: we have what we need
      rows.push(row);
      return false;
    },
  });
  return { snapshotAt, rows };
}

/**
 * Every team's current offensive skill-position depth chart.
 * @returns {{ snapshotAt: string, players: Array }}
 */
export async function fetchDepthChart({ season, fetchImpl = fetch } = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const res = await fetchImpl(DEPTH_CHART_URL(season), {
    signal: controller ? controller.signal : undefined,
  });
  if (!res.ok) {
    throw new Error("nflverse depth charts returned HTTP " + res.status + " for " + season);
  }
  if (!res.body || typeof res.body.getReader !== "function") {
    // No streaming available (some test doubles): fall back to the whole text.
    const rows = parseCsv(await res.text());
    const snapshotAt = rows.length ? rows[0].dt : null;
    return {
      snapshotAt,
      players: toDepthPlayers(rows.filter((r) => r.dt === snapshotAt)),
    };
  }

  const { snapshotAt, rows } = await readLatestSnapshot(res.body, {
    onEnough: () => controller && controller.abort(),
  });
  return { snapshotAt, players: toDepthPlayers(rows) };
}

const POSITIONS_WANTED = new Set(["QB", "RB", "WR", "TE"]);

function toDepthPlayers(rows) {
  const out = [];
  for (const r of rows) {
    if (!POSITIONS_WANTED.has(r.pos_abb)) continue;
    const team = NFL_TEAMS[r.team];
    if (!team) continue; // an abbreviation we do not know: reported, never guessed
    const rank = Number(r.pos_rank);
    if (!Number.isFinite(rank) || rank < 1) continue;
    out.push({
      name: r.player_name,
      position: r.pos_abb,
      team,
      teamAbbr: r.team,
      depthRank: rank,
      externalIds: pruneIds({ gsis: r.gsis_id, espn: r.espn_id }),
    });
  }
  return out;
}

const pruneIds = (ids) => {
  const out = {};
  for (const [k, v] of Object.entries(ids)) if (v) out[k] = String(v);
  return out;
};

/* ------------------------------------------------- roster status (IR) -- */

/**
 * Stream a whole CSV, handing each row to `keep` and retaining only what it returns.
 *
 * The roster file is 15MB of which we want about a thirtieth, so the rows we do not
 * want are parsed and dropped rather than accumulated. Same line handling as
 * `readLatestSnapshot`; that one can stop early and this one cannot, which is the only
 * reason they are not the same function.
 */
export async function streamCsvRows(stream, keep) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  let header = null;
  const rows = [];

  const takeLine = (line) => {
    if (!line) return;
    const cells = parseCsvLine(line);
    if (!header) {
      header = cells;
      return;
    }
    const row = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    const kept = keep(row);
    if (kept) rows.push(kept === true ? row : kept);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      takeLine(buffer.slice(0, nl).replace(/\r$/, ""));
      buffer = buffer.slice(nl + 1);
    }
  }
  takeLine(buffer.replace(/\r$/, ""));
  return rows;
}

/**
 * Pick the week whose rosters describe "now".
 *
 * NOT simply the highest week in the file. Once the playoffs start the file keeps going
 * to week 22, and week 22 is two teams - taking it would leave thirty of them with no
 * roster at all and mark their starters OUT. The newest week that still covers
 * essentially the whole league is the one that means what we want it to mean.
 */
export function currentRosterWeek(rows, { minTeams = 30 } = {}) {
  const teamsByWeek = new Map();
  for (const r of rows) {
    const week = Number(r.week);
    if (!Number.isFinite(week)) continue;
    if (!teamsByWeek.has(week)) teamsByWeek.set(week, new Set());
    teamsByWeek.get(week).add(r.team);
  }
  const weeks = [...teamsByWeek.keys()].sort((a, b) => b - a);
  const full = weeks.find((w) => teamsByWeek.get(w).size >= minTeams);
  return full ?? weeks[0] ?? null;
}

/**
 * Every skill-position player's roster status for the current week.
 * @returns {{ week: number, byGsis: Map, byName: Map }}
 */
export async function fetchRosterStatus({ season, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(ROSTER_URL(season));
  if (!res.ok) {
    throw new Error("nflverse weekly rosters returned HTTP " + res.status + " for " + season);
  }
  const wanted = (row) =>
    POSITIONS_WANTED.has(row.position)
      ? {
          week: row.week,
          team: row.team,
          position: row.position,
          name: row.full_name,
          gsis: row.gsis_id,
          status: row.status,
          abbr: row.status_description_abbr,
        }
      : null;

  const rows =
    res.body && typeof res.body.getReader === "function"
      ? await streamCsvRows(res.body, wanted)
      : parseCsv(await res.text())
          .map(wanted)
          .filter(Boolean);

  const week = currentRosterWeek(rows);
  const current = rows.filter((r) => Number(r.week) === week);

  const byGsis = new Map();
  const byName = new Map();
  for (const r of current) {
    if (r.gsis) byGsis.set(String(r.gsis), r);
    byName.set(rosterKey(r.name, r.position), r);
  }
  return { week, byGsis, byName };
}

/* Deliberately the same shape as server/pool.js's matcher: lowercase, punctuation and
 * suffixes gone. Duplicated rather than imported because this module is the feed and
 * that one is the decision layer, and neither should have to load the other. */
const rosterKey = (name, position) =>
  String(name || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/['`]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() +
  "|" +
  position;

/** What the roster file says about one depth-chart player, or Active if it has never
 * heard of him. Not knowing somebody is not evidence that he is hurt. */
export function statusOf(player, rosterStatus) {
  if (!rosterStatus) return "Active";
  const gsis = player.externalIds && player.externalIds.gsis;
  const row =
    (gsis && rosterStatus.byGsis.get(String(gsis))) ||
    rosterStatus.byName.get(rosterKey(player.name, player.position));
  return row ? poolStatusOf(row.status) : "Active";
}

/* ------------------------------------------------------------- coaches -- */

/**
 * Each team's current head coach, read off the most recent season in games.csv.
 * Depth charts do not carry coaches; this file does, and it is the same file the Coach
 * slot's Win/Tie/Loss will come from when the stats pull lands.
 */
export async function fetchHeadCoaches({ season, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(GAMES_URL);
  if (!res.ok) throw new Error("nflverse games returned HTTP " + res.status);
  const rows = parseCsv(await res.text());
  return coachesFromGames(rows, season);
}

/** Exported for testing: the latest coach each team is listed with, for a season. */
export function coachesFromGames(rows, season) {
  const wanted = String(season);
  const seasons = rows.map((r) => r.season).filter(Boolean);
  /* Fall back to the newest season present, so a refresh run before the new season's
   * schedule is published still returns last year's coaches rather than nothing. */
  const use = seasons.includes(wanted)
    ? wanted
    : seasons.reduce((a, b) => (Number(b) > Number(a) ? b : a), "0");

  const byTeam = new Map();
  for (const r of rows) {
    if (r.season !== use) continue;
    const week = Number(r.week) || 0;
    const put = (abbr, coach) => {
      const team = NFL_TEAMS[abbr];
      if (!team || !coach) return;
      const prev = byTeam.get(team);
      // Latest week wins, so a mid-season replacement is picked up.
      if (!prev || week >= prev.week) byTeam.set(team, { week, coach });
    };
    put(r.home_team, r.home_coach);
    put(r.away_team, r.away_coach);
  }

  const out = new Map();
  for (const [team, v] of byTeam) out.set(team, v.coach);
  return { season: use, coaches: out };
}

/* ---------------------------------------------------------------- pool -- */

/**
 * The 192-row pool: each NFL team's healthy starters at QB, RB, WR and TE.
 *
 * Positions are filled by depth-chart rank, so a team's RB1 and RB2 are whoever the
 * chart says they are this week. Anything the chart cannot supply is REPORTED in
 * `gaps`, never quietly filled - a pool that is silently one quarterback short deals a
 * broken week, and the designer would rather see the hole.
 *
 * INJURED STARTERS ARE SKIPPED, NOT COUNTED. Scott's decision, 2026-09-04: if a team's
 * WR2 is on injured reserve, the next healthy receiver takes the slot, so every team
 * always contributes a full 1/2/2/1 and the dealable pool does not thin out every time
 * somebody gets hurt. The hurt player is still returned - carrying IR rather than Active
 * - because a pool that simply omits him cannot explain why he is gone. He is in the
 * league's pool and out of its deal, which is exactly what IR has always meant here.
 *
 * `rosterStatus` is optional. Without it every depth-chart player is treated as healthy,
 * which is what the refresh falls back to when the roster file cannot be read.
 *
 * HEAD COACHES ARE NOT PRODUCED HERE. They are the commissioner's, see GAMES_URL above.
 */
export function buildPool({ depthPlayers, rosterStatus }) {
  const wanted = [];
  const gaps = [];
  const sidelined = [];

  const byTeamPos = new Map();
  for (const p of depthPlayers) {
    const key = p.team + "|" + p.position;
    if (!byTeamPos.has(key)) byTeamPos.set(key, []);
    byTeamPos.get(key).push(p);
  }

  const teams = [...new Set(Object.values(NFL_TEAMS))].sort();
  for (const team of teams) {
    for (const [position, depth] of Object.entries(POOL_DEPTH)) {
      const list = (byTeamPos.get(team + "|" + position) || [])
        .slice()
        .sort((a, b) => a.depthRank - b.depthRank);

      const healthy = [];
      const hurt = [];
      for (const p of list) {
        if (healthy.length >= depth) break;
        const status = statusOf(p, rosterStatus);
        if (status === "Active") healthy.push({ ...p, position, status: "Active" });
        else hurt.push({ ...p, position, status });
      }

      for (let i = healthy.length; i < depth; i++) {
        gaps.push({
          team,
          position,
          wantedRank: i + 1,
          reason: hurt.length
            ? "everyone on the depth chart at this spot is hurt or off the roster"
            : "not on the depth chart",
        });
      }

      wanted.push(...healthy, ...hurt);
      for (const p of hurt) {
        sidelined.push({
          name: p.name,
          position: p.position,
          team: p.team,
          depthRank: p.depthRank,
          status: p.status,
        });
      }
    }
  }

  return { players: wanted, gaps, sidelined };
}

/* --------------------------------------------------------- weekly stats -- */

/* Per-player, per-week stat lines. Same project and the same `gsis_id` the depth charts
 * carry, which is the whole reason for choosing nflverse. */
export const WEEKLY_STATS_URL = (season) =>
  "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_" +
  season +
  ".csv";

/* The columns this project reads, out of the ~100 the file carries. Passing, rushing and
 * receiving only: returns, two-point conversions and fumble-recovery touchdowns score
 * nothing (OQ-4c), so they are not even carried. */
export const STATS_COLUMNS = [
  "player_id", "player_display_name", "position", "team", "season", "week", "season_type",
  "passing_yards", "passing_tds", "rushing_yards", "rushing_tds", "receiving_yards", "receiving_tds",
];

const statNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** One CSV row as a stat line, or null when it is not one this project scores. */
function statLineFrom(r, wanted) {
  if (wanted !== null && String(r.week) !== wanted) return null;
  // Preseason and postseason both carry week numbers that collide with the regular one.
  if (r.season_type && r.season_type !== "REG") return null;
  if (!r.player_id) return null;
  return {
    gsis: r.player_id,
    name: r.player_display_name,
    position: r.position,
    teamAbbr: r.team,
    season: Number(r.season),
    week: Number(r.week),
    passYards: statNum(r.passing_yards),
    passTds: statNum(r.passing_tds),
    rushYards: statNum(r.rushing_yards),
    rushTds: statNum(r.rushing_tds),
    recYards: statNum(r.receiving_yards),
    recTds: statNum(r.receiving_tds),
  };
}

/**
 * One week's stat lines, in the shape the six split columns want.
 *
 * PARSING ONLY, no fetch - `fetchWeeklyStats` below is the streaming path. This one
 * takes whole text, which is how the recorded fixture and the tests read it.
 *
 * A player who did not play is simply absent from the file. That is the same thing as
 * zero under Scott's answer to OQ-4c, and it is the caller's job to say so.
 */
export function parseWeeklyStats(text, { week } = {}) {
  const wanted = week == null ? null : String(week);
  const out = [];
  for (const r of parseCsv(text)) {
    const line = statLineFrom(r, wanted);
    if (line) out.push(line);
  }
  return out;
}

/**
 * One NFL week's stat lines, read off the live file and stopped as soon as the week
 * has gone by.
 *
 * MEASURED, NOT GUESSED (2026-08-29, against stats_player_week_2025.csv): 8.66MB, no
 * compression on the wire, ordered by week ascending, week 1 through 22. So week 1
 * reads about 5% of the file and week 18 reads most of it - and the whole file is 0.7s
 * inside a 10s function budget. Range requests are the recorded fallback if nflverse
 * ever reorders it; `stoppedEarly` is how we would find out, since a pull that read to
 * the end is the symptom.
 *
 * @returns {{ season, week, lines, stoppedEarly }}
 */
export async function fetchWeeklyStats({ season, week, fetchImpl = fetch } = {}) {
  const wanted = Number(week);
  if (!Number.isFinite(wanted)) throw new Error("fetchWeeklyStats needs a week");

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const res = await fetchImpl(WEEKLY_STATS_URL(season), {
    signal: controller ? controller.signal : undefined,
  });
  if (!res.ok) {
    /* A 404 is the ordinary state of affairs before the season's first game, not a
     * fault, and the message says so - it is the single most likely thing to go wrong
     * the first time anyone presses the button. */
    throw new Error(
      "nflverse weekly stats returned HTTP " + res.status + " for " + season +
      (res.status === 404 ? " - no games have been played in that season yet" : "")
    );
  }

  if (!res.body || typeof res.body.getReader !== "function") {
    // No streaming available (some test doubles): fall back to the whole text.
    return {
      season,
      week: wanted,
      lines: parseWeeklyStats(await res.text(), { week: wanted }),
      stoppedEarly: false,
    };
  }

  const asWeek = String(wanted);
  const lines = [];
  const { stoppedEarly } = await readCsvRows(res.body, {
    onEnough: () => controller && controller.abort(),
    onRow: (row) => {
      const w = Number(row.week);
      /* Ordered ascending, so a REGULAR-SEASON week beyond the one wanted means the
       * rest of the file is no use. Postseason rows repeat low week numbers under a
       * different season_type, which is why the check is not on `week` alone. */
      if ((!row.season_type || row.season_type === "REG") && Number.isFinite(w) && w > wanted) {
        return true;
      }
      const line = statLineFrom(row, asWeek);
      if (line) lines.push(line);
      return false;
    },
  });
  return { season, week: wanted, lines, stoppedEarly };
}

/* --------------------------------------------------------- game results -- */

/**
 * Win / Tie / Loss for every team that played in one NFL week - what the Coach slot
 * scores from.
 *
 * Read off games.csv, the same file the head coaches come from, and matched BY TEAM
 * rather than by coach name: a team that changed coach mid-season still resolves, and
 * the pool's Coach rows carry the team they belong to rather than an id.
 *
 * @returns {{ season, week, results: Map<string, "Win"|"Tie"|"Loss"> }} keyed by the
 *   full team name the player pool uses.
 */
export async function fetchGameResults({ season, week, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(GAMES_URL);
  if (!res.ok) throw new Error("nflverse games returned HTTP " + res.status);
  return {
    season,
    week: Number(week),
    results: resultsFromGames(parseCsv(await res.text()), { season, week }),
  };
}

/** Exported for testing: one week's results out of the whole games file. */
export function resultsFromGames(rows, { season, week }) {
  const wantedSeason = String(season);
  const wantedWeek = String(week);
  const out = new Map();

  for (const r of rows) {
    if (String(r.season) !== wantedSeason) continue;
    if (String(r.week) !== wantedWeek) continue;

    const home = NFL_TEAMS[r.home_team];
    const away = NFL_TEAMS[r.away_team];
    if (!home || !away) continue; // an abbreviation we do not know: never guessed at

    /* AN UNPLAYED GAME IS NOT A TIE. games.csv carries the whole schedule from the day
     * it is published, with the score columns empty until the game is over, and
     * Number("") is 0 - so a blank read as a number would score every coach in the
     * league a tie on Saturday morning. Absent from the map means "no result yet", and
     * the pull reports it rather than writing it. */
    if (r.home_score === "" || r.away_score === "") continue;
    const hs = Number(r.home_score);
    const as = Number(r.away_score);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;

    out.set(home, hs > as ? "Win" : hs < as ? "Loss" : "Tie");
    out.set(away, as > hs ? "Win" : as < hs ? "Loss" : "Tie");
  }
  return out;
}
