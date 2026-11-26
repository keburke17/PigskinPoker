-- ============================================================================
--  league_alerts - what the hourly league checker has found, and what it has
--  already told the admins about.
--
--  docs/PLAN-AUTOMATIC-LEAGUES.md, step 3. After the Week 12 incident
--  (docs/INCIDENT-2026-11-24.md) Scott asked how he would ever know that a league he
--  does not commission had gone wrong. server/leagueCheck.js scans every league each
--  hour for states that should be impossible - a week finished with every team on 0, a
--  league a week ahead of the NFL, a deadline passed with the week not moved, a roster
--  email that went out before the deal the league kept - and emails the site admins.
--
--  ONE ROW PER (league, kind, key), so a problem is reported ONCE however many hours it
--  lasts. `key` is usually the period it is about, so the same kind of problem in a
--  later week is a new alert rather than a repeat. `resolved_at` is set the first hour
--  the checker no longer finds it; if it comes back, the row reopens and is emailed
--  again.
--
--  SERVER ONLY. RLS on with no policy denies everything to the browser, and every grant
--  is revoked, the same as `notifications`. Listed in SECRETS in
--  scripts/verify-grants.mjs in this same change, because hosted Supabase grants ALL to
--  `anon` on every new table (20260818020000_revoke_default_grants.sql).
-- ============================================================================

create table league_alerts (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references leagues(id) on delete cascade,
  kind        text not null,
  key         text not null,
  -- The sentence the admins are emailed, as it was when last seen.
  message     text not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  resolved_at timestamptz,
  emailed_at  timestamptz,
  unique (league_id, kind, key)
);

create index league_alerts_open on league_alerts (league_id) where resolved_at is null;

comment on table league_alerts is
  'Problems the hourly league checker found (server/leagueCheck.js), one row per (league, kind, key), so each is emailed to the site admins once. Server-only.';

alter table league_alerts enable row level security;
revoke all privileges on league_alerts from anon, authenticated;
grant all privileges on league_alerts to service_role;
