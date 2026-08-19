-- ============================================================================
--  Phase 3a - login throttling, and session idle expiry.
--
--  Two things the Phase 2c auth layer knowingly left behind, written down in
--  docs/AUTH.md under "what is deliberately still weak":
--
--    1. Nothing at all rate limited login. A short shared code typed by a dozen
--       people is guessable at a few thousand attempts; the only cost to an
--       attacker was scrypt's ~50ms.
--    2. Sessions had an absolute 30-day cap and no idle expiry, so a token left
--       on a borrowed phone stayed live for a month of not being used.
--
--  WHY THE COUNTER LIVES IN POSTGRES. Netlify Functions are stateless and
--  horizontally scaled - there is no process to hold an in-memory counter, and
--  two concurrent invocations would each hold their own. The database is the
--  only thing the invocations share.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  auth_throttle - one row per bucket being counted.
--
--  Two buckets are checked per login attempt, and they are deliberately NOT the
--  same kind of control:
--
--    ip:<sha256(ip + pepper)>   a hard lockout. The attacker's own address.
--    league:<id> / team:<id>    a SLOWDOWN only, never a lockout. A hard lock
--                               here would let anyone lock the real commissioner
--                               out of his own league just by hammering the
--                               login form - a worse failure than a slow brute
--                               force, and one an attacker would choose on
--                               purpose.
--
--  The IP is hashed with a server-side pepper before it is stored, so this table
--  is a rate-limit counter and not a visitor log. Nothing here can be turned
--  back into an address.
-- ----------------------------------------------------------------------------
create table auth_throttle (
  bucket_key   text primary key,
  attempts     int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);

-- Pruning old rows scans by age, so that is what is indexed.
create index on auth_throttle (updated_at);

-- ----------------------------------------------------------------------------
--  sessions.last_used_at - idle expiry.
--
--  Nullable with a default of now() and backfilled to created_at, so existing
--  sessions get the most conservative honest answer available rather than being
--  treated as freshly used. Nobody is signed out by this migration itself.
-- ----------------------------------------------------------------------------
alter table sessions add column last_used_at timestamptz not null default now();
update sessions set last_used_at = created_at;
create index on sessions (last_used_at);

-- ============================================================================
--  RLS AND GRANTS
--
--  auth_throttle joins league_secrets, team_secrets and sessions in the set of
--  tables that are unreachable from a browser BY CONSTRUCTION: RLS on, zero
--  policies, zero grants. Only the secret key touches it.
--
--  The revoke-then-grant pattern of 20260818020000 is repeated here because it
--  has to be. On a hosted project this table is born with GRANT ALL to anon -
--  the default privileges that migration exists to undo apply to every table
--  created AFTER it too. Push with `npm run db:push`, which verifies afterwards.
-- ============================================================================
alter table auth_throttle enable row level security;   -- and NO policy, ever

revoke all privileges on auth_throttle from anon, authenticated;
grant all privileges on auth_throttle to service_role;
