-- ============================================================================
--  The weekly recap. OQ-31, Scott 2026-10-19.
--
--  Scott: when a week ends "it just deals out the next weeks players, and the only way
--  you can see how you did was by looking at the weekly scoreboard ... a team logs in and
--  then they don't see anything unless they go looking for it". He asked for a short,
--  funny write-up of each team's week - the finish, the standings move, the steal that
--  backfired, the bench that outscored the lineup - popping up the first time a manager
--  opens the app after the week is finalized, with a way through to the scoreboard and the
--  standings, and kept so it can be read again. Free: no AI, every word from a list of
--  lines (src/recap/lines.js).
--
--  NOTHING IN THE GAME READS ANY OF THIS. Delete every row and no rule, score or standing
--  moves. ADDITIVE: two nullable-or-defaulted columns and one new table.
--
--  1. periods.scheme_moves - what each scheme did. Scheme processing rewrites
--     roster_slots in place, so by finalize nothing records who a steal brought in or
--     whose roster he came from. The server captures it at the one moment both rosters
--     exist (src/recap/moves.js) and writes it here. Server-owned like `kickoffs`: absent
--     from decompose, so an ordinary blob write never touches it.
--
--  2. seasons.recap_deck - which lines this season's recaps have already used, so no line
--     is used twice in a season. Short hashes of the line text, by list. Server-owned.
--
--  3. weekly_recaps - one row per team per finalized week: the recap as written. Written
--     once at finalize with the secret key and never edited, so every manager reads the
--     same words and a recap cannot change after the fact.
-- ============================================================================

alter table periods add column scheme_moves jsonb;
comment on column periods.scheme_moves is
  'OQ-31. What each block, steal and redraw did, captured when schemes were processed. Read by the weekly recap only.';

alter table seasons add column recap_deck jsonb not null default '{}'::jsonb;
comment on column seasons.recap_deck is
  'OQ-31. The weekly recap lines already used this season, so none repeats. Server-owned.';

create table weekly_recaps (
  period_id  uuid not null references periods(id) on delete cascade,
  team_id    uuid not null references teams(id) on delete cascade,
  -- Denormalized so the read policy is the same one-column check every other
  -- league-scoped table uses.
  league_id  uuid not null references leagues(id) on delete cascade,
  -- The recap exactly as the pop-up draws it: headline, story, place, score, standings
  -- move, MVP and dud, notes. Carries its own shape version (`v`).
  recap      jsonb not null,
  created_at timestamptz not null default now(),
  primary key (period_id, team_id)
);
create index on weekly_recaps (league_id);

comment on table weekly_recaps is
  'OQ-31. Each team''s weekly recap, written once at finalize. Display only: nothing in the game reads it.';

-- ---------------------------------------------------------------------- RLS --
-- Readable by anyone who can read the league, like the results it describes. No write
-- policy: finalize writes with the secret key, and nothing in the browser writes here.
alter table weekly_recaps enable row level security;

create policy read_weekly_recaps on weekly_recaps for select to anon, authenticated
  using (pp_can_read_league(league_id));

-- -------------------------------------------------------------------- GRANTS --
-- Hosted Supabase hands every new table GRANT ALL to the browser roles (see
-- 20260818020000_revoke_default_grants.sql). Take it back; give back only SELECT.
-- scripts/verify-grants.mjs lists this table under READABLE, which is what checks it.
revoke all privileges on weekly_recaps from anon, authenticated;
grant select on weekly_recaps to anon, authenticated;
grant all privileges on weekly_recaps to service_role;
