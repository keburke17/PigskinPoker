-- A week's score is no longer a whole number.
--
-- OQ-15 (2026-09-07) gave scoring one decimal place, and this column was missed. The
-- engine and every screen were right; the database still refused the number, so
-- finalizing a week died on:
--
--   upsert period_results: invalid input syntax for type integer: "26.2"
--
-- Found by Scott playing test weeks locally on 2026-09-08, which is the only place it
-- could have been found: `period_results` is written by decompose, and the engine tests
-- that cover the new scoring never touch a database. The server suite finalizes weeks,
-- but its stat lines happened to land on whole numbers.
--
-- WHY numeric(8,1) AND NOT plain numeric. The scale is the rule, written where the data
-- lives: `roundPoints` in src/engine/scoring.js rounds every score to one decimal, and a
-- column that accepts two would let a future change drift away from that silently and
-- only show up as an odd-looking scoreboard. 8 digits is far more than a week can score.
--
-- ONLY THIS COLUMN. `standings_points` is the rank ladder - team count down to 1 - and is
-- genuinely an integer, as are `tds`, `yards` and everything on `team_totals`. A player's
-- best single-week score does carry a decimal, but it lives inside a `jsonb` column and
-- needed nothing.
--
-- Existing rows are unaffected: every score written before this was a whole number, and
-- an integer widens to numeric without loss.

alter table public.period_results
  alter column raw_score type numeric(8,1) using raw_score::numeric(8,1);

comment on column public.period_results.raw_score is
  'A team score for one period, to one decimal place. See OQ-15 and roundPoints() in src/engine/scoring.js.';

-- No RLS changes. The table keeps the policies it was created with; this is the same
-- column, the same readers and the same writer, holding a wider number.
