-- ============================================================================
--  Revoke the blanket privileges that hosted Supabase grants by default.
--
--  WHY THIS EXISTS - found on the real project, invisible locally.
--
--  A hosted Supabase project ships with default privileges along the lines of
--    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, ...
--  so EVERY table created by a migration is born with `GRANT ALL` to `anon` -
--  the role the public, browser-side publishable key authenticates as.
--
--  The initial migration's `grant select ...` was ADDITIVE. It never removed
--  that ALL. So after `db push` the remote database had:
--
--      GRANT ALL ON TABLE public.league_secrets TO anon;
--      GRANT ALL ON TABLE public.team_secrets   TO anon;
--      GRANT ALL ON TABLE public.sessions       TO anon;
--
--  on the three tables whose entire purpose is to be unreachable from a browser.
--
--  NOTHING WAS ACTUALLY EXPOSED: RLS is enabled on all 14 tables and those three
--  have no policy at all, so every row was denied. The data was safe. What was
--  lost is the SECOND gate. The design is "a grant denies it AND a policy denies
--  it"; that had degraded to "a policy denies it", one `disable row level
--  security` away from publishing commissioner code hashes and live session
--  tokens.
--
--  The local stack has no such default privileges, which is exactly why local
--  tests passed and this only appeared against the hosted project.
--
--  This migration is written REVOKE-then-GRANT so it produces an identical,
--  correct end state on any project regardless of what defaults it started with.
--
--  ANY NEW TABLE MUST REPEAT THIS PATTERN. A table added in a later migration
--  will be born with GRANT ALL to anon all over again. Run
--  `npm run verify:grants` against the remote database after every db push.
-- ============================================================================

-- 1. Take everything away from the two browser-facing roles.
revoke all privileges on all tables    in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from anon, authenticated;

-- 2. Give back exactly, and only, what the league is meant to read.
grant select on
  leagues, seasons, teams, team_totals, players,
  periods, roster_slots, stat_lines, period_results, events
  to anon, authenticated;

-- schemes stays column-level: `submitted_at` is withheld, so a client must name
-- the granted columns (select('*') fails with 42501 - see the initial migration).
grant select (id, period_id, team_id, type, position, player_id, resolved_at, outcome)
  on schemes to anon, authenticated;

-- 3. league_secrets, team_secrets and sessions get NOTHING. Not a policy, not a
--    grant, not a column. That is the whole point of them.

-- 4. The secret key (server-side only) keeps full access. It bypasses RLS, but
--    it still needs privileges.
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- 5. Stop the problem recurring for tables created LATER by this owner.
--    Belt and braces alongside the per-table revokes above.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
