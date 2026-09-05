-- ============================================================================
--  Lineup lock timing, as a league option.
--
--  Two policies, chosen per league (see src/engine/lineupLock.js):
--
--    'gametime'  each player locks when his own NFL team kicks off - the rule the
--                rules screen has always described, enforced until now by the
--                commissioner pressing Lock on each player by hand.
--    'weekly'    the whole lineup locks at the first kickoff of the week, which is
--                Thursday night in most weeks.
--
--  DEFAULT IS 'gametime' ON PURPOSE: it is what every existing league is already
--  playing, so applying this migration changes nobody's rules. A league only moves
--  to 'weekly' when its commissioner chooses it.
--
--  periods.kickoffs is SERVER-OWNED, in the same family as nfl_week, deal_seed and
--  scheme_seed: written by direct update from server/operations.js after reading the
--  schedule, never derived from the app-state blob. decompose.js does not carry it,
--  which is what stops an ordinary blob write from putting null over a week's times.
--  See the comment at the top of server/schedule.js - this is the same rule.
-- ============================================================================

alter table seasons
  add column lineup_lock text not null default 'gametime'
    check (lineup_lock in ('gametime', 'weekly'));

alter table periods
  -- { "Buffalo Bills": "2026-09-13T17:00:00.000Z", ... } - the NFL team names the
  -- player pool uses, so a lock can be decided from a player row alone.
  add column kickoffs jsonb,
  add column kickoffs_read_at timestamptz;

-- No new tables, so no new RLS policies and nothing new for scripts/verify-grants.mjs:
-- both columns live on tables whose policies already say who may read them, and neither
-- table grants write to the browser role at all.
