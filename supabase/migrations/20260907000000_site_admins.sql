-- ============================================================================
--  A ROLE ABOVE THE LEAGUE - the first one this schema has ever had.
--
--  Until now `league_members.role` was the whole of authorization, and that was
--  deliberate: "there is no league-independent answer to what this person is"
--  (server/auth.js). Head coaches broke that assumption, and issue #40 is where.
--
--  `player_pool` is ONE TABLE shared by every league - the template each new league
--  is copied from. Its 32 Coach rows are wrong (OQ-4d: nflverse's games.csv had John
--  Harbaugh coaching the Giants), nothing will ever correct them on its own, and a
--  commissioner cannot correct them because a commissioner's authority stops at his
--  own league's `players` rows. Somebody has to own the shared list, and that somebody
--  is not a role any league can grant.
--
--  WHY EMAIL AND NOT user_id. Every other membership in this schema references
--  auth.users, and this one deliberately does not:
--
--    - it has to be seedable HERE, in a forward-only migration, before either person
--      has signed in on this database. A user_id column would mean a lookup against
--      auth.users at migration time, which is empty on a fresh local stack;
--    - a magic link proves an EMAIL. That is the thing Supabase actually verified, and
--      keying on it means an account deleted and made again is the same admin;
--    - the list is legible in the repository. Who may edit every league's coaches is
--      not a fact that should live only in a table nobody reads.
--
--  The cost is that changing your email address changes who you are here. For a
--  two-person list that is a fair trade, and it is written down rather than discovered.
-- ============================================================================

create table site_admins (
  -- Lowercased on the way in, and checked, because the comparison in server/auth.js is
  -- exact. A capital letter seeded here would be an admin who can never sign in as one,
  -- and the failure would look like a bug in the portal rather than a typo in a row.
  email      text primary key check (email = lower(email) and email like '%@%'),
  -- Who this is, for whoever reads the table in two years.
  note       text,
  created_at timestamptz not null default now()
);

-- ============================================================================
--  ROW LEVEL SECURITY
--
--  No policy at all, which is the point: RLS on with no policy denies everything, and
--  the only reader is the Netlify function's service_role (which bypasses RLS by
--  design). A browser must never read this table.
--
--  Not because the addresses are secret - one of them is in the git log - but because
--  "here is the list of people who can edit everybody's league" is a target, and
--  nothing in the app needs it: whether YOU are an admin is answered by the server,
--  for you alone, through the `adminWhoami` operation.
--
--  Listed in SECRETS in scripts/verify-grants.mjs in the same change, so the hosted
--  GRANT ALL default that 20260818020000 exists because of is actually checked here.
-- ============================================================================
alter table site_admins enable row level security;

revoke all privileges on site_admins from anon, authenticated;
grant all privileges on site_admins to service_role;

-- ------------------------------------------------------------- the admins --
-- The two people who built the game. Scott designs it, Kyle runs the plumbing;
-- the head-coach list is Scott's decision and this is what lets him make it himself
-- instead of asking for a migration every time a coach is fired.
insert into site_admins (email, note) values
  ('scortie32@gmail.com', 'Scott - designer'),
  ('keburke17@gmail.com', 'Kyle - plumbing')
on conflict (email) do nothing;
