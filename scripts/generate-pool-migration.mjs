#!/usr/bin/env node
/* Generates the `player_pool` rows for a migration.
 *
 * TWO SOURCES, and which one you want depends on what you are doing.
 *
 *   node scripts/generate-pool-migration.mjs
 *       The ARTIFACT pool, expanded from src/data/teamRows.js. This is how the template
 *       was first built (20260820010000) and it is kept because that file is the one
 *       tests/parity.test.js replays dealing against - it cannot move, and a second
 *       hand-maintained copy of it in SQL would drift the first time anybody edited
 *       either. Historical: it produces names that were typed in 2025.
 *
 *   node scripts/generate-pool-migration.mjs --from-feed [--season 2026] > out.sql
 *       A WHOLE MIGRATION, built from the live nflverse depth charts: each NFL team's
 *       1 QB, 2 RB, 2 WR, 1 TE, with the provider ids attached. This is what you want
 *       when the template has gone stale, because `player_pool` is what every new league
 *       is copied from - a league created today is born holding whatever the template
 *       last said.
 *
 *       IT DOES NOT WRITE THE HEAD COACHES, and the SQL it emits does not delete them.
 *       They stopped being the feed's on 2026-09-04 (OQ-4d - games.csv had John Harbaugh
 *       coaching the Giants) and since issue #40 they are the site admins', maintained on
 *       the /admin screen and stored in these same 32 rows. This file used to pass a
 *       `coaches` map into buildPool, which had silently stopped accepting one: the
 *       argument was ignored, `rosterStatus` was never passed, and a regeneration would
 *       have emitted a 192-row template with ZERO coaches, every status hardcoded Active,
 *       under a header claiming 224 rows and 32 coaches. It would have reported success.
 *
 * WHY A SCRIPT AND NOT A REFRESH AT LEAGUE CREATION. Creating a league would then
 * depend on a 45MB file being reachable, and would fail in a way the person creating it
 * could do nothing about. The refresh stays something a commissioner presses; this
 * keeps the starting point close to correct so he is pressing it to catch up a few
 * days, not a year.
 *
 * Migrations are forward-only. This writes a NEW one - never edit an applied file.
 */

import { generatePlayerPool } from "../src/engine/pool.js";
import { buildPool, fetchDepthChart, fetchRosterStatus } from "../server/feed/nflverse.js";

const args = process.argv.slice(2);
const fromFeed = args.includes("--from-feed");
const seasonArg = args.indexOf("--season");
const season = seasonArg >= 0 ? Number(args[seasonArg + 1]) : new Date().getUTCFullYear();

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const jsonb = (o) => q(JSON.stringify(o ?? {})) + "::jsonb";

/* ------------------------------------------------------ the artifact pool -- */

if (!fromFeed) {
  const values = generatePlayerPool()
    .map((p) => "  (" + [q(p.id), q(p.name), q(p.position), q(p.team), q(p.status)].join(", ") + ")")
    .join(",\n");
  process.stdout.write(
    "insert into player_pool (legacy_id, name, position, nfl_team, status) values\n" +
    values + "\non conflict (legacy_id) do nothing;\n"
  );
  process.exit(0);
}

/* ----------------------------------------------------------- from the feed -- */

const chart = await fetchDepthChart({ season });

/* Injured starters are skipped and the next healthy man takes the slot (OQ-4d), which is
 * the same rule the live refresh runs. Allowed to fail on its own for the same reason it
 * is there: the roster file is ~940KB a week and not worth losing a whole template over -
 * without it every depth-chart player is treated as healthy, which is the old behaviour. */
let rosterStatus = null;
try {
  rosterStatus = await fetchRosterStatus({ season });
} catch (e) {
  console.error("Roster status unavailable (" + e.message + ") - statuses will all read Active.");
}

const { players, gaps } = buildPool({ depthPlayers: chart.players, rosterStatus });

/* A LOUD GUARD, because the failure this replaces was a silent one. buildPool produces
 * skill players only; if it ever starts producing coaches again, or stops producing a
 * full 192, the template being written is not the template the header describes. */
const coachRows = players.filter((p) => p.position === "Coach");
if (coachRows.length) {
  console.error("Refusing to generate: buildPool returned " + coachRows.length + " Coach row(s).");
  console.error("Head coaches are the site admins' (issue #40) and this file must not write them.");
  process.exit(1);
}

/* A hole in the pool is REPORTED, never quietly filled. A template that is silently one
 * quarterback short deals a broken week in every league created from it. */
if (gaps.length) {
  console.error("Refusing to generate: the feed could not fill " + gaps.length + " slot(s).");
  for (const g of gaps) console.error("  " + g.team + " " + g.position + " #" + g.wantedRank + " - " + g.reason);
  process.exit(1);
}

/* `player_pool_gsis_uniq` is a unique index. A player listed by two teams - which
 * happens for a day or two after a trade - would fail the migration halfway through a
 * push, so it is caught here where the answer is "look at it", not "retry". */
const seen = new Map();
for (const p of players) {
  const gsis = p.externalIds && p.externalIds.gsis;
  if (!gsis) continue;
  if (seen.has(gsis)) {
    console.error("Refusing to generate: two rows share gsis " + gsis + " - " +
      seen.get(gsis).name + " (" + seen.get(gsis).team + ") and " + p.name + " (" + p.team + ").");
    process.exit(1);
  }
  seen.set(gsis, p);
}

/* Ordered by team, then by position the way the artifact's pool was, so the file reads
 * down the league rather than jumping about. The coaches used to lead each team's block
 * and no longer appear at all; the ids run s1..s192 in this order. */
const ORDER = { QB: 1, RB: 2, WR: 3, TE: 4 };
const ordered = players.slice().sort((a, b) =>
  a.team === b.team
    ? ORDER[a.position] - ORDER[b.position] || (a.depthRank ?? 0) - (b.depthRank ?? 0)
    : a.team.localeCompare(b.team)
);

const counts = ordered.reduce((m, p) => ({ ...m, [p.position]: (m[p.position] || 0) + 1 }), {});
const values = ordered
  .map((p, i) => "  (" + [
    /* NOT p1..pN any more. The coach rows keep their existing legacy ids (p1, p8, p15 ...
     * on the 2026-08-29 template) and this file no longer writes them, so reusing that
     * numbering would collide on `player_pool.legacy_id`. An "s" for skill sidesteps it
     * without renumbering anybody, and legacy_id is opaque everywhere it is read. */
    q("s" + (i + 1)), q(p.name), q(p.position), q(p.team), q(p.status ?? "Active"), jsonb(p.externalIds),
  ].join(", ") + ")")
  .join(",\n");

process.stdout.write(
`-- ============================================================================
--  THE TEMPLATE, REBUILT FROM THE LIVE DEPTH CHARTS.
--
--  GENERATED by \`node scripts/generate-pool-migration.mjs --from-feed\`. Do not hand-edit:
--  regenerate it instead, into a NEW migration.
--
--  Snapshot:  ${chart.snapshotAt}   (nflverse depth_charts_${season}.csv)
--  Coaches:   NOT TOUCHED - the 32 already in the table are kept, see below
--  Rows:      ${ordered.length} skill players - ${Object.entries(counts).map(([k, v]) => v + " " + k).join(", ")}
--  Injuries:  ${rosterStatus ? "read from the weekly roster file" : "UNAVAILABLE - every status reads Active"}
--
--  WHY. \`player_pool\` is a TEMPLATE: \`copy_player_pool_into\` copies it into a league's
--  own \`players\` rows at creation, and nothing writes back to it except the site admins'
--  coaches screen, which owns the 32 rows this file leaves alone (issue #40). The pool
--  refresh (OQ-4b) rewrites ONE LEAGUE, so the template kept the names typed by hand in
--  2025 - "Derek Henry", "Kalil Shakir", Arizona's coach two coaches ago - and every
--  league created since was born holding them. This replaces it with each team's current
--  starters, carrying the provider ids the refresh and the coming stats pull match on.
--
--  WHAT THIS DOES NOT TOUCH, PART ONE: THE HEAD COACHES. They are the site admins',
--  edited on /admin and stored in these same 32 rows (issue #40). No feed may write one -
--  the free coach data had John Harbaugh at the Giants - so the delete below is filtered
--  by position and the insert carries no Coach row at all.
--
--  WHAT THIS DOES NOT TOUCH, PART TWO. Any league that already exists. Their \`players\` rows were
--  copied at creation and have diverged on purpose - a commissioner marking someone OUT
--  is a statement about HIS league. They are corrected by pressing Refresh Player Pool,
--  which is the only thing that may touch them.
--
--  STILL A STARTING POINT, not a substitute for that button: this snapshot ages from the
--  moment it is taken. It changes "born a year stale" into "born a few days stale".
-- ============================================================================

-- Replaced rather than merged: the skill half of the template has no history worth
-- keeping and nothing references it (no foreign key points at player_pool). The COACH
-- rows are excluded, because they are the one part of this table a person maintains.
delete from player_pool where position <> 'Coach';

insert into player_pool (legacy_id, name, position, nfl_team, status, external_ids) values
${values};
`
);
