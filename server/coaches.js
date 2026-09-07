/* The head-coach list, and what changing one reaches.
 *
 * Kept free of I/O for the same reason server/pool.js is: the rule that matters here is
 * a rule about OTHER PEOPLE'S LEAGUES, and it should be readable and testable without a
 * database in the way.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL, and why the rule it breaks is worth breaking.
 *
 * Everywhere else in this project, one league's `players` rows are that league's own
 * business. `tests/server.test.js` asserts a commissioner's edit cannot leak into
 * anybody else's league, and the reason is sound: marking somebody OUT is a football
 * statement about YOUR week.
 *
 * A head coach is not that statement. Three things make him different:
 *
 *   1. HE CANNOT BE PLAYED. The Coach slot is dealt and never selectable - no block, no
 *      steal, no redraw (SCHEME_POSITIONS in src/engine/constants.js).
 *   2. HE DOES NOT SCORE. The card scores its NFL TEAM's result: Win, Tie or Loss, read
 *      out of games.csv and matched by `nfl_team`. Nothing anywhere multiplies, matches
 *      or compares a coach's NAME to produce a point (see computeStarterPoints and
 *      feedValuesFor). Scott's framing, 2026-09-07: the card is the TEAM, and the coach
 *      name is on it because it is more fun that way.
 *   3. SO THE NAME IS NOT A DECISION ANY LEAGUE OWNS. It is one fact about the NFL,
 *      wrong in every league at once, and correcting it in one league at a time is how
 *      it has stayed wrong since 2026-08-29 (issue #40).
 *
 * Point 2 is the whole safety argument for reaching across leagues, and it is worth
 * stating plainly: renaming a coach CANNOT move a single point, in this week or in one
 * already finalized. If that ever stops being true - if a rule starts reading a coach's
 * name - this file becomes wrong and the propagation has to go.
 * ---------------------------------------------------------------------------
 *
 * WHAT IT WILL NOT DO. Rename more than one live coach row for the same team, and add a
 * coach a league does not have. Both are reported instead. A league with two live
 * Raiders coaches has a duplicate somebody has to look at, and picking one to overwrite
 * silently would leave the other sitting beside it wearing the old name - which is the
 * exact confusion OQ-4d part two was about.
 */

import { NFL_TEAM_NAMES } from "./feed/nflverse.js";

export { NFL_TEAM_NAMES };

const TEAMS = new Set(NFL_TEAM_NAMES);

/** Longest a coach name may be. The column is unbounded text; this is a typo guard. */
export const MAX_COACH_NAME = 60;

/** The name as it will be stored, or an error saying why it will not be. */
export function cleanCoachName(name) {
  const trimmed = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return { error: "Give the coach a name." };
  if (trimmed.length > MAX_COACH_NAME) {
    return { error: "That name is too long (" + MAX_COACH_NAME + " characters at most)." };
  }
  return { name: trimmed };
}

export const isNflTeam = (team) => TEAMS.has(team);

/**
 * The whole list, as the admin screen shows it: 32 teams, each with the template's name
 * and wherever a live league disagrees.
 *
 * A league is only listed under a team when its live coach row says something DIFFERENT,
 * or when there is no live row at all - agreement is the normal case and printing 32
 * teams times every league would bury the six that matter.
 *
 * Retired coach rows are counted but never compared. They are what a refresh dropped
 * (the two spellings of Klint Kubiak, and the same duplication at Buffalo, Atlanta and
 * Arizona - see the 09-06 backfill); they are invisible to managers, they are not dealt,
 * and holding the old name is exactly what they are for.
 *
 * @param {Array} templateRows  player_pool Coach rows: {legacy_id, name, nfl_team}
 * @param {Array} leagueRows    players Coach rows, every league:
 *                              {id, league_id, name, nfl_team, retired}
 * @param {Map}   leagueNames   league_id -> league name
 */
export function summarizeCoaches({ templateRows, leagueRows, leagueNames = new Map() }) {
  const template = new Map();
  for (const r of templateRows) template.set(r.nfl_team, r);

  const byTeam = new Map();
  for (const r of leagueRows) {
    if (!byTeam.has(r.nfl_team)) byTeam.set(r.nfl_team, []);
    byTeam.get(r.nfl_team).push(r);
  }

  const coaches = NFL_TEAM_NAMES.map((team) => {
    const tpl = template.get(team) ?? null;
    const rows = byTeam.get(team) ?? [];
    const live = rows.filter((r) => !r.retired);

    const byLeague = new Map();
    for (const r of live) {
      if (!byLeague.has(r.league_id)) byLeague.set(r.league_id, []);
      byLeague.get(r.league_id).push(r);
    }

    const disagreements = [];
    for (const [leagueId, list] of byLeague) {
      const names = [...new Set(list.map((r) => r.name))];
      if (names.length === 1 && tpl && names[0] === tpl.name) continue;
      disagreements.push({
        leagueId,
        leagueName: leagueNames.get(leagueId) ?? null,
        names,
        duplicate: list.length > 1,
      });
    }

    return {
      team,
      name: tpl ? tpl.name : null,
      legacyId: tpl ? tpl.legacy_id : null,
      /* Leagues holding no live coach for this team at all. Nothing here adds one - the
       * screen says so, and it is the commissioner's pool to add to. */
      missingIn: [...leagueNames.keys()]
        .filter((id) => !byLeague.has(id))
        .map((id) => ({ leagueId: id, leagueName: leagueNames.get(id) ?? null })),
      disagreements,
      retiredCount: rows.length - live.length,
    };
  });

  return { coaches, leagueCount: leagueNames.size };
}

/**
 * What setting one team's coach writes.
 *
 * @returns {{error}|{template, updates, report}}
 *   template - the player_pool row to rename, or null when it already reads that way
 *   updates  - [{id, league_id, from}] players rows to rename
 *   report   - what to tell the admin, INCLUDING what was deliberately left alone
 */
export function planCoachUpdate({ team, name, templateRows, leagueRows, leagueNames = new Map() }) {
  if (!isNflTeam(team)) return { error: "Unknown NFL team: " + team };
  const cleaned = cleanCoachName(name);
  if (cleaned.error) return { error: cleaned.error };
  const wanted = cleaned.name;

  const tpl = templateRows.find((r) => r.nfl_team === team) ?? null;
  if (!tpl) {
    /* The template is the master list; a team missing from it is a broken template, not
     * something to paper over by inserting a row with a made-up legacy_id. */
    return { error: "The shared pool has no coach row for the " + team + "." };
  }

  const live = leagueRows.filter((r) => r.nfl_team === team && !r.retired);
  const byLeague = new Map();
  for (const r of live) {
    if (!byLeague.has(r.league_id)) byLeague.set(r.league_id, []);
    byLeague.get(r.league_id).push(r);
  }

  const updates = [];
  const skipped = [];
  for (const [leagueId, list] of byLeague) {
    const label = { leagueId, leagueName: leagueNames.get(leagueId) ?? null };
    if (list.length > 1) {
      skipped.push({
        ...label,
        reason: "duplicate",
        names: list.map((r) => r.name),
      });
      continue;
    }
    if (list[0].name === wanted) continue; // already right; not a write
    updates.push({ id: list[0].id, league_id: leagueId, from: list[0].name });
  }

  const missing = [...leagueNames.keys()]
    .filter((id) => !byLeague.has(id))
    .map((id) => ({ leagueId: id, leagueName: leagueNames.get(id) ?? null, reason: "no live coach row" }));

  return {
    template: tpl.name === wanted ? null : { legacy_id: tpl.legacy_id, from: tpl.name },
    updates,
    report: {
      team,
      name: wanted,
      templateChanged: tpl.name !== wanted,
      leaguesUpdated: updates.length,
      skipped: [...skipped, ...missing],
    },
  };
}
