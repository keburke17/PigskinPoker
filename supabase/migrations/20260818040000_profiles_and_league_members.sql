-- ============================================================================
--  Phase 3b - accounts, and where a role actually lives.
--
--  THE INVERSION THIS BEGINS. Today the code IS the credential: type a team's
--  join code, get a session, and that session is the team. There is no person in
--  the system at all. That works exactly as long as there is one league and
--  everyone in it is a friend.
--
--  Afterwards the ACCOUNT is the credential and the code becomes an invitation.
--  You sign in as yourself, and your membership - which league, which role, which
--  team - is a row here rather than a property of a session token.
--
--  Nothing switches over in this migration. `verifySession()` accepts either
--  credential and resolves both to the same {leagueId, role, teamId}, so the
--  league carries on typing codes exactly as before and each person moves when
--  they choose. Code-as-login is switched off only once everyone has an account,
--  at a season boundary, never mid-season.
--
--  WHY auth.users IS NOT SHADOWED. Supabase owns that table. Adding columns to it
--  is the standard way to get hurt on an upgrade, and it makes the accounts layer
--  a migration of existing data rather than an addition alongside it. `profiles`
--  is the supported shape and keeps this schema's concerns separate from the auth
--  provider's.
-- ============================================================================

-- ---------------------------------------------------------------- profiles --
-- One row per PERSON, independent of any league. Deliberately almost empty: the
-- email lives in auth.users where Supabase manages it, and anything else here
-- would be a second source of truth for something the auth provider already owns.
create table profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------- league_members --
-- One row per person per league. THIS is where authorization moves to.
--
-- Commissioner is a ROLE ON THIS ROW, not a different kind of login - which is
-- what makes "commissioner of one league, manager in another" expressible at all.
-- Single-code auth literally cannot represent that, because the code is the
-- identity.
--
-- `role` mirrors the check on `sessions.role` on purpose: verifySession resolves
-- both credentials to the same shape, so the two vocabularies must not drift.
create table league_members (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references leagues(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('commissioner','manager')),
  -- Null for a commissioner, who acts for every team rather than one.
  team_id    uuid references teams(id) on delete set null,
  created_at timestamptz not null default now(),
  -- One membership per person per league. Redeeming an invitation twice is a
  -- no-op rather than a second membership; this is what makes that true.
  unique (league_id, user_id),
  check (role = 'commissioner' or team_id is not null)
);
create index on league_members (league_id);
create index on league_members (user_id);

-- ============================================================================
--  ROW LEVEL SECURITY
--
--  Reads only, and deliberately narrow: a signed-in person may see WHO THEY ARE
--  and WHAT THEY BELONG TO, nothing else. Every write still goes through the
--  Netlify function holding the secret key, exactly as every other write does.
--  Direct RLS-governed writes become possible now that there are real JWTs, but
--  that is an optimization and not this phase's business.
--
--  NOTE ON RECURSION, because it is the trap here. A policy on league_members
--  that asks "is the reader a member of this league?" queries league_members
--  from inside league_members' own policy, and Postgres will either recurse or
--  need a SECURITY DEFINER function to break the loop. Both policies below are
--  scoped to `auth.uid()` alone, which sidesteps it entirely. The app does not
--  need to read other people's memberships - it reads teams - so nothing is lost
--  by not writing the clever version.
-- ============================================================================
alter table profiles       enable row level security;
alter table league_members enable row level security;

create policy read_own_profile on profiles
  for select to authenticated
  using (user_id = auth.uid());

create policy read_own_memberships on league_members
  for select to authenticated
  using (user_id = auth.uid());

-- ============================================================================
--  GRANTS
--
--  Revoke-then-grant, repeated here because it must be. On a hosted project every
--  table is born with GRANT ALL to anon - the default privileges that
--  20260818020000 exists to undo apply to tables created after it too.
--
--  `anon` gets NOTHING. These tables are about signed-in people by definition,
--  and a signed-out visitor reading who belongs to which league would be a new
--  disclosure that no policy above intends.
-- ============================================================================
revoke all privileges on profiles       from anon, authenticated;
revoke all privileges on league_members from anon, authenticated;

grant select on profiles       to authenticated;
grant select on league_members to authenticated;

grant all privileges on profiles       to service_role;
grant all privileges on league_members to service_role;
