-- The NFL week a league's playoffs take over from the regular season.
--
-- OQ-16, answered by Scott on 2026-09-07. The playoffs used to wait on a Start Playoffs
-- button, and that button could not survive the weekly cycle running on a clock
-- (20260907010000_auto_weekly_cycle.sql). A league whose last regular week is 15 has its
-- week 16 rosters dealt to EVERY team at 6am on the Tuesday; by the time a commissioner
-- is awake to press the button, teams with no business in the playoffs are already
-- holding lineups. Scott: "if the commish hit start playoffs the rosters are already
-- dealt, and multiple teams that are not in playoff contention would have rosters. which
-- shouldnt happen."
--
-- So the bracket now starts itself. `finalize_period` seeds it the moment the previous
-- week is scored and the next NFL week has reached this one - whichever hand finalized,
-- the clock's or the commissioner's - and the button is gone.
--
-- NULL MEANS "NEVER", NOT "NOT YET". There is no manual start any more, so a league that
-- leaves this unset plays regular weeks until the schedule runs out. That is a real trap
-- and it is guarded on screen: the league setup checklist asks for it, and the Playoffs
-- panel says plainly that the playoffs will not start without it. It is nullable anyway
-- because every league that already exists has no answer for it, and inventing one would
-- be choosing a league's playoff date for them.
--
-- An NFL week, not the league's own week counter. Scott: "if the league selects to have
-- playoff start in week 16, that would be week 16 of the nfl season." A league that
-- joined in NFL week 3 calls that its week 3, so the two counters differ and the football
-- calendar is the one that decides.

alter table public.seasons
  add column if not exists playoff_start_nfl_week int
    check (playoff_start_nfl_week is null
           or (playoff_start_nfl_week between 1 and 23));

comment on column public.seasons.playoff_start_nfl_week is
  'NFL week the playoffs begin. NULL means the league has not set one, and the bracket will never start on its own. See OQ-16.';

-- No RLS changes. `seasons` already carries its policies from the initial schema, and a
-- new column on an existing table inherits them - this is one more field on a row the
-- same people could already read and the same server key could already write.
