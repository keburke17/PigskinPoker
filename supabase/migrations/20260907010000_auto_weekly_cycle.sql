-- ============================================================================
--  Running the weekly cycle on a clock, as a per-league opt-in. Issue #52.
--
--  Scott's request, recorded as OQ-14 in docs/OPEN-QUESTIONS.md: rosters dealt
--  automatically on Tuesday morning, schemes processed at 3am Thursday "just how
--  waivers would process in real fantasy football", standings updated when the
--  numbers are in.
--
--  BOTH DEFAULT TO FALSE, AND THAT IS THE WHOLE SAFETY STORY. A league must never
--  start dealing itself because we deployed something. Turning either on is a
--  commissioner's decision, made on his own screen, for his own league - the same
--  shape `auto_pull_stats` took in 20260905010000, and for the same reason.
--
--  TWO SWITCHES, NOT ONE OR THREE:
--
--    auto_process_schemes   the Thursday 3am deadline fires on its own
--    auto_advance_week      Tuesday morning: finalize the week, then deal the next
--
--  Finalize and deal are ONE switch because they are one act. `finalizeCurrentPeriod`
--  creates the period the deal acts on, so automating the deal without the finalize
--  would leave a league sitting in `pre-deal` all week waiting for a button. Keeping
--  the Thursday step separate is the setting that matters: a commissioner can let the
--  scheme deadline run itself - which is the half that changes how the league FEELS -
--  while keeping the finalize, which is the one step in this app with no undo, in his
--  own hands.
--
--  These grant no new power. Everything the scheduler does, the commissioner's own
--  buttons already do, through the same operations under the same phase guards. It
--  cannot start the playoffs, cannot deal past the end of the regular season, and
--  refuses to finalize a week whose games have not all finished. See server/autoCycle.js.
--
--  WHY `tz` IS HERE TOO. Cron is UTC and both times Scott named are local. 3am Eastern
--  is 07:00Z under EDT and 08:00Z under EST, and the 2026 season crosses the change on
--  1 November - so a single UTC schedule is an hour wrong for half the year, which for
--  the 3am job means firing at 2am or 4am relative to the deadline everyone was told
--  about. The functions run hourly and check the league's own local time instead.
--  Defaulting every league to Eastern is right for this league and wrong for one in
--  California; the column is one line now and a forward-only migration against a live
--  season later.
--
--  Deliberately NOT validated by a check constraint. The set of IANA zone names is not
--  something a constraint can express without freezing it, so the name is validated by
--  `isValidTimeZone` (server/tz.js) on the way in, and a value the runtime cannot use
--  falls back to Eastern at read time rather than stopping the league.
--
--  OPERATIONAL SETTINGS, NOT GAME RULES, which is why all three sit on `leagues`
--  beside `visibility` and `auto_pull_stats` rather than on `seasons` beside
--  `lineup_lock`. They say WHO presses the button and WHEN, not what the button does.
--
--  No new table, so no new RLS policies and nothing to add to SECRETS in
--  scripts/verify-grants.mjs: `leagues` already carries the policies that say who may
--  read it, and every write to it goes through the Netlify function on the secret key.
-- ============================================================================

alter table leagues
  add column auto_process_schemes boolean not null default false,
  add column auto_advance_week    boolean not null default false,
  add column tz                   text    not null default 'America/New_York';

comment on column leagues.auto_process_schemes is
  'Opt-in: a scheduled job may run processSchemes for this league once the weekly '
  'deadline (Thursday 3am, league local time) has passed. Server-owned - written only '
  'by setAutoCycle in server/operations.js, never carried in the app-state blob.';

comment on column leagues.auto_advance_week is
  'Opt-in: a scheduled job may finalize the current week and deal the next one, on '
  'Tuesday morning league local time, once every game of the mapped NFL week has '
  'finished. Never deals past the end of the regular season - starting the playoffs '
  'stays a commissioner act. Server-owned, as above.';

comment on column leagues.tz is
  'IANA timezone the league runs on, e.g. America/New_York. Decides when "3am '
  'Thursday" and "Tuesday morning" actually are, correctly across the daylight-saving '
  'change mid-season. Validated by server/tz.js, not by a check constraint.';
