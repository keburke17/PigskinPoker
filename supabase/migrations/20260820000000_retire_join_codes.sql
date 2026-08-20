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
--  THIS IS FORWARD-ONLY, and applying it SIGNS EVERYBODY OUT: the credentials people
--  hold today stop existing, and they get back in through an invitation.
--
--  It deliberately does NOT touch league, team or game data. A migration should do what
--  its name says, and "retire join codes" is not a licence to delete somebody's league.
--
--  BE AWARE OF THE CONSEQUENCE, though: authorization is a `league_members` row from
--  here on, and the mechanism that minted the first one from a join code is deleted
--  right here. A league with no member holding the `commissioner` role therefore cannot
--  deal a week, add a team, issue an invite or promote anybody - every one of those is
--  commissioner-only - and no screen in the app can repair it.
--
--  So before running this against a database that matters, make sure every league you
--  intend to keep has a commissioner:
--
--    select l.name from leagues l
--     where not exists (select 1 from league_members m
--                        where m.league_id = l.id and m.role = 'commissioner');
--
--  and for each one that comes back, either give it a commissioner or delete it:
--
--    insert into league_members (league_id, user_id, role)
--    select '<league-uuid>', id, 'commissioner'
--      from auth.users where email = '<address>';   -- the account must exist already
--
--  docs/DEPLOYMENT.md carries this as a numbered step.
-- ============================================================================

-- Order matters only for readability; each is independent.
drop table if exists auth_throttle;
drop table if exists sessions;
drop table if exists team_secrets;
drop table if exists league_secrets;

alter table leagues drop column if exists has_commissioner_code;
alter table teams   drop column if exists has_join_code;
