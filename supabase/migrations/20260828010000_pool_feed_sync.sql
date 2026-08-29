-- Let the player pool be refreshed from a live feed, without ever overruling the
-- commissioner.
--
-- The designer's answer to OQ-4b, 2026-08-28: the hand-typed pool was typed out of
-- necessity, not curated, so it is rebuilt from each NFL team's current starters -
-- 1 QB, 2 RB, 2 WR, 1 TE and 1 head coach, 224 rows. Refreshes are pressed by the
-- commissioner in the pre-deal phase and never run on their own.
--
-- THE RULE THIS SCHEMA EXISTS TO ENFORCE: a refresh may correct anything it put there
-- itself, and nothing a person decided. `source` records where a row came from and
-- `status_source` records who last set its status; the refresh only ever writes over
-- its own work. That is the same provenance pattern stat_lines already uses.
--
-- Forward-only. Adds nullable/defaulted columns and two indexes. No row is deleted and
-- no status is changed by this migration.
-- Plan: docs/PHASE-4-PLAN.md section 4.

alter table players
  -- Depth-chart rank the refresh picked this player at (1 = the team's starter, 2 = the
  -- second back or receiver). Recorded so a disputed pool can be audited.
  add column if not exists depth_rank int,

  -- Where the row came from. 'seed' is the hand-typed template every league was created
  -- from; 'feed' is the refresh; 'manual' is a player the commissioner added himself.
  -- A refresh may retire 'seed' and 'feed' rows. It must never touch a 'manual' one.
  add column if not exists source text not null default 'seed'
    check (source in ('seed', 'feed', 'manual')),

  -- Who last set `status`. 'manual' means the commissioner decided, and the feed is not
  -- allowed to change it back - marking someone OUT is a statement about THIS league.
  add column if not exists status_source text not null default 'default'
    check (status_source in ('default', 'feed', 'manual')),

  -- What the feed last said, kept even after a manual override, so the UI can show
  -- "the feed says he is starting, you have him OUT" rather than silently disagreeing.
  add column if not exists feed_status text
    check (feed_status is null or feed_status in ('Active', 'OUT', 'IR', 'BYE')),
  add column if not exists feed_updated_at timestamptz;

-- Any status that is not the default was set by a person, because nothing else could
-- have set it before today. Preserve that intent rather than letting the first refresh
-- overwrite it.
update players set status_source = 'manual' where status <> 'Active';

-- The index the initial schema's comment anticipated: "once a provider is chosen, add a
-- unique index on the extracted id so pool reconciliation cannot silently double-match."
-- Scoped per league, because players rows belong to one league and two leagues holding
-- the same NFL player is normal and correct.
create unique index if not exists players_league_gsis_uniq
  on players (league_id, (external_ids ->> 'gsis'))
  where external_ids ? 'gsis';

-- Same for the template, which every new league is copied from.
create unique index if not exists player_pool_gsis_uniq
  on player_pool ((external_ids ->> 'gsis'))
  where external_ids ? 'gsis';

-- ---------------------------------------------------------------------------
-- League week is not NFL week.
--
-- `periods` has `number` and `seasons` has `year`, and nothing connected either to a
-- week of the NFL season. League week 1 is only NFL week 1 if the league happened to
-- start on opening weekend. Nullable and correctable: a league starting late, a bye
-- schedule, or next season all break the coincidence.
alter table periods
  add column if not exists nfl_week int check (nfl_week is null or nfl_week between 1 and 23);

comment on column periods.nfl_week is
  'Which NFL week this league period maps to. Null means unmapped. Set when the period '
  'is created and correctable by the commissioner; a stats pull cannot fetch without it.';

-- Grants: no new table, so scripts/verify-grants.mjs has nothing further to check. The
-- new columns inherit players'/periods' existing policies and grants unchanged.
