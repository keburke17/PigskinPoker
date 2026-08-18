-- ============================================================================
--  Public "a code has been set" flags.
--
--  WHY THIS EXISTS
--  The login screen has to decide between "enter your code" and "create the
--  commissioner login", and the team picker has to show which teams are joinable.
--  Both need to know WHETHER a code exists - never what it is.
--
--  That question cannot be answered from the client, and correctly so: the hashes
--  live in league_secrets / team_secrets, which have no policy and no grant, so the
--  publishable key cannot see them at all. Without these flags the app assumes no
--  commissioner code is set and offers to create one - which is exactly the bug this
--  fixes, found by driving the real login in the browser.
--
--  A boolean "this league has a commissioner" is a public fact, not a secret. It is
--  maintained server-side alongside the hash it describes.
--
--  Forward-only: 20260818000000 has already been applied locally, so this arrives as
--  its own migration rather than an edit to that file.
-- ============================================================================

alter table leagues add column has_commissioner_code boolean not null default false;
alter table teams   add column has_join_code         boolean not null default false;

-- Backfill from the secrets that already exist, so an existing database is correct
-- immediately rather than after the next code change.
update leagues l
   set has_commissioner_code = true
  from league_secrets s
 where s.league_id = l.id;

update teams t
   set has_join_code = true
  from team_secrets s
 where s.team_id = t.id;

-- No new policies needed: leagues and teams are already publicly readable, and these
-- columns are covered by those existing SELECT policies and grants. Deliberately NOT
-- adding any write grant - the flags are maintained only by the secret key.
