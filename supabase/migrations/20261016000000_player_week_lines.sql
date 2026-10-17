-- ============================================================================
--  Every pool player's line, every NFL week. OQ-28, Scott 2026-10-16.
--
--  Scott: "i would like to make it so you can see the point totals of the bench players
--  and the free agents as well ... the bench and FA totals obviously do not count toward
--  a teams score, just the starters do" - and a season average on every player, "to help
--  with sit start scheme advice".
--
--  WHY A NEW TABLE. `stat_lines` is keyed by (period, team, SLOT): it holds the six
--  numbers each team's week is scored from, and nothing else. A bench player or a free
--  agent has no slot, so there is nowhere in it for his line to go - and making room
--  would mean teaching finalize to tell a counting row from a looking row, which is
--  exactly the kind of change to a played season this must not be.
--
--  So this table holds the FEED'S FACTS, one row per player per NFL week, and NOTHING
--  SCORES FROM IT. Finalize, the projection, standings and the playoffs never read it.
--  The roster rows read it to print a grey number beside a bench player and an average
--  beside everybody. Delete every row in it and no team's score moves.
--
--  PER LEAGUE, keyed on the league's own `players` row, rather than one global table
--  keyed on the provider id. Same reasoning as `players` being a per-league copy of the
--  pool: it inherits that table's read policy exactly, the browser needs no second
--  identity space to match it up, and deleting a league takes its rows with it.
--
--  WRITTEN ONLY BY THE STATS PULL, and whole-season each time: nflverse publishes one file
--  per season with every week in it, so one read fills in every week played so far -
--  including weeks before this table existed, and weeks a player spent on a bench.
--
--  ADDITIVE. No existing table, column or row is touched.
-- ============================================================================

create table player_week_lines (
  season_id  uuid not null references seasons(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  -- Denormalized from players so the read policy is the same one-column check every
  -- other league-scoped table uses.
  league_id  uuid not null references leagues(id) on delete cascade,
  nfl_week   int  not null check (nfl_week between 1 and 18),

  -- The feed's numbers, in the same split columns stat_lines uses. Numeric rather than
  -- int for the same reason raw_score went decimal: nothing here should round a fact.
  pass_yards numeric,
  pass_tds   numeric,
  rush_yards numeric,
  rush_tds   numeric,
  rec_yards  numeric,
  rec_tds    numeric,
  -- A head coach has no line; his card scores his team's result.
  coach_result text check (coach_result in ('Win','Tie','Loss')),

  feed_provider text not null default 'nflverse',
  updated_at    timestamptz not null default now(),

  primary key (season_id, nfl_week, player_id)
);
create index on player_week_lines (league_id);

comment on table player_week_lines is
  'OQ-28. The feed''s line for every pool player, every NFL week - for bench and free-agent points and season averages. DISPLAY ONLY: nothing scores from this table.';

-- ---------------------------------------------------------------------- RLS --
-- Readable exactly where `players` is readable. No write policy: the stats pull writes
-- with the secret key, and nothing in the browser ever writes here.
alter table player_week_lines enable row level security;

create policy read_player_week_lines on player_week_lines for select to anon, authenticated
  using (pp_can_read_league(league_id));

-- -------------------------------------------------------------------- GRANTS --
-- Hosted Supabase hands every new table GRANT ALL to the browser roles (see
-- 20260818020000_revoke_default_grants.sql). Take it back; give back only SELECT.
-- scripts/verify-grants.mjs lists this table under READABLE, which is what checks it.
revoke all privileges on player_week_lines from anon, authenticated;
grant select on player_week_lines to anon, authenticated;
grant all privileges on player_week_lines to service_role;
