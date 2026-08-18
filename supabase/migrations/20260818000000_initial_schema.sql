-- ============================================================================
--  Pigskin Poker - initial schema
--
--  Design and rationale: docs/DATA-MODEL.md (approved Phase 0).
--
--  GROUND RULE: every table enables RLS and declares its policies IN THIS FILE.
--  There is no "we'll add RLS later" migration. If you add a table, add its
--  policies in the same migration or the table ships unreadable.
--
--  SECURITY MODEL, in one paragraph:
--    The publishable key ships to every browser. Assume an attacker holds it and
--    calls PostgREST directly, ignoring our UI. So: the publishable key gets
--    SELECT on what the league is meant to see, and INSERT/UPDATE/DELETE on
--    NOTHING. Every write goes through a server-side function holding the secret
--    key, which authenticates the caller and enforces the commissioner/manager
--    rule in code. RLS is the backstop that makes routing around that useless.
--    No secret (join codes, commissioner code, their hashes) lives in any table
--    the publishable key can reach.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- leagues --
create table leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Pigskin Poker',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- seasons --
create table seasons (
  id                        uuid primary key default gen_random_uuid(),
  league_id                 uuid not null references leagues(id) on delete cascade,
  year                      int  not null,
  label                     text,
  status                    text not null default 'active'
                              check (status in ('active','complete','archived')),
  -- Shape version of the app-state DOCUMENT (backups), not of this schema.
  schema_version            int  not null default 2,

  scoring_config            jsonb not null
                              default '{"yardsPerPoint":10,"pointsPerTD":5,"coachWin":2,"coachTie":1,"coachLoss":0}'::jsonb,
  standings_points_override int[],          -- null = derive from team count

  playoff_bracket_size      int  not null default 4,
  playoff_advancement       int[] not null default '{4,2,1}',
  playoff_started           boolean not null default false,
  playoff_completed         boolean not null default false,
  playoff_round_index       int  not null default 0,
  champion_team_id          uuid,           -- FK added after teams exists

  version                   int  not null default 1,
  created_at                timestamptz not null default now(),
  unique (league_id, year)
);
create index on seasons (league_id);

-- ------------------------------------------------------------------ teams --
-- Teams belong to the LEAGUE and persist across seasons.
create table teams (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references leagues(id) on delete cascade,
  name        text not null,
  legacy_id   text,                          -- 'team_ab12cd' from the artifact export
  -- Soft delete: onRemoveTeam must not orphan finalized results or past rosters.
  active      boolean not null default true,
  version     int  not null default 1,
  created_at  timestamptz not null default now(),
  unique (league_id, legacy_id)
);
create index on teams (league_id);

alter table seasons
  add constraint seasons_champion_fk
  foreign key (champion_team_id) references teams(id) on delete set null;

-- ------------------------------------------------------------ team_totals --
-- Mirrors team.cumulative / team.playoffCumulative from the artifact.
-- Materialized rather than derived: the tiebreak reads these, and they must be
-- the values as of finalize time. Recomputable from period_results for audit.
create table team_totals (
  id                uuid primary key default gen_random_uuid(),
  season_id         uuid not null references seasons(id) on delete cascade,
  team_id           uuid not null references teams(id) on delete cascade,
  scope             text not null check (scope in ('regular','playoff')),
  standings_points  int not null default 0,
  week_wins         int not null default 0,
  coach_wins        int not null default 0,
  total_tds         int not null default 0,
  total_yards       int not null default 0,
  best_player       jsonb,                   -- {name, position, points, periodLabel}
  version           int not null default 1,
  unique (season_id, team_id, scope)
);
create index on team_totals (season_id);

-- ---------------------------------------------------------------- players --
create table players (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references leagues(id) on delete cascade,
  name          text not null,
  position      text not null check (position in ('Coach','QB','RB','WR','TE')),
  nfl_team      text not null,
  status        text not null default 'Active'
                  check (status in ('Active','OUT','IR','BYE')),
  -- Phase 4 seam. Once a provider is chosen, add a unique index on the extracted
  -- id so pool reconciliation cannot silently double-match.
  external_ids  jsonb not null default '{}'::jsonb,
  legacy_id     text,                        -- 'p1' .. 'pN'
  active        boolean not null default true,
  version       int not null default 1,
  created_at    timestamptz not null default now(),
  unique (league_id, legacy_id)
);
create index on players (league_id, position, status);

-- ---------------------------------------------------------------- periods --
create table periods (
  id                   uuid primary key default gen_random_uuid(),
  season_id            uuid not null references seasons(id) on delete cascade,
  type                 text not null check (type in ('week','playoff')),
  number               int  not null,
  -- NOTE: five phases. The artifact's comment listed four but the code also set
  -- 'schemes-processed'. The code is the truth.
  phase                text not null default 'pre-deal'
                         check (phase in ('pre-deal','dealt','schemes-processed','stats','finalized')),
  roster_locked        boolean not null default false,
  -- Was playoffConfig.activeTeamIds. Per-period so each round's field is history.
  -- Deliberately an array, not a join table: always read whole, never filtered on.
  participant_team_ids uuid[] not null default '{}',

  -- P5: makes a deal replayable and auditable, and stops a client re-rolling a
  -- deal it disliked. Seeds are generated server-side.
  deal_seed            text,
  scheme_seed          text,
  pool_snapshot        jsonb,   -- eligible player ids by position AT DEAL TIME

  version              int  not null default 1,
  dealt_at             timestamptz,
  finalized_at         timestamptz,
  created_at           timestamptz not null default now(),
  unique (season_id, type, number)
);
create index on periods (season_id);

-- ----------------------------------------------------------- roster_slots --
-- One row per slot per team per period: 12 rows per team per week.
-- Keyed by PERIOD, so rosters survive finalize (the artifact wiped them).
create table roster_slots (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references periods(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  area        text not null check (area in ('starter','bench')),
  slot        text check (slot in ('Coach','QB','WR','RB','TE','FLEX')),
  bench_index int check (bench_index between 0 and 5),
  -- NULLABLE ON PURPOSE: a steal with an empty free-agent pool genuinely leaves a
  -- slot empty and the app renders that. Do not make this NOT NULL.
  player_id   uuid references players(id) on delete set null,
  locked      boolean not null default false,   -- was lockedPlayerIds
  version     int not null default 1,
  check ( (area = 'starter' and slot is not null and bench_index is null)
       or (area = 'bench'   and slot is null     and bench_index is not null) )
);
-- NULLs are distinct in a plain UNIQUE, so use two partial indexes instead.
create unique index roster_slots_starter_uniq
  on roster_slots (period_id, team_id, slot)        where area = 'starter';
create unique index roster_slots_bench_uniq
  on roster_slots (period_id, team_id, bench_index) where area = 'bench';
create index on roster_slots (period_id, player_id);

-- ------------------------------------------------------------- stat_lines --
-- Keyed by SLOT, not player - matches the artifact (statsEntry[teamId][slot]).
-- player_id is denormalized at entry time so per-player season queries work.
create table stat_lines (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null references periods(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  slot         text not null check (slot in ('Coach','QB','WR','RB','TE','FLEX')),
  player_id    uuid references players(id) on delete set null,

  -- Effective values: what the scoring engine reads.
  yards        int,
  tds          int,
  coach_result text check (coach_result in ('Win','Tie','Loss')),
  -- OQ-4: manual entry was the only option in the artifact, not a preference.
  -- Provenance ships now because retrofitting it later means a migration plus a
  -- backfill over live season data.
  source       text not null default 'manual' check (source in ('manual','feed')),

  -- Last values a feed reported, retained even after a manual override, so the UI
  -- can show "the feed says 91, you set 84" and offer a revert. Null until Phase 4.
  feed_yards        int,
  feed_tds          int,
  feed_coach_result text check (feed_coach_result in ('Win','Tie','Loss')),
  feed_provider     text,
  feed_updated_at   timestamptz,

  version      int not null default 1,
  updated_at   timestamptz not null default now(),
  unique (period_id, team_id, slot)
);
create index on stat_lines (period_id, player_id);

-- ---------------------------------------------------------------- schemes --
-- Retained after resolution (the artifact deleted them) so history is queryable.
-- Secrecy is enforced by RLS + the resolved_at gate, not by deletion. See OQ-9.
create table schemes (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null references periods(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  type         text not null check (type in ('block','steal','redraw','noaction')),
  position     text check (position in ('QB','WR','RB','TE')),  -- Coach never selectable
  player_id    uuid references players(id) on delete set null,
  submitted_at timestamptz not null default now(),
  resolved_at  timestamptz,
  -- What actually happened. The artifact silently skips a scheme whose player has
  -- moved and logs nothing, making an abandoned scheme indistinguishable from
  -- No Action. Recording it removes that ambiguity.
  outcome      text check (outcome in ('applied','skipped','no-victim','no-replacement')),
  version      int not null default 1,
  check (type = 'noaction' or (position is not null and player_id is not null)),
  unique (period_id, team_id)
);

-- --------------------------------------------------------- period_results --
create table period_results (
  id               uuid primary key default gen_random_uuid(),
  period_id        uuid not null references periods(id) on delete cascade,
  team_id          uuid not null references teams(id) on delete cascade,
  rank             int  not null,
  raw_score        int  not null,
  standings_points int  not null,
  coach_result     text check (coach_result in ('Win','Tie','Loss')),
  tds              int  not null default 0,
  yards            int  not null default 0,
  best_player      jsonb,
  created_at       timestamptz not null default now(),
  unique (period_id, team_id)
);

-- ----------------------------------------------------------------- events --
-- The activity log. `text` is preserved verbatim so the existing UI renders
-- unchanged; `payload` is the new structured layer that makes history queryable.
create table events (
  id         uuid primary key default gen_random_uuid(),
  season_id  uuid not null references seasons(id) on delete cascade,
  period_id  uuid references periods(id) on delete set null,
  type       text not null,   -- deal|block|steal|steal-failed|redraw|warning
                              -- |result|advance|champion|playoffs-start
  text       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on events (season_id, created_at desc);

-- ============================================================================
--  SECRETS
--  RLS enabled, ZERO policies -> unreachable with the publishable key by
--  construction. Only the secret key (which bypasses RLS, server-side) reads
--  these. NEVER add a policy to these three tables.
-- ============================================================================
create table league_secrets (
  league_id              uuid primary key references leagues(id) on delete cascade,
  commissioner_code_hash text not null,
  updated_at             timestamptz not null default now()
);

create table team_secrets (
  team_id        uuid primary key references teams(id) on delete cascade,
  join_code_hash text not null,
  updated_at     timestamptz not null default now()
);

-- Phase 2 session store. Phase 3 replaces this with Supabase Auth (auth.users +
-- profiles + league_members) so RLS can scope by JWT instead of a function hop.
-- Tracked as a deliberate stopgap in docs/DATA-MODEL.md section 8.
create table sessions (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  league_id  uuid not null references leagues(id) on delete cascade,
  role       text not null check (role in ('commissioner','manager')),
  team_id    uuid references teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (role = 'commissioner' or team_id is not null)
);
create index on sessions (expires_at);

-- ============================================================================
--  ROW LEVEL SECURITY
--  Explicit on every table - the migration must be self-contained so a project
--  WITHOUT the auto-RLS event trigger (my friend's own instance) comes out
--  identical to one with it.
-- ============================================================================
alter table leagues        enable row level security;
alter table seasons        enable row level security;
alter table teams          enable row level security;
alter table team_totals    enable row level security;
alter table players        enable row level security;
alter table periods        enable row level security;
alter table roster_slots   enable row level security;
alter table stat_lines     enable row level security;
alter table schemes        enable row level security;
alter table period_results enable row level security;
alter table events         enable row level security;
alter table league_secrets enable row level security;   -- and NO policy, ever
alter table team_secrets   enable row level security;   -- and NO policy, ever
alter table sessions       enable row level security;   -- and NO policy, ever

-- Public-readable league state.
create policy read_leagues        on leagues        for select to anon, authenticated using (true);
create policy read_seasons        on seasons        for select to anon, authenticated using (true);
create policy read_teams          on teams          for select to anon, authenticated using (true);
create policy read_team_totals    on team_totals    for select to anon, authenticated using (true);
create policy read_players        on players        for select to anon, authenticated using (true);
create policy read_periods        on periods        for select to anon, authenticated using (true);
create policy read_roster_slots   on roster_slots   for select to anon, authenticated using (true);
create policy read_stat_lines     on stat_lines     for select to anon, authenticated using (true);
create policy read_period_results on period_results for select to anon, authenticated using (true);
create policy read_events         on events         for select to anon, authenticated using (true);

-- Schemes are secret until resolved: "Schemes are never shown to other managers -
-- only the resulting roster." An unresolved scheme is invisible to everyone; a
-- manager's own pending scheme is served by the function that knows their session.
create policy read_resolved_schemes on schemes for select to anon, authenticated
  using (resolved_at is not null);

-- NO insert/update/delete policy is created on ANY table, for ANY role.
-- That is deliberate and is the entire write-security model. Adding one is a
-- decision to be argued for, not a fix for "my write didn't work".

-- ============================================================================
--  TABLE PRIVILEGES
--
--  READ THIS BEFORE DEBUGGING A "permission denied for table" ERROR.
--
--  RLS and GRANTs are two independent gates and BOTH must pass:
--    - a GRANT decides whether a role may touch the table at all;
--    - an RLS policy decides which ROWS it then sees.
--  A table with a perfect policy and no GRANT is unreachable by everyone,
--  including the secret key - the secret key bypasses RLS, but NOT privileges.
--
--  Supabase's hosted default privileges usually grant these implicitly, which is
--  precisely why it is worth doing explicitly: this migration has to produce an
--  identical result in a project that does not have those defaults set up.
-- ============================================================================
grant usage on schema public to anon, authenticated, service_role;

-- The secret key, used only server-side, needs full access to everything.
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- The publishable key: SELECT on league-visible tables. Nothing else, nowhere else.
grant select on
  leagues, seasons, teams, team_totals, players,
  periods, roster_slots, stat_lines, period_results, events
  to anon, authenticated;

-- schemes gets a COLUMN-level grant, narrower than its row policy above.
-- `submitted_at` is stored by the artifact but never displayed in it, so exposing
-- it would be the only genuinely NEW disclosure in this schema (who submitted
-- early vs. late). Withholding it keeps the answer to "does this leak anything
-- the league can't already see?" a clean no.
grant select (id, period_id, team_id, type, position, player_id, resolved_at, outcome)
  on schemes to anon, authenticated;
-- CONSEQUENCE, and a real trap: a client must NAME these columns. `select('*')` on
-- schemes expands to every column including submitted_at and fails outright with
-- 42501 - it does not silently omit the ungranted column. Asserted in tests/rls.test.js.

-- league_secrets, team_secrets and sessions get NO grant to anon/authenticated.
-- Not a policy, not a column grant, nothing. That is the point of them.

-- ============================================================================
--  REALTIME
--  postgres_changes respects RLS, so this leaks nothing beyond the read policies
--  above. Tables must be added to the publication explicitly - easy to forget,
--  so it lives here rather than in the dashboard.
-- ============================================================================
alter publication supabase_realtime add table periods;
alter publication supabase_realtime add table roster_slots;
alter publication supabase_realtime add table stat_lines;
alter publication supabase_realtime add table period_results;
alter publication supabase_realtime add table team_totals;
alter publication supabase_realtime add table events;
alter publication supabase_realtime add table teams;
-- schemes deliberately NOT published: a change event would leak that a scheme was
-- submitted, and its row, to subscribers mid-week.
