-- ============================================================================
--  RETIRE JOIN CODES AND THE HAND-ROLLED SESSION TABLE.
--
--  Accounts authenticate; invitations authorize. Both halves of the old scheme are
--  removed here, and nothing in the application reads them any more.
--
--  WHY, in one line each:
--
--    league_secrets / team_secrets - a join code WAS the identity. Sharing one was
--      account sharing, rotating one signed a whole team out to remove one person, and
--      it could never be read back to whoever lost it. `invites` does the job people
--      actually wanted: authorize ONE join, then be spent.
--
--    sessions - hand-rolled auth: a hashed token, a role, an expiry, an idle window and
--      a refresh, all maintained by us. docs/AUTH.md has always described this as the
--      piece most likely to become a permanent security problem. Supabase issues,
--      refreshes and revokes access tokens instead.
--
--    auth_throttle - existed to rate limit OUR login endpoint. There is no longer one;
--      Supabase rate limits its own sign-in (see [auth.rate_limit] in config.toml).
--
--    has_commissioner_code / has_join_code - public booleans that existed so the login
--      screen could choose between "enter your code" and "create the commissioner
--      login", and so the team picker could show which teams were joinable. No screen
--      asks either question now.
--
--  THIS IS DESTRUCTIVE AND FORWARD-ONLY. It drops the credentials people currently sign
--  in with, so applying it signs everybody out; they get back in through an invitation.
--  That is acceptable here only because every deployed league is test data due to be
--  wiped - see docs/AUTH.md. Onboarding a real league from codes would need an
--  invitation sent to each member BEFORE this runs.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  FIRST: remove leagues that this change would strand.
--
--  Authorization is a `league_members` row from here on. A league with no member
--  holding the `commissioner` role cannot deal a week, enter a stat, add a team,
--  issue an invite, or promote anybody - every one of those paths is
--  commissioner-only, and the only way to mint that first membership was
--  `linkAccount`, which is deleted in this same change. Such a league is not
--  "temporarily locked": it is permanently unadministrable, and no screen in the
--  app can repair it.
--
--  Leaving it would also leave it PUBLICLY READABLE, because the Phase 3d
--  migration set every league that existed then to `visibility = 'public'`. So the
--  choice is not between deleting data and keeping it safe - it is between deleting
--  it and leaving a public, frozen copy that nothing in the app can take down.
--
--  TO KEEP ONE, give it a commissioner BEFORE running this. The account has to
--  exist already, so sign in on the site once first:
--
--    insert into league_members (league_id, user_id, role)
--    select '<league-uuid>', id, 'commissioner'
--      from auth.users where email = '<your-address>';
--
--  Everything hanging off a deleted league cascades with it: seasons, teams,
--  players, periods, rosters, stats, results, events, invites and memberships.
-- ---------------------------------------------------------------------------
do $prune$
declare
  stranded int;
begin
  with doomed as (
    delete from leagues l
     where not exists (
       select 1 from league_members m
        where m.league_id = l.id and m.role = 'commissioner'
     )
    returning 1
  )
  select count(*) into stranded from doomed;

  if stranded > 0 then
    raise notice
      'Removed % league(s) that had no commissioner. Nobody could have administered '
      'them after this migration, and they were publicly readable.', stranded;
  end if;
end
$prune$;

-- Order matters only for readability; each is independent.
drop table if exists auth_throttle;
drop table if exists sessions;
drop table if exists team_secrets;
drop table if exists league_secrets;

alter table leagues drop column if exists has_commissioner_code;
alter table teams   drop column if exists has_join_code;
