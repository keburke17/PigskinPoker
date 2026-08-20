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

-- Order matters only for readability; each is independent.
drop table if exists auth_throttle;
drop table if exists sessions;
drop table if exists team_secrets;
drop table if exists league_secrets;

alter table leagues drop column if exists has_commissioner_code;
alter table teams   drop column if exists has_join_code;
