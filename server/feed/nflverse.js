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

/* Carries away_coach / home_coach, which is the only free source for "who is this
 * team's head coach" - depth charts do not list coaches. The same file carries game
 * results, which is what the Coach slot will score from when the stats pull lands. */
export const GAMES_URL = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";

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
 * 1 QB, 2 RB, 2 WR, 1 TE and 1 head coach per NFL team = 224 rows. Deliberately no
 * WR3s, no second tight ends, and no ranking step. Two backs because of committee
 * backfields. See docs/PHASE-4-PLAN.md section 4.2. */
export const POOL_DEPTH = { QB: 1, RB: 2, WR: 2, TE: 1 };

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
 * Read only the newest snapshot out of a depth-chart stream, then stop.
 *
 * Reads line by line, keeps rows whose `dt` matches the first data row's, and returns
 * as soon as a different `dt` appears. `onEnough` is called at that point so the caller
 * can abort the request rather than download the rest of the season.
 */
export async function readLatestSnapshot(stream, { onEnough } = {}) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  let header = null;
  let snapshotAt = null;
  const rows = [];
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
    if (snapshotAt === null) snapshotAt = row.dt;
    if (row.dt !== snapshotAt) return true; // a different snapshot: we have what we need
    rows.push(row);
    return false;
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
 * The 224-row pool: each NFL team's starters, plus its head coach.
 *
 * Positions are filled by depth-chart rank, so a team's RB1 and RB2 are whoever the
 * chart says they are this week. Anything the chart cannot supply is REPORTED in
 * `gaps`, never quietly filled - a pool that is silently one quarterback short deals a
 * broken week, and the designer would rather see the hole.
 */
export function buildPool({ depthPlayers, coaches }) {
  const wanted = [];
  const gaps = [];

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
      for (let i = 0; i < depth; i++) {
        const pick = list[i];
        if (!pick) {
          gaps.push({ team, position, wantedRank: i + 1, reason: "not on the depth chart" });
          continue;
        }
        wanted.push({ ...pick, position });
      }
    }

    const coach = coaches.get(team);
    if (!coach) {
      gaps.push({ team, position: "Coach", wantedRank: 1, reason: "no head coach listed" });
      continue;
    }
    wanted.push({
      name: coach,
      position: "Coach",
      team,
      depthRank: 1,
      externalIds: {},
    });
  }

  return { players: wanted, gaps };
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

/**
 * One week's stat lines, in the shape the six split columns want.
 *
 * PARSING ONLY, no fetch. Stage 5 decides how the file is read - whole, ranged, or
 * cached - and that is a measurement to make against the real file rather than a
 * default to pick here; the pool refresh has already taught this project what an
 * unmeasured request inside a handler costs. Meanwhile this is testable against the
 * recorded fixture, which is the only stat data that exists before the season starts.
 *
 * A player who did not play is simply absent from the file. That is the same thing as
 * zero under Scott's answer to OQ-4c, and it is the caller's job to say so.
 */
export function parseWeeklyStats(text, { week } = {}) {
  const wanted = week == null ? null : String(week);
  const out = [];
  for (const r of parseCsv(text)) {
    if (wanted !== null && String(r.week) !== wanted) continue;
    if (r.season_type && r.season_type !== "REG") continue;
    if (!r.player_id) continue;
    out.push({
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
    });
  }
  return out;
}
