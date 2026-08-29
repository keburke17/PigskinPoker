-- Split yards and touchdowns into passing / rushing / receiving.
--
-- The designer's answer to OQ-4c, 2026-08-28. Until now one `yards` figure and one `tds`
-- figure converted at one rate for every position, which made a quarterback's passing
-- yardage worth several times any other slot. Each category now converts at its own
-- commissioner-editable rate (defaults: 1 point per 25 passing yards, 1 per 10 rushing,
-- 1 per 10 receiving; 4 / 6 / 6 per touchdown).
--
-- WHY THE OLD COLUMNS STAY, AND ARE NOT BACKFILLED
--
-- A combined total does not say how much of it was passing, so a row written before
-- today cannot be split after the fact - any backfill would be inventing numbers. The
-- `yards` / `tds` columns therefore keep exactly what was entered, and the engine keeps
-- scoring those rows under the old rates (src/engine/scoring.js, the legacy branch).
-- Nothing written from now on populates them.
--
-- The feed mirrors are added alongside in the same shape, so that when the stats pull
-- lands there is no second migration and no backfill across a season being played.
--
-- Forward-only. Adds nullable columns; rewrites nothing; no data is touched.
-- Plan: docs/PHASE-4-PLAN.md section 3.

alter table stat_lines
  add column if not exists pass_yards int,
  add column if not exists pass_tds   int,
  add column if not exists rush_yards int,
  add column if not exists rush_tds   int,
  add column if not exists rec_yards  int,
  add column if not exists rec_tds    int,

  add column if not exists feed_pass_yards int,
  add column if not exists feed_pass_tds   int,
  add column if not exists feed_rush_yards int,
  add column if not exists feed_rush_tds   int,
  add column if not exists feed_rec_yards  int,
  add column if not exists feed_rec_tds    int;

comment on column stat_lines.yards is
  'LEGACY. Combined yards, all categories, as entered before the 2026-08-28 split '
  '(OQ-4c). Scored at scoring_config.yardsPerPoint. Never written by new code; cannot '
  'be backfilled into the per-category columns because a total does not say how much '
  'was passing.';

comment on column stat_lines.tds is
  'LEGACY. Combined touchdowns, as entered before the 2026-08-28 split. Scored at '
  'scoring_config.pointsPerTD. See stat_lines.yards.';

comment on column stat_lines.pass_yards is
  'Passing yards. Converts at scoring_config.passYardsPerPoint (default 25). A stat '
  'line carries either the six per-category columns or the legacy combined pair, never '
  'both - which is what selects the scoring path in src/engine/scoring.js.';

-- Scoring config is jsonb on `seasons` and gains six keys, but deliberately gets NO
-- migration: src/engine/scoring.js falls back to the defaults for any key a stored
-- config predates, and the commissioner screen merges the same way. So an existing
-- league keeps working untouched, and the first Save Scoring writes the full shape.
-- Changing the column default here would only affect seasons created afterwards and
-- would leave existing rows inconsistent with it.

-- Grants: no new table, so scripts/verify-grants.mjs has nothing further to check -
-- stat_lines' existing policies and grants cover the new columns unchanged.
