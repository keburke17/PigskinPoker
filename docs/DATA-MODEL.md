# Pigskin Poker - Data Model (Phase 0)

**Status: approved on the load-bearing decisions (2026-08-17). No application code has been written yet.**

Confirmed by the repo owner: **OQ-1 decompose** (and follow standard web conventions),
**OQ-2 seasons**, **OQ-4 manual stat entry is a stopgap, not the destination**,
**OQ-9 resolved schemes public**. **OQ-A (the tiebreak defect) is deferred** to a future
change made together with the original designer - the code keeps its current behaviour.

This document is the Phase 0 deliverable. It covers the schema, which parts stay `jsonb`,
the concurrency design that fixes P1, the storage adapter shape that follows from the
schema, the RLS policy plan, and where I think the chosen stack is a poor fit.

Companion document: [`OPEN-QUESTIONS.md`](./OPEN-QUESTIONS.md). Several decisions below
encode a recommendation on a question that is genuinely the author's to answer. Those are
cross-referenced as **[OQ-n]** and the schema can be redirected before anything is built.

---

## 0. Verification of the audit

I spot-checked the audit in the kickoff prompt against `LegacyProject/PigskinPokerCode.jsx`
before designing against it. It is accurate:

| Claim | Result |
|---|---|
| 2,532 lines, one import (React, line 1) | Confirmed |
| Zero non-ASCII bytes | Confirmed (`grep -P '[^\x00-\x7F]'` returns nothing) |
| Zero `fetch` / URLs / `http` | Confirmed (0 matches) |
| 4 `window.storage` call sites (2135, 2168, 2187, 2209) | Confirmed |
| `Math.random()` at 329, 336, 534, 535, 584, 617 | Confirmed (336 is `uid()`, also needs the seam) |
| Engine at 476-857, `createDefaultState` at 402 | Confirmed |

Two corrections to the audit, both minor:

- `uid()` (line 336) also calls `Math.random()` and is used inside the engine
  (`processSchemes`, `finalizeCurrentPeriod`, `startPlayoffs`) to mint activity-log and
  result ids. It needs to be part of the Phase 1 RNG injection, otherwise "deterministic
  tests" still produce non-deterministic ids. The audit lists the other five sites but not
  this one.
- The `phase` comment on line 411 lists four phases
  (`pre-deal | dealt | stats | finalized`), but the code also sets `schemes-processed`
  (line 2303). The real enum has five values. The schema uses the code's set, not the
  comment's.

---

## 1. The central decision: what the entities actually are

The single-blob shape was forced by a key-value store, not chosen. The prompt asks
whether to port that shape into one `jsonb` column or decompose it. **I recommend
decomposing it**, for one reason that outweighs the others:

> A whole-state `save()` on Postgres is the same bug as a whole-state `save()` on
> `window.storage`. It does not fix P1, it just moves it.

P1 (silent clobbering) is not caused by the storage backend. It is caused by *the unit of
write being the entire league*. If the commissioner's stat entry and a manager's lineup
swap are the same write, they conflict by construction, and no amount of versioning makes
them both succeed - the best a version check can do is reject one of them. Decomposing so
that a stat entry writes a stat line and a lineup swap writes two roster slots means those
two operations **stop conflicting at all**. That is the actual fix, and it is also the
actual fix for P3.

So the mapping is:

| Blob field (line) | Becomes |
|---|---|
| `schemaVersion` (404) | `seasons.schema_version` + an app-state migration chain for backups |
| `leagueName` (405) | `leagues.name` |
| `commissionerCode` (406) | **nothing.** Codes were retired 2026-08-20; the blob still carries the field for parity, and `decompose` drops it |
| `teams[]` (407) | `teams` + `team_totals`. `joinCode` goes nowhere, same as above |
| `teams[].roster` | `roster_slots`, keyed by **period** - now survives finalize |
| `teams[].cumulative` / `.playoffCumulative` | `team_totals` rows, `scope = 'regular' \| 'playoff'` |
| `playerPool[]` (408) | `players` |
| `scoringConfig` (409) | `seasons.scoring_config` (**jsonb**) |
| `standingsPointsOverride` (410) | `seasons.standings_points_override` (`int[]`) |
| `currentPeriod` (411) | `periods` - one row per week/round, not one current value |
| `schemes{}` (412) | `schemes`, retained after resolution rather than cleared |
| `rosterLocked` (413) | `periods.roster_locked` |
| `lockedPlayerIds{}` (414) | `roster_slots.locked` |
| `statsEntry{}` (415) | `stat_lines` |
| `weeklyResults[]` (416) | `period_results` |
| `activityLog[]` (417) | `events` (prose preserved verbatim + structured `payload`) |
| `playoffConfig` (418-426) | `seasons.playoff_*` columns; `activeTeamIds` moves to `periods.participant_team_ids` |

### Seasons are introduced now

`CommResetPanel` (2028) is currently the only way to start a new year, and it destroys
everything. Adding a `seasons` table now is close to free and effectively impossible to
retrofit later, because once a second year has been played on top of a season-less schema
the first year's data is already gone. "Reset league" becomes "archive this season and
open a new one." This is **[OQ-2]** - the schema assumes yes.

### Rosters become historical

`finalizeCurrentPeriod` (line 792) does `next.teams.forEach((t) => { t.roster = null; })`.
Every week's rosters are destroyed at finalize. Keying `roster_slots` by period preserves
them at no cost and is what makes "how did this player do across the season" and
"who gets stolen from most" answerable **[OQ-3]**. No behaviour changes: the UI reads the
current period's slots, which are empty before a deal exactly as before.

---

## 2. What stays `jsonb`, and why

Full normalization is not automatically right, and I have not applied it. The test I used:
**normalize what is queried, aggregated, or concurrently written; keep as `jsonb` what is
read and written whole and whose shape should be free to evolve.**

Stays `jsonb`:

- **`seasons.scoring_config`** - read whole by `computeStarterPoints`, written whole by
  the scoring panel, never filtered on. Five columns would work today, but new scoring
  rules are exactly the kind of thing the author will add, and `jsonb` makes that a code
  change instead of a migration.
- **`*.best_player`** (`{name, position, points, periodLabel}`) - a small value object,
  compared only on `.points` by the tiebreak. Never joined.
- **`periods.pool_snapshot`** - the eligible-player-ids-by-position at deal time. Audit
  data only; exists so a deal can be replayed exactly (see P5 below).
- **`events.payload`** - deliberately open-ended, shape differs per event type.
- **`players.external_ids`** - Phase 4, provider-shaped by definition.

Becomes real columns (not `jsonb`):

- Everything in `stat_lines`, `period_results`, `team_totals`, `roster_slots`, `schemes`.
  These are the tables that get concurrent writes, feed aggregates, or answer the history
  questions. `jsonb` here would recreate P1 at a smaller scale.

Becomes native Postgres arrays (not `jsonb`):

- `seasons.standings_points_override int[]`, `seasons.playoff_advancement int[]`,
  `periods.participant_team_ids uuid[]`. Ordered lists of scalars, always read whole.
  Arrays give type checking that `jsonb` does not.

---

## 3. Schema

> **This is the schema as PROPOSED in Phase 0, and it is not the whole schema now.**
> Migrations are forward-only and the live shape is the sum of `supabase/migrations/`.
> What is not below: accounts, `league_members` and `invites` (Phase 3); the six split
> stat columns and their `feed_*` mirrors, `players.depth_rank` / `.source` /
> `.status_source` / `.feed_status` / `.feed_updated_at`, the `gsis` unique indexes and
> `periods.nfl_week` (Phase 4, `20260828*`); and `player_pool`, rebuilt from live depth
> charts in `20260829000000`. `docs/MIGRATION-NOTES.md` explains each of them.

Proposed as a single migration. Every table has its policies in the same migration, per
the ground rules. `enable row level security` is written explicitly on every table even
though the auto-RLS event trigger would do it - the migration must be self-contained so
that my friend's own Supabase project (which may not have the trigger) comes out identical.

```sql
-- ============================================================================
--  Pigskin Poker - initial schema
--  Every table enables RLS and declares its policies in this same migration.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------- leagues --
create table leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Pigskin Poker',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- seasons --
create table seasons (
  id                        uuid primary key default gen_random_uuid(),
  league_id                 uuid not null references leagues(id) on delete cascade,
  year                      int  not null,
  label                     text,
  status                    text not null default 'active'
                              check (status in ('active','complete','archived')),
  schema_version            int  not null default 2,

  scoring_config            jsonb not null
                              default '{"yardsPerPoint":10,"pointsPerTD":5,
                                        "coachWin":2,"coachTie":1,"coachLoss":0}'::jsonb,
  standings_points_override int[],          -- null = derive from team count

  playoff_bracket_size      int  not null default 4,
  playoff_advancement       int[] not null default '{4,2,1}',
  playoff_started           boolean not null default false,
  playoff_completed         boolean not null default false,
  playoff_round_index       int  not null default 0,
  champion_team_id          uuid,           -- FK added after teams exists

  version                   int  not null default 1,
  created_at                timestamptz not null default now(),
  unique (league_id, year)
);

-- ------------------------------------------------------------------ teams --
-- Teams belong to the LEAGUE and persist across seasons.
create table teams (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references leagues(id) on delete cascade,
  name        text not null,
  legacy_id   text,                          -- 'team_ab12cd' from the artifact export
  active      boolean not null default true, -- soft delete; onRemoveTeam must not orphan history
  version     int  not null default 1,
  created_at  timestamptz not null default now(),
  unique (league_id, legacy_id)
);

alter table seasons
  add constraint seasons_champion_fk
  foreign key (champion_team_id) references teams(id) on delete set null;

-- ------------------------------------------------------------ team_totals --
-- Exactly mirrors team.cumulative / team.playoffCumulative (line 407, 380-390).
-- Materialized rather than derived: the tiebreak reads it, and it must be the value
-- as of finalize time. Recomputable from period_results for audit.
create table team_totals (
  id                uuid primary key default gen_random_uuid(),
  season_id         uuid not null references seasons(id) on delete cascade,
  team_id           uuid not null references teams(id) on delete cascade,
  scope             text not null check (scope in ('regular','playoff')),
  standings_points  int not null default 0,
  week_wins         int not null default 0,
  coach_wins        int not null default 0,
  total_tds         int not null default 0,
  total_yards       int not null default 0,
  best_player       jsonb,                   -- {name, position, points, periodLabel}
  version           int not null default 1,
  unique (season_id, team_id, scope)
);

-- ---------------------------------------------------------------- players --
create table players (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references leagues(id) on delete cascade,
  name          text not null,
  position      text not null check (position in ('Coach','QB','RB','WR','TE')),
  nfl_team      text not null,
  status        text not null default 'Active'
                  check (status in ('Active','OUT','IR','BYE')),
  external_ids  jsonb not null default '{}'::jsonb,   -- Phase 4 seam
  legacy_id     text,                                 -- 'p1' .. 'pN'
  active        boolean not null default true,        -- soft delete, see onDeletePlayer
  version       int not null default 1,
  created_at    timestamptz not null default now(),
  unique (league_id, legacy_id)
);
create index on players (league_id, position, status);

-- ---------------------------------------------------------------- periods --
create table periods (
  id                   uuid primary key default gen_random_uuid(),
  season_id            uuid not null references seasons(id) on delete cascade,
  type                 text not null check (type in ('week','playoff')),
  number               int  not null,
  phase                text not null default 'pre-deal'
                         check (phase in ('pre-deal','dealt','schemes-processed',
                                          'stats','finalized')),
  roster_locked        boolean not null default false,
  participant_team_ids uuid[] not null default '{}',  -- was playoffConfig.activeTeamIds

  deal_seed            text,        -- P5: makes the deal replayable
  scheme_seed          text,        -- P5: makes scheme resolution replayable
  pool_snapshot        jsonb,       -- eligible ids by position AT DEAL TIME

  version              int  not null default 1,
  dealt_at             timestamptz,
  finalized_at         timestamptz,
  created_at           timestamptz not null default now(),
  unique (season_id, type, number)
);

-- ----------------------------------------------------------- roster_slots --
-- One row per slot per team per period. 12 rows per team per week.
-- player_id is nullable: a steal with an empty FA pool genuinely leaves a slot empty
-- (line 624), and the app renders that. Do not make it NOT NULL.
create table roster_slots (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references periods(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  area        text not null check (area in ('starter','bench')),
  slot        text check (slot in ('Coach','QB','WR','RB','TE','FLEX')),
  bench_index int check (bench_index between 0 and 5),
  player_id   uuid references players(id) on delete set null,
  locked      boolean not null default false,     -- was lockedPlayerIds
  version     int not null default 1,
  check ( (area = 'starter' and slot is not null and bench_index is null)
       or (area = 'bench'   and slot is null     and bench_index is not null) )
);
-- NULLs are distinct in a plain UNIQUE, so use two partial indexes instead.
create unique index roster_slots_starter_uniq
  on roster_slots (period_id, team_id, slot)        where area = 'starter';
create unique index roster_slots_bench_uniq
  on roster_slots (period_id, team_id, bench_index) where area = 'bench';
create index on roster_slots (period_id, player_id);

-- ------------------------------------------------------------ stat_lines --
-- Keyed by SLOT, not player - this matches the artifact exactly (statsEntry[teamId][slot]).
-- player_id is denormalized at entry time so season-long per-player queries are possible.
create table stat_lines (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null references periods(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  slot         text not null check (slot in ('Coach','QB','WR','RB','TE','FLEX')),
  player_id    uuid references players(id) on delete set null,
  -- Effective values: these are what the scoring engine reads.
  yards             int,
  tds               int,
  coach_result      text check (coach_result in ('Win','Tie','Loss')),
  source            text not null default 'manual'
                      check (source in ('manual','feed')),

  -- Last values a feed reported, retained even after a manual override, so the UI can
  -- say "the feed says 91, you set 84" and offer a one-click revert. Null until Phase 4.
  feed_yards        int,
  feed_tds          int,
  feed_coach_result text check (feed_coach_result in ('Win','Tie','Loss')),
  feed_provider     text,
  feed_updated_at   timestamptz,

  version           int not null default 1,
  updated_at        timestamptz not null default now(),
  unique (period_id, team_id, slot)
);
create index on stat_lines (period_id, player_id);

-- --------------------------------------------------------------- schemes --
-- Retained after resolution (the artifact cleared them at line 655) so that
-- head-to-head and "who gets stolen from most" become answerable. Secrecy is
-- enforced by RLS + the resolved_at gate, not by deletion.  See [OQ-9].
create table schemes (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null references periods(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  type         text not null check (type in ('block','steal','redraw','noaction')),
  position     text check (position in ('QB','WR','RB','TE')),  -- Coach never selectable
  player_id    uuid references players(id) on delete set null,
  submitted_at timestamptz not null default now(),
  resolved_at  timestamptz,
  -- What actually happened at resolution. The artifact silently skips a scheme whose
  -- player has moved (line 590) and logs nothing, which makes an abandoned scheme
  -- indistinguishable from No Action. Recording it removes that ambiguity.
  outcome      text check (outcome in ('applied','skipped','no-victim','no-replacement')),
  version      int not null default 1,
  check (type = 'noaction' or (position is not null and player_id is not null)),
  unique (period_id, team_id)
);

-- -------------------------------------------------------- period_results --
create table period_results (
  id               uuid primary key default gen_random_uuid(),
  period_id        uuid not null references periods(id) on delete cascade,
  team_id          uuid not null references teams(id) on delete cascade,
  rank             int  not null,
  raw_score        int  not null,
  standings_points int  not null,
  coach_result     text check (coach_result in ('Win','Tie','Loss')),
  tds              int  not null default 0,
  yards            int  not null default 0,
  best_player      jsonb,
  created_at       timestamptz not null default now(),
  unique (period_id, team_id)
);

-- ----------------------------------------------------------------- events --
-- activityLog. `text` is preserved verbatim so the existing UI renders unchanged;
-- `payload` is the new structured layer that makes history queryable.
create table events (
  id         uuid primary key default gen_random_uuid(),
  season_id  uuid not null references seasons(id) on delete cascade,
  period_id  uuid references periods(id) on delete set null,
  type       text not null,     -- deal|block|steal|steal-failed|redraw|warning
                                -- |result|advance|champion|playoffs-start
  text       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on events (season_id, created_at desc);

-- ==========================================================================
--  RETIRED, 2026-08-20 - kept here as a note because the shape explains the
--  rest of the schema. See supabase/migrations/20260820000000_retire_join_codes.sql.
--
--    league_secrets (commissioner_code_hash)
--    team_secrets   (join_code_hash)
--    sessions       (hashed token, role, expiry, idle window)
--    auth_throttle  (our login rate limiter's counter)
--    leagues.has_commissioner_code / teams.has_join_code
--
--  All four tables and both columns are DROPPED. Accounts authenticate and
--  `league_members` authorizes, so there is no code to hash, no session of our
--  own to store, and no login endpoint of ours to rate limit. The one secret
--  left in the schema is `invites.code_hash`, below.
-- ==========================================================================

-- Phase 3b. Accounts. auth.users is NOT shadowed - Supabase owns that table, and
-- adding columns to it is the standard way to get hurt on an upgrade.
--
-- `profiles` is deliberately almost empty: the email lives in auth.users where
-- Supabase manages it, and duplicating it here would be a second source of truth
-- for something this schema does not own.
create table profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

-- Where authorization moves to. Commissioner is a ROLE ON THIS ROW rather than a
-- different kind of login, which is what makes "commissioner of one league,
-- manager in another" expressible at all - single-code auth literally cannot
-- represent it, because the code IS the identity.
--
-- `role` mirrors the check on sessions.role on purpose: verifySession resolves
-- both credentials to the same shape, so the two vocabularies must not drift.
create table league_members (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references leagues(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('commissioner','manager')),
  team_id    uuid references teams(id) on delete set null,  -- null for a commissioner
  created_at timestamptz not null default now(),
  -- Redeeming an invitation twice must be a no-op, not a second membership.
  unique (league_id, user_id),
  check (role = 'commissioner' or team_id is not null)
);
create index on league_members (league_id);
create index on league_members (user_id);
```

**A third grant category, from Phase 3b.** `profiles` and `league_members` are the first
tables here about PEOPLE rather than about the game, and they fit neither existing
category: `anon` gets nothing (a signed-out visitor must not be able to enumerate who
belongs to which league), while `authenticated` gets `SELECT`, narrowed further by an RLS
policy scoped to `auth.uid()`. `scripts/verify-grants.mjs` checks them as their own group
for exactly that reason - filing them under the readable tables would assert `anon` can
read them, and filing them under the secrets would assert nobody can.

Both policies are scoped to `auth.uid()` rather than asking "is the reader a member of
this league?". That question queries `league_members` from inside `league_members`' own
policy and recurses; scoping to the reader sidesteps it, and the app reads teams rather
than memberships so nothing is lost.

---

## 4. RLS policy plan

### The posture

The publishable key ships to every browser. Assume an attacker holds it and calls
PostgREST directly, ignoring the UI. Therefore:

- **The publishable key gets SELECT on what the league is meant to see, and INSERT/UPDATE/DELETE on nothing.**
- **Every write goes through a Netlify Function holding the secret key**, which
  authenticates the caller against `sessions` and enforces the commissioner/manager rule
  in code. RLS is the backstop that makes routing around that function useless.
- **No secret is in any table the publishable key can reach.** Codes live only in
  `invites.code_hash`, scrypt-hashed, on a table with zero policies. (Until 2026-08-20
  this said `league_secrets` / `team_secrets`; both are dropped.)

```sql
-- Enable RLS everywhere (explicit, not relying on the auto-RLS trigger).
alter table leagues        enable row level security;
alter table seasons        enable row level security;
alter table teams          enable row level security;
alter table team_totals    enable row level security;
alter table players        enable row level security;
alter table periods        enable row level security;
alter table roster_slots   enable row level security;
alter table stat_lines     enable row level security;
alter table schemes        enable row level security;
alter table period_results enable row level security;
alter table events         enable row level security;
alter table invites        enable row level security;   -- and NO policy, ever
alter table profiles       enable row level security;   -- own row only
alter table league_members enable row level security;   -- own row only

-- Public-readable league state. `anon` here is the PostgREST role the
-- publishable key authenticates as; the key format is new, the role name is not.
create policy read_leagues        on leagues        for select to anon, authenticated using (true);
create policy read_seasons        on seasons        for select to anon, authenticated using (true);
create policy read_teams          on teams          for select to anon, authenticated using (true);
create policy read_team_totals    on team_totals    for select to anon, authenticated using (true);
create policy read_players        on players        for select to anon, authenticated using (true);
create policy read_periods        on periods        for select to anon, authenticated using (true);
create policy read_roster_slots   on roster_slots   for select to anon, authenticated using (true);
create policy read_stat_lines     on stat_lines     for select to anon, authenticated using (true);
create policy read_period_results on period_results for select to anon, authenticated using (true);
create policy read_events         on events         for select to anon, authenticated using (true);

-- Schemes are secret until resolved. "Schemes are never shown to other managers -
-- only the resulting roster" (RulesTab, line 1770). An unresolved scheme is
-- invisible to everyone; the manager's own pending scheme is served by the
-- function that already knows their session.  See [OQ-9].
create policy read_resolved_schemes on schemes for select to anon, authenticated
  using (resolved_at is not null);

-- Column-level grant, narrower than the row policy. `submitted_at` is stored by the
-- artifact but never displayed anywhere in it, so exposing it now would be the only
-- genuinely NEW disclosure in this schema (it would reveal who submitted early or late).
-- Withholding it makes "does this leak anything the league can't already see?" a clean no.
revoke select on schemes from anon, authenticated;
grant  select (id, period_id, team_id, type, position, player_id, resolved_at, outcome)
  on schemes to anon, authenticated;

-- NOTE: no INSERT / UPDATE / DELETE policy is created on any table, for any role.
-- That is deliberate and is the whole security model. Adding one is a decision,
-- not a fix.
```

### Realtime

Realtime `postgres_changes` respects RLS, so it works with exactly the read policies
above and leaks nothing extra. Tables must be added to the publication explicitly - easy
to forget, so it goes in the same migration:

```sql
alter publication supabase_realtime add table periods;
alter publication supabase_realtime add table roster_slots;
alter publication supabase_realtime add table stat_lines;
alter publication supabase_realtime add table period_results;
alter publication supabase_realtime add table team_totals;
alter publication supabase_realtime add table events;
alter publication supabase_realtime add table teams;
-- schemes deliberately NOT published: a change event would leak that a scheme was
-- submitted, and its row, to subscribers. Managers poll their own via the function.
```

`stat_lines` is the one that matters on Sunday: that is what makes a manager's screen
update live while the commissioner types.

### Why manager writes go through a function too

The prompt asks me to pick between RLS-scoping manager lineup/scheme edits to their own
team, and routing them through a function, and to say why. **Route them through a function.**

The reason is timing, not preference. RLS can only scope a write by something it can read
off the request - in practice a JWT claim. In Phase 2 there is no JWT: the login is a join
code, and the publishable key is anonymous and identical for everyone. There is nothing
for a policy to scope *by*. A policy like `using (team_id = ...)` has no right-hand side
to check against until Phase 3 introduces real sessions.

So Phase 2 routes every write through the function that already validates the session
token. Once Phase 3 issues real Supabase JWTs, the direct-write path becomes available and
lineup/scheme edits can move to RLS-scoped writes if the extra hop ever proves annoying.
Nothing in this schema blocks that. Starting with functions is the choice that is correct
in both phases; starting with RLS-scoped writes is not correct in Phase 2 at all.

---

## 5. Concurrency design (fixes P1)

### Two mechanisms, doing different jobs

**1. Row version, for the "we both edited the same thing" case.**
Every mutable table carries `version int not null default 1`. Every write is:

```sql
update stat_lines
   set yards = $1, tds = $2, version = version + 1, updated_at = now()
 where id = $3 and version = $4
returning *;
```

Zero rows returned means the caller's read was stale. The write is **rejected, never
merged and never forced**.

**2. Period phase guard, for the "the world moved on" case.**
This is the one that actually matters for the commissioner flow, and a row version alone
would not catch it. Every operation asserts the period is in a phase where it is legal:

| Operation | Requires phase | Also requires |
|---|---|---|
| `dealPeriod` | `pre-deal` | commissioner |
| `submitScheme` | `dealt` | manager owns team, `roster_locked = false` |
| `swapLineupSlot` | `dealt` or `schemes-processed` | manager owns team, neither slot `locked` |
| `processSchemes` | `dealt` | commissioner |
| `setStatLine` | `schemes-processed` or `stats` | commissioner |
| `finalizePeriod` | `stats` | commissioner |

Both checks run in one statement against the period row, so a finalize that lands while
someone is typing stats rejects the stat write rather than silently writing into a closed
week.

### Why most conflicts simply stop existing

This is the part that makes the design work. Under the blob model every pair of concurrent
edits collides. Under this schema:

| Two people doing | Old result | New result |
|---|---|---|
| Commissioner types Team A's stats, manager B swaps their lineup | One silently overwrites the other | Different rows. Both succeed. |
| Commissioner types Team A QB yards, Team A RB yards | Same blob, last wins | Different rows. Both succeed. |
| Two managers submit schemes | One is lost | Different rows. Both succeed. |
| Two tabs edit the *same* stat line | Silent clobber | Second is rejected with a clear message |
| Manager swaps a lineup while commissioner finalizes | Half-applied mess | Phase guard rejects the swap |

Only the last two are genuine conflicts, and they are rare and explicable. The version
check exists for those.

### What a rejected write looks like to the user

Never a silent revert, and never a lost keystroke.

- **Stale version on a stat line** - the field the user is editing is *not* clobbered.
  An inline notice appears on that row: `Someone else changed this line to 84 yds while
  you were typing. [Keep mine] [Use theirs]`. The refetched value is shown so the choice
  is informed. This is the one case that needs a human, so it asks.
- **Stale version anywhere else** (lineup swap, scheme, config) - refetch, show a
  non-blocking toast `Someone else just updated the league - reloaded.`, and re-apply the
  operation automatically **only if it is still legal against the fresh state**. A lineup
  swap re-applies cleanly if both slots still hold what the user thought; otherwise it
  surfaces as the toast plus an unchanged lineup.
- **Phase violation** - a distinct, plainer message, because it is not a conflict but a
  state change: `Week 4 was finalized while you were editing. Your change wasn't saved.`
- **Never** resolve by overwriting. There is no last-write-wins path in the design.

### Load failure behaviour is preserved (Do-not-change #1)

The refusal to start blank survives verbatim. A read error that is not "no such league"
does **not** fall back to `createDefaultState()`; it retries with the same staged backoff
and then blocks on the existing "Couldn't load your league" screen (2417-2444). This
matters *more* now, not less: with an operation-shaped store a blank load followed by an
auto-save would write empty rows over a real league. The mechanism moves; the guarantee
does not.

### The save guarantee is preserved (Do-not-change #2)

Kept: the save-status bar, the manual **Save Now** button, the retry-on-failure timer,
and the promise that nothing is lost. Changed: what a save costs.

- Stat inputs stay controlled and responsive (local state, per keystroke, unchanged feel),
  but the *write* is debounced ~400 ms and coalesced per `(period, team, slot)`.
- Flush immediately on blur, `visibilitychange`, and `beforeunload`.
- The write is one row, not the league. Typing `127` in a yards box becomes **one** write
  of one small row, instead of three full clones + three full serializations + three
  writes of the whole league.
- A pending-writes queue drives the status bar; **Save Now** flushes it. The bar can now
  tell the truth about *which* write failed, which the blob version could not.

This is not "it saves less." It is the same guarantee at roughly 1% of the cost.

### Reproducible deals (fixes P5)

`periods.deal_seed`, `periods.scheme_seed` and `periods.pool_snapshot` are written by the
server at deal time. With the Phase 1 RNG injection, re-running `dealRosters(snapshot,
teamIds, rngFrom(seed))` reproduces the deal exactly, so a week can be audited or replayed.
The seed is generated server-side inside the Netlify Function, so a client cannot re-roll
a deal it did not like.

---

## 6. The storage adapter shape

The schema decomposes, so a whole-state `save()` is the wrong shape and the interface is
**operation-shaped**, as the prompt anticipated. One interface in `src/storage/`, two
implementations (`supabase`, `memory`). Nothing outside `src/storage/` imports
`@supabase/supabase-js`.

### The one design decision that keeps this tractable

**Reads hydrate into the same object shape the UI already expects.**

`loadLeague()` returns a `LeagueView` that is structurally the current `createDefaultState()`
shape - `state.teams[].roster.starters.QB`, `state.playerPool`, `state.currentPeriod`, and
so on - assembled from the normalized tables. That means the ~90 existing components keep
reading exactly what they read today and do not get rewritten. Only the **write** path
changes: `update(s => ...)` is replaced by named operations.

Without this, decomposing the schema would cascade into rewriting the entire UI, and the
port stops being tractable. With it, Phase 2 touches `App` and the handful of components
that write. I consider this the load-bearing decision of the whole port.

The view is derived, not stored - there is no blob anywhere.

### The interface

```js
// src/storage/types.js  (JSDoc-typed; no TypeScript, per the dependency rule)

// Reads
loadLeague(leagueId)               -> { view: LeagueView, versions: VersionMap }
subscribe(leagueId, onChange)      -> unsubscribe()

// Manager operations
submitScheme(periodId, teamId, scheme, expect)
swapLineupSlot(periodId, teamId, slot, benchIndex, expect)
renameTeam(teamId, name, expect)

// Commissioner operations
dealPeriod(periodId, expect)
processSchemes(periodId, expect)
setStatLine(periodId, teamId, slot, line, expect)
toggleSlotLock(periodId, teamId, slotRef, expect)
toggleRosterLock(periodId, expect)
finalizePeriod(periodId, expect)
startPlayoffs(seasonId, bracketSize, advancement, expect)
addTeam(name) / removeTeam(teamId, expect)
addPlayer(p) / setPlayerStatus(playerId, status, expect) / deletePlayer(playerId, expect)
saveScoring(seasonId, cfg, expect)
saveStandingsConfig(seasonId, arr, expect)
archiveSeasonAndStartNew(seasonId)          // was onResetLeague

// Identity. As sketched, this was a localStorage code check - per the prompt at the
// time. What shipped, and what remains after codes were retired on 2026-08-20:
signInWithEmail(email) / getAccount() / whoami() / logout()

// Backup
exportBackup(seasonId) / importBackup(json)
```

Every operation resolves to a discriminated result rather than throwing:

```js
{ ok: true,  view }                                  // applied; view is the fresh state
{ ok: false, reason: 'stale',    view, theirs }      // version conflict; theirs = current row
{ ok: false, reason: 'phase',    view, phase }       // period moved on
{ ok: false, reason: 'forbidden' }                   // server-side authz said no
{ ok: false, reason: 'network',  retryable: true }   // feeds the save-status bar + retry
```

`expect` carries the version(s) the caller's read was based on. Callers never construct
it by hand - it comes from the `VersionMap` returned by the last read, so "every write
carries the version it was based on" is structural rather than a thing to remember.

### The in-memory implementation - REMOVED, 2026-08-20

It held the normalized tables in plain objects behind the same interface, and was
simultaneously the test double, the offline `npm run dev` mode, and the proof that
nothing outside `src/storage/` knew about Supabase.

It was deleted because it had no backend and therefore could not authenticate anybody -
so the fastest development loop was the one that could not exercise accounts,
memberships, invitations or league scoping, i.e. everything added from Phase 3b onwards.
It was also a second full implementation of every operation, free to drift from the one
that ships. `npm run dev` now starts the real stack. `src/storage/index.js` carries the
reasoning.

### Where the engine sits

The engine (`src/engine/`, from lines 476-857) stays pure and knows nothing about any of
this. Server-side operations run the *same* engine module inside the Netlify Function, so
dealing and scheme resolution are literally the same code the tests cover - not a
reimplementation that can drift.

---

## 7. Migrations and backup validation (fixes P4, P9)

Two separate concerns that both got called "schemaVersion":

1. **Database schema** - Supabase CLI migrations in `supabase/migrations/`. The whole
   schema rebuilds from empty with `supabase db reset`.
2. **App-state document shape** - what a backup JSON file contains. The artifact writes
   `schemaVersion: 1`. This needs a real migration chain, `src/engine/migrations/`, with
   `migrate(doc) -> doc` stepping 1 -> 2 -> ... and a validator that runs **before**
   anything reaches app state. `onRestoreBackup` (2399-2412) currently checks only that
   `teams` and `playerPool` are arrays; the replacement validates the full expected shape,
   reports what is wrong in human terms, and refuses rather than half-loading.

Backup restore is the first consumer of both. It is a convenience feature rather than a
migration path - the Artifact league was a worked example, not real history, so there is
nothing outstanding to carry across.

---

## 8. Concerns with the stack

The stack is a good fit and I would not change it. Five things I would handle deliberately:

1. **Two vendors where one would do.** Netlify Functions + Supabase means two dashboards,
   two sets of env vars, two places to look when something breaks - on a project explicitly
   built for handoff to a hobbyist. Supabase Edge Functions would consolidate it, but they
   are Deno, which is a second runtime to learn. **Recommendation: stay with Netlify
   Functions.** Plain Node/JS, one deploy, and the function code reads like the rest of the
   repo. The cost is a note in the deployment doc; the alternative costs a new runtime.

2. **Cold starts on the one afternoon that matters.** Traffic is near zero midweek and
   then everyone at once on Sunday, so the first stat entry of the day likely hits a cold
   function (~0.5-1.5 s). Mitigated by the design rather than by infrastructure: the UI is
   optimistic locally, writes are debounced and queued, and the status bar shows pending
   state. Worth knowing so it is not mistaken for a bug.

3. **Free-project pause after ~1 week idle.** Invisible in season, relevant in March -
   and the first person back gets an error, not a spinner. Goes in `DEPLOYMENT.md` with
   the one-click resume, and the load-failure screen's copy should not imply data loss.

4. **RLS-enabled-with-no-policy reads as an empty table, not an error.** With the auto-RLS
   trigger on, a forgotten policy looks exactly like "the league has no teams." Every
   table's policies ship in the same migration, and I would add one smoke test that
   asserts an anonymous client can read a seeded league and **cannot** write to it - which
   catches both the missing-policy and the accidental-write-policy directions.

5. **The `sessions` table was hand-rolled auth - RESOLVED, 2026-08-20.** It was small (a
   hashed token, a role, an expiry) and it existed because join codes are not emails and
   Supabase Auth has no primitive for "I know a shared code." It was flagged here because
   hand-rolled auth that quietly becomes permanent is a normal way for a project like this
   to end up with a security problem.

   It did not become permanent. Codes and the table are both gone; `verifySession` takes a
   Supabase access token and resolves it against `league_members`.

One thing I want to state plainly rather than bury: **Postgres is comfortably oversized for
this data** - a full season is well under 10 MB and there are 14 users. Postgres is not
being chosen for scale. It is being chosen because relational integrity and row-level
concurrency are what fix P1 and P3, and because RLS is what fixes P2. Those are correctness
problems, not capacity problems.

---

## 9. Decisions taken

All four blocking questions are answered. Recorded here because `MIGRATION-NOTES.md`
(Phase 6) will need them, and because the reasoning should outlive this conversation.

| # | Decision | Consequence |
|---|---|---|
| OQ-1 | Decompose into real tables; follow standard web conventions | Sections 1-3. This is what actually fixes P1 and P3. |
| OQ-2 | `seasons` is a first-class entity now | Reset becomes archive-and-start-new; past seasons survive. |
| OQ-4 | Manual stat entry is a stopgap, not the destination | `stat_lines` carries provenance from day one (below). |
| OQ-9 | Resolved schemes are public; `submitted_at` is not | Column grant above; unlocks the OQ-3 history features. |
| OQ-A | Tiebreak defect deferred to the original designer | Engine and tests preserve **current** behaviour (below). |

### OQ-4: what "manual entry was the only option" changes

Manual entry stays - the prompt requires the commissioner to remain the source of truth,
and it is the only thing that works before a feed is wired. What changes is that it stops
being the *design centre*:

- `stat_lines` records **provenance now**, not in Phase 4. A feed writes `feed_*` and sets
  `source = 'feed'`; a commissioner edit overwrites the effective columns and sets
  `source = 'manual'`, keeping the feed's value alongside for a visible diff and revert.
  Retrofitting this later means a migration plus a backfill over live season data; adding
  it now is five nullable columns.
- `players.external_ids` moves from afterthought to load-bearing. Once a provider is
  chosen, it gets a unique index on the extracted id so pool reconciliation cannot
  silently double-match.
- `docs/LIVE-DATA.md` (Phase 4) becomes a real procurement document - current pricing,
  licensing, coverage of coach W/L/T, which is the awkward one since most NFL stats APIs
  are player-centric and do not expose a head-coach result directly.
- Phase 4 still **scaffolds the seam and wires no provider**, per the original scope.

### OQ-A: how a deferred defect is handled without rotting

Deferring a known defect needs a plan, or it gets silently "fixed" by whoever touches the
code next. So:

- The engine keeps the current `i < 5` behaviour, moved verbatim.
- A Phase 1 test **asserts the current behaviour**, named so its intent is unmistakable -
  `documents current behaviour: 6th tiebreaker is not applied (see OQ-A)` - with a comment
  pointing here. A test that merely passed silently would look like endorsement.
- A second test, `skip`ped, encodes the *documented* six-tiebreaker behaviour. When the
  designer decides, the fix is: change one character, unskip one test, delete the other.
- `CLAUDE.md` (Phase 6) lists this under known-deviations so the next Claude session does
  not "helpfully" correct it.

### On "standard web dev standards" (OQ-1)

Stating the conventions explicitly, since they were asked for and since consistency is
worth more than any individual choice here:

- **`snake_case` in Postgres, `camelCase` in JavaScript**, converted in exactly one place -
  the storage adapter boundary. No snake_case leaking into components.
- **UUID primary keys** (`gen_random_uuid()`), never natural or sequential keys.
- **`created_at` / `updated_at` as `timestamptz`**, never bare `timestamp`.
- **Explicit `on delete` on every foreign key** - `cascade` for owned children,
  `set null` for references that should survive the target (`events.period_id`).
- **An index on every foreign key that gets filtered on.** Postgres does not create these
  automatically and their absence is the usual cause of a mysteriously slow list view.
- **`check` constraints for enums**, not free text, so bad data fails at the boundary.
- **Forward-only numbered migrations**, checked in, rebuilding from empty with one command.
- **Secrets from the environment only** - `.env.local`, git-ignored, never a literal.
- ESLint + Prettier at defaults, conventional commits, standard Vite/Vitest layout.

---

## 10. Ready for Phase 1

Nothing here blocks. Phase 1 scaffolds Vite + React, moves the engine out verbatim with
the RNG injected, and writes the tests - and does **not** touch persistence, which is
Phase 2. The remaining open questions (OQ-3, OQ-5 through OQ-8, OQ-B through OQ-F) are all
answerable later without rework; OQ-B is the only one that has to land before Phase 3,
since it defines what the server validates.
