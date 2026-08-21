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
--  APPLYING THIS SIGNS EVERYBODY OUT. The credentials people hold stop existing, and
--  they get back in by invitation. On the one database that had codes-era data, that
--  data was deleted by hand first - see docs/MIGRATION-NOTES.md. Every database from
--  here on applies this while empty, so there is nothing for it to strand.
--
--  It touches no league, team or game data. A migration should do what its name says.
-- ============================================================================

-- Order matters only for readability; each is independent.
drop table if exists auth_throttle;
drop table if exists sessions;
drop table if exists team_secrets;
drop table if exists league_secrets;

alter table leagues drop column if exists has_commissioner_code;
alter table teams   drop column if exists has_join_code;
