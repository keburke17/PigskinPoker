-- ============================================================================
--  Automatic stats pulls, as a per-league opt-in.
--
--  Stage 7 of docs/PHASE-4-PLAN.md. A scheduled Netlify function runs the SAME
--  operation the commissioner's "Pull Stats" button runs, on the same guards, for
--  every league that has turned this on.
--
--  DEFAULT IS FALSE, AND THAT IS THE POINT. A league must never start having numbers
--  written into it by a job because we deployed one. Turning it on is a commissioner's
--  decision, made on his own screen, for his own league.
--
--  This is an OPERATIONAL setting, not a game rule, which is why it sits on `leagues`
--  beside `visibility` rather than on `seasons` beside `lineup_lock`. It says who
--  presses the button, not what the button does - the numbers, the guards and the
--  "never overwrite a manual line" promise are identical either way. Nothing about the
--  commissioner-driven weekly flow changes: he still deals, processes, locks and
--  finalizes, and a pull still refuses unless he has locked the rosters.
--
--  No new table, so no new RLS policies and nothing to add to SECRETS in
--  scripts/verify-grants.mjs: `leagues` already carries the policies that say who may
--  read it, and every write to it goes through the Netlify function on the secret key.
-- ============================================================================

alter table leagues
  add column auto_pull_stats boolean not null default false;

comment on column leagues.auto_pull_stats is
  'Opt-in: a scheduled job may run pullStats for this league. Server-owned in the same '
  'sense as periods.nfl_week - written only by setAutoPullStats in server/operations.js, '
  'never carried in the app-state blob, so an ordinary write cannot flip it.';
