-- ============================================================================
--  The NFL injury report on every pool player. OQ-29, Scott 2026-10-17.
--
--  Scott: "players are being dealt to rosters with questionable injury tags. And then as
--  the week progresses, they may be listed as out. But managers don't have any way to see
--  whether or not these players are hurt for themselves" - and, once he had seen the
--  mockups, a pill (QUES / DOUBT / OUT) beside the name with a notepad that opens the
--  week's practice report.
--
--  DISPLAY ONLY, AND HE SAID SO TWICE. "This has nothing to do with the deal, correct?"
--  and later "Don't touch the deal quite yet." Nothing deals, schemes, scores, locks or
--  finalizes from this table. Delete every row in it and no game rule moves. Keeping a
--  player listed Out away from the deal was raised in the same conversation and parked -
--  it is a rules change and gets its own question first.
--
--  NOT `players.status`. That column is what the deal reads (only 'Active' is dealt), and
--  it carries the NFL's ROSTER designation - IR, practice squad, cut. The injury report is
--  a different fact about a player who is still on the active roster, and putting it in
--  the same column would quietly take Questionable players out of the deal.
--
--  PER LEAGUE, keyed on the league's own `players` row - the same reasoning as
--  player_week_lines (20261016000000): it inherits that table's read policy exactly, the
--  browser needs no second identity space, and deleting a league takes its rows with it.
--
--  ONE ROW PER PLAYER PER NFL WEEK, and `practice` grows through the week. nflverse's
--  injury file keeps only each player's LATEST reading, so the Wednesday / Thursday /
--  Friday history only exists if we save each day as it arrives: `practice` is
--  { "2026-10-14": "DNP", "2026-10-15": "LP", ... } keyed on the report's date. See
--  server/injuries.js for how a reading is dated.
--
--  WRITTEN ONLY BY THE INJURY PULL (server/operations.js, on a schedule and from the
--  commissioner's button). ADDITIVE: no existing table, column or row is touched.
-- ============================================================================

create table player_injuries (
  season_id  uuid not null references seasons(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  -- Denormalized from players so the read policy is the same one-column check every
  -- other league-scoped table uses.
  league_id  uuid not null references leagues(id) on delete cascade,
  nfl_week   int  not null check (nfl_week between 1 and 18),

  -- The game designation. Null all week until the final report gives one, and null for a
  -- player who practised through something and was not given one at all.
  game_status text check (game_status in ('Questionable', 'Doubtful', 'Out')),
  -- What is hurt, in the report's own words ("Ankle", "Hamstring", "Illness").
  injury      text,
  -- report date -> 'DNP' | 'LP' | 'FP'. Never shrinks: a later reading adds a day or
  -- corrects one, it does not take Wednesday away.
  practice    jsonb not null default '{}'::jsonb,
  -- The date of the newest report this row reflects.
  report_date date,

  feed_provider text not null default 'nflverse',
  -- When the REPORT last changed for this player, not when we last looked. The notepad's
  -- "new since you last opened it" dot reads this, so a pull that found nothing new must
  -- leave it alone.
  updated_at    timestamptz not null default now(),

  primary key (season_id, nfl_week, player_id)
);
create index on player_injuries (league_id);

comment on table player_injuries is
  'OQ-29. The NFL injury report for every pool player, by NFL week - game status, injury and the practice days. DISPLAY ONLY: nothing deals, scores or locks from this table.';

-- ---------------------------------------------------------------------- RLS --
-- Readable exactly where `players` is readable. No write policy: the injury pull writes
-- with the secret key, and nothing in the browser ever writes here.
alter table player_injuries enable row level security;

create policy read_player_injuries on player_injuries for select to anon, authenticated
  using (pp_can_read_league(league_id));

-- -------------------------------------------------------------------- GRANTS --
-- Hosted Supabase hands every new table GRANT ALL to the browser roles (see
-- 20260818020000_revoke_default_grants.sql). Take it back; give back only SELECT.
-- scripts/verify-grants.mjs lists this table under READABLE, which is what checks it.
revoke all privileges on player_injuries from anon, authenticated;
grant select on player_injuries to anon, authenticated;
grant all privileges on player_injuries to service_role;
