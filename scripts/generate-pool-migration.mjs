#!/usr/bin/env node
/* Generates the player_pool seed half of the pool migration from src/data/teamRows.js.
 *
 * WHY GENERATED, not hand-written: `teamRows.js` stays the single source of the pool.
 * `tests/parity.test.js` lifts TEAM_ROWS straight out of the original artifact and
 * compares dealing against it, so that file cannot move - and a second, hand-maintained
 * copy of 223 players in SQL would drift from it the first time anybody edited either.
 *
 *   node scripts/generate-pool-migration.mjs > /tmp/pool.sql
 *
 * The output is pasted into a migration once. Migrations are forward-only: to change the
 * pool later, add a new migration (or update the rows through the app) - never edit an
 * applied one.
 */

import { generatePlayerPool } from "../src/engine/pool.js";

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const pool = generatePlayerPool();

const values = pool
  .map((p) => "  (" + [q(p.id), q(p.name), q(p.position), q(p.team), q(p.status)].join(", ") + ")")
  .join(",\n");

process.stdout.write(
  "insert into player_pool (legacy_id, name, position, nfl_team, status) values\n" +
  values + "\non conflict (legacy_id) do nothing;\n"
);
