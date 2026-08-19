-- ============================================================================
--  Phase 3d - invitations, league visibility, and league-scoped reads.
--
--  This is the migration that makes MORE THAN ONE LEAGUE safe. Until now every
--  read policy in this schema was `using (true)`, which is exactly right for a
--  single public league and wrong the moment there are two - the second league's
--  rosters would be readable by the first league's browser.
-- ============================================================================

-- ------------------------------------------------------------ visibility ---
-- A CHECKED TEXT COLUMN, NOT A BOOLEAN, and that is a deliberate call.
--
-- A future landing-page door - "browse and join a public league" - needs a
-- DIRECTORY, and being listed in a directory is not the same claim as being
-- readable by link. A league might happily let a spouse read the standings from a
-- shared URL while having no interest in appearing in a public list.
--
-- So a later migration can add 'listed' and the read policies below need no
-- change: they already test for membership or for non-'members' visibility. A
-- boolean would have forced a column swap and a backfill to say the same thing.
alter table leagues
  add column visibility text not null default 'members'
    check (visibility in ('members', 'public'));

-- Every league that exists TODAY was created when the only behaviour was "anyone
-- with the link can read it". Defaulting them to 'members' would silently take
-- the standings away from the league that is actually being played, so existing
-- rows keep what they had. New leagues get the private default.
update leagues set visibility = 'public';

-- --------------------------------------------------------------- invites ---
-- What `team_secrets` becomes.
--
-- THE INVERSION: a join code AUTHENTICATES every session forever; an invite
-- AUTHORIZES one join and is then spent. That is what makes reissuing safe -
-- rotating an invite locks nobody out, because it was never what kept them in.
--
-- WHY THE CODE IS SPLIT INTO A REFERENCE AND A SECRET. Codes are hashed with
-- scrypt, which salts randomly, so a hash CANNOT be looked up by. Join codes get
-- away with this because you pick your team first and only then is one hash
-- checked. An invite has no such context - someone types a code and nothing else
-- - so the row has to be findable.
--
-- The alternative, storing a fast deterministic hash to index on, would make that
-- fast hash the weakest link and defeat the point of using scrypt at all. Instead
-- the code reads `REFERENCE-SECRET`: the reference is public, indexed, and
-- identifies the row; the secret is what scrypt protects. Nothing fast ever
-- guards anything.
create table invites (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references leagues(id) on delete cascade,
  -- Null means "join this league in this role" rather than "join this team", so
  -- the same mechanism issues both "you are team 3" and "help me run this".
  team_id    uuid references teams(id) on delete cascade,
  role       text not null check (role in ('commissioner','manager')),
  -- The public half. Safe to index and to look up by; it proves nothing.
  code_ref   text not null unique,
  -- The secret half, scrypt-hashed exactly like every other code here.
  code_hash  text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  -- Null means unlimited. Multi-use by DEFAULT, because the real social flow is
  -- pasting one code into a group chat - a single-use code would mean issuing six
  -- of them and tracking who used which.
  max_uses   int,
  uses       int not null default 0,
  revoked_at timestamptz,
  check (role = 'commissioner' or team_id is not null)
);
create index on invites (league_id);

-- ============================================================================
--  READING A LEAGUE
--
--  One question, asked in one place: may the current reader see league L?
--
--  SECURITY DEFINER IS REQUIRED HERE, not a shortcut. The policy on `leagues`
--  itself calls this function, and this function selects from `leagues` - under
--  the caller's rights that is infinite recursion. Definer rights break the loop.
--  `search_path` is pinned, which is the standard precaution for a definer
--  function: without it a caller could shadow `leagues` with their own table.
--
--  The function is deliberately narrow. It takes an id and returns a boolean; it
--  cannot be coaxed into returning data.
-- ============================================================================
create or replace function public.pp_can_read_league(l uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from leagues lg where lg.id = l and lg.visibility <> 'members')
      or exists (select 1 from league_members m where m.league_id = l and m.user_id = auth.uid());
$$;

-- The same question for tables that reach a league indirectly. Separate functions
-- rather than joins inlined into ten policies, so the rule lives in one place.
create or replace function public.pp_can_read_season(s uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select pp_can_read_league((select se.league_id from seasons se where se.id = s)); $$;

create or replace function public.pp_can_read_period(p uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select pp_can_read_league((
    select se.league_id from periods pe join seasons se on se.id = pe.season_id where pe.id = p
  ));
$$;

grant execute on function public.pp_can_read_league(uuid)  to anon, authenticated;
grant execute on function public.pp_can_read_season(uuid)  to anon, authenticated;
grant execute on function public.pp_can_read_period(uuid)  to anon, authenticated;

-- ============================================================================
--  THE READ POLICIES, REPLACED
--
--  Every one of these was `using (true)`. A signed-out visitor still reads a
--  'public' league exactly as before - auth.uid() is null for anon, and the
--  visibility branch carries it - so nothing changes for the league that is
--  being played today. What changes is that a league marked 'members' is now
--  invisible to everyone outside it.
-- ============================================================================
drop policy read_leagues        on leagues;
drop policy read_seasons        on seasons;
drop policy read_teams          on teams;
drop policy read_team_totals    on team_totals;
drop policy read_players        on players;
drop policy read_periods        on periods;
drop policy read_roster_slots   on roster_slots;
drop policy read_stat_lines     on stat_lines;
drop policy read_period_results on period_results;
drop policy read_events         on events;
drop policy read_resolved_schemes on schemes;

create policy read_leagues on leagues for select to anon, authenticated
  using (pp_can_read_league(id));
create policy read_seasons on seasons for select to anon, authenticated
  using (pp_can_read_league(league_id));
create policy read_teams on teams for select to anon, authenticated
  using (pp_can_read_league(league_id));
create policy read_players on players for select to anon, authenticated
  using (pp_can_read_league(league_id));
create policy read_team_totals on team_totals for select to anon, authenticated
  using (pp_can_read_season(season_id));
create policy read_events on events for select to anon, authenticated
  using (pp_can_read_season(season_id));
create policy read_periods on periods for select to anon, authenticated
  using (pp_can_read_season(season_id));
create policy read_roster_slots on roster_slots for select to anon, authenticated
  using (pp_can_read_period(period_id));
create policy read_stat_lines on stat_lines for select to anon, authenticated
  using (pp_can_read_period(period_id));
create policy read_period_results on period_results for select to anon, authenticated
  using (pp_can_read_period(period_id));

-- schemes keeps its resolved_at gate ON TOP of league scoping (OQ-9): an
-- unresolved scheme must not leak mid-week even to the league it belongs to.
create policy read_resolved_schemes on schemes for select to anon, authenticated
  using (resolved_at is not null and pp_can_read_period(period_id));

-- ============================================================================
--  GRANTS
--
--  invites joins the unreachable set: RLS on, no policy, no browser grant. It
--  holds code hashes, and it is the thing that grants membership.
-- ============================================================================
alter table invites enable row level security;   -- and NO policy, ever

revoke all privileges on invites from anon, authenticated;
grant all privileges on invites to service_role;
