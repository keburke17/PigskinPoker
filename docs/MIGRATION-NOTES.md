# Migration Notes

What changed moving from the Claude Artifact (`LegacyProject/PigskinPokerCode.jsx`) to
this repo, and why. **Everything I decided on my own is written down here**, so nothing
has to be reverse-engineered from a diff.

Rule followed throughout: **restructuring was mine to decide, game behaviour was not.**
Where something looked like a bug, it is recorded in `OPEN-QUESTIONS.md` and left alone.

---

## Phase 1 - Scaffold and restructure

### Verified identical, not just "moved carefully"

The engine move is backed by [`tests/parity.test.js`](../tests/parity.test.js), which
runs the original code and the new engine head-to-head on identical seeds. Coverage
includes every dealing error path, the no-victim steal, the empty free-agent pool, the
full tiebreak chain, and **two complete simulated seasons through the playoffs to a
champion** - compared as whole state objects, not spot-checked.

That test is why the following can be stated as fact rather than intention: the game
plays exactly as it did.

### The one permitted signature change: injected randomness

`src/engine/rng.js`. Every engine function that needs randomness takes an `rng`
parameter defaulting to `Math.random`, replacing the six internal `Math.random()` calls
(legacy lines 329, 336, 534, 535, 584, 617).

**One addition to the audit in the kickoff prompt:** `uid()` (legacy line 336) also
calls `Math.random()` and is used inside `processSchemes`, `finalizeCurrentPeriod` and
`startPlayoffs`. It was not in the prompt's list of six sites. Without threading it too,
"deterministic tests" would still produce non-deterministic activity-log ids, so it is
part of the seam.

The clock is deliberately **not** part of this seam - `nowStamp()` still calls the real
`Date`. Tests freeze it with `vi.setSystemTime()`, which keeps the change to precisely
"inject the randomness" and nothing more.

### Storage

The four `window.storage` call sites (legacy 2135, 2168, 2187, 2209) now go through
`src/storage/`. There is no `window.storage` anywhere in `src/`.

Per-device identity moved to `localStorage`, where it always belonged - it only ever
recorded which team is logged in on *this* browser.

**The Phase 1 interface is deliberately blob-shaped** (`loadLeague` / `saveLeague`),
because that is a drop-in for `window.storage` and keeps this phase mechanical. It is
not the final shape: `docs/DATA-MODEL.md` section 6 defines the operation-shaped interface that
Phase 2 replaces it with. A `version` field is already plumbed through so the
optimistic-concurrency path has somewhere to land.

### Load-failure behaviour, preserved and slightly strengthened

The refusal to silently start blank survives intact. The mechanism changed: the artifact
string-matched the error message (`/not found|no such key|404/i`) to decide whether a
failure meant "new league" or "storage broke". The interface now makes that explicit -
`loadLeague()` **resolves `null`** for "no league yet" and **rejects** for anything else.

Same behaviour, but it no longer depends on how a backend happens to word an error,
which would have been a real hazard once a second backend existed.

### CSS and data

- `GLOBAL_CSS` (legacy 10-238) is `src/styles/global.css`, imported once in `main.jsx`.
  The `<style>` tag that was injected in all four render paths is gone.

  **Correction (found in production):** this originally said the CSS was "byte-for-byte
  unchanged". That was true and still wrong. `GLOBAL_CSS` was a JS *template literal*,
  so a CSS unicode escape had to be written with a double backslash (`"\\2666"`) to
  survive JavaScript string parsing. Copied verbatim into a real `.css` file, those same
  bytes mean an escaped backslash followed by literal digits - so every rule bullet on
  the Rules page rendered as `\2666` instead of a diamond. One occurrence, fixed, and
  `tests/styles.test.js` now asserts no such escapes remain.

  Worth noting the shape of the mistake: "the bytes are identical" is not the same as
  "the meaning is identical" when text moves between two languages that both use
  backslash escapes. The original author warned about exactly this hazard in the other
  direction - escapes rendering literally in JSX text.
- `TEAM_ROWS` (legacy 242-275) is `src/data/teamRows.js`, unchanged. Phase 4 makes it
  regenerable; it is a plain data module now so that is a small step.

### Components

47 components (legacy 859-2097) split across 14 files in `src/components/`, grouped by
the screen they serve. **No component body was edited** - only imports added and
`export` prepended. They were all already at module scope in the original, which is why
this was mechanical.

### Two deletions, both behaviour-neutral

1. **A dead local in `processSchemes`.** The original declared
   `const rostered = allRosteredPlayerIds(next)` at the top of the steal branch (legacy
   line 611) and never read it - `freeAgentIdOfPosition` computes its own. Removed so
   the `no-unused-vars` lint rule can stay on. Parity tests confirm no behaviour change.
2. **The injected `<style>` tags**, superseded by the real stylesheet.

### One lint rule turned off, deliberately

`react/no-unescaped-entities` is disabled in `eslint.config.js`. It flagged 23 ordinary
apostrophes and quotes in JSX text. Satisfying it would mean editing ~20 component
bodies that were otherwise moved verbatim, for zero behavioural gain - and the original
author specifically warned that escape sequences in JSX text render literally and caused
real bugs during development. Leaving the text alone is the safer call.

### Not done, on purpose

`externalIds` on players was briefly added and then removed. It is a Phase 4 item, it
would have changed the shape `createDefaultState()` produces, and Phase 1 changes no
data. It goes in when Phase 4 has a provider to reconcile against.

---

## Findings recorded, not acted on

| Finding | Where |
|---|---|
| The 6th tiebreaker never applies; ties fall to team creation order | OQ-A |
| Blocks are not validated engine-side as being your own starter | OQ-B |
| A steal's "empty free-agent pool" branch is near-unreachable (see below) | `tests/schemes.test.js` |
| Every touch target is under the 44px guideline on a phone | OQ-8, below |

### The steal / redraw ordering asymmetry

Not a bug - worth knowing before anyone "tidies" it:

- **Steal** overwrites the acting team's slot *first* (legacy 620-621), *then* looks up
  the victim's replacement (623). So the player just dropped is already un-rostered and
  can become the victim's replacement. That is the documented rule: *dropped players go
  straight back into the free-agent pool, even mid-processing.*
- **Redraw** looks up the replacement *first* (641), *then* overwrites the slot. So you
  can never be handed back the player you just dropped.

Both orderings are correct and deliberate. The consequence is that a steal only leaves
an empty slot if the dropped player is *also* ineligible (marked OUT/IR/BYE after the
deal), which is what the test has to set up to reach that branch.

### Phone check (OQ-8) - measured, not assumed

Checked at 375x812 with the demo league loaded:

- **No horizontal page overflow.** `scrollWidth` equals the viewport exactly.
- **Stat entry wraps correctly.** The yards/TDs inputs drop to their own line rather
  than squeezing, and the nav row scrolls horizontally (`overflow-x: auto`) as intended.
- **Every interactive control is below the 44px minimum touch target.** All 114 of them,
  ranging 28-39px: header buttons 28px, nav 33px, stat inputs 37px.

The last one is the real finding. It is usable but fiddly, and the people using it will
be on phones on a Sunday afternoon with one thumb. It is a CSS-only fix (padding and
`min-height`), but it changes the look of every screen, so it is a design decision rather
than a port decision - flagged rather than made.

---

## Phase 2 - Real persistence, real authorization

### 2a - Schema

14 tables, decomposing the single blob (docs/DATA-MODEL.md). Verified against a real
local Postgres rather than shipped unrun, which caught two defects immediately:

1. **RLS policies alone left every table unreachable, including to the secret key.**
   PostgREST roles also need table-level `GRANT`s: RLS decides *which rows*, grants
   decide *whether you may touch the table at all*. The secret key bypasses RLS but not
   privileges. Supabase's hosted defaults usually hide this, which is exactly why the
   migration now does it explicitly - it has to reproduce identically in a project
   without those defaults.
2. **A column-level grant makes `select('*')` fail outright**, not silently omit the
   column. Since `schemes.submitted_at` is withheld, any client doing `select('*')` on
   schemes gets a hard 42501. Documented in the migration and asserted in the tests.

### 2b - The write path

`update(s => ...)` is gone. Each handler calls one named operation that writes only what
it touches. Two more real bugs surfaced in testing:

3. **`decompose()` never emitted `version`**, so `existing.version + 1` was `NaN`, and
   because `NaN !== NaN` every second write to a row looked stale.
4. **The period version was a bare integer.** After a finalize the current period is a
   *different row*, and a fresh row also starts at version 1 - so a client holding
   "period v1" for Week 2 would match Week 3's v1 and its stale write would be accepted.
   Now identity-qualified (`"week-2#1"`).

### 2c - Supabase, functions, and authorization

Reads go straight to PostgREST with the publishable key (which is what makes Realtime
work); writes go through one Netlify Function holding the secret key. Two more defects,
both found by driving the real app rather than by reading the code:

5. **The client had no way to know whether a commissioner code was set.** It correctly
   cannot read `league_secrets`, so it assumed none existed and offered to *create* one -
   on a league that already had a commissioner. Fixed by adding public
   `has_commissioner_code` / `has_join_code` booleans (migration
   `20260818010000`). Whether a code exists is a public fact; the code is not.
6. **The client dropped the session token on login.** `call()` returned only
   `{ ok, view }`, so the app looked signed in while every privileged write would have
   401'd.

Both are the kind of bug that a green test suite would never have caught, because both
components worked correctly in isolation.

### Decisions taken unilaterally

- **Auth was borrowed forward from Phase 3**, with the repo owner's agreement. Phase 2
  needed manager writes authorized somewhere, and a half-enforced write path on a public
  domain is worse than doing auth once. See docs/AUTH.md.
- **scrypt from `node:crypto`** for code hashing - no new dependency, and the standard
  library answer. Parameters are modest (N=16384) because these are short shared codes,
  not passwords; a login costs ~20ms.
- **A Vite plugin serves the Netlify Function locally** (`vite-plugin-api.js`) so
  `npm run dev` exercises the real privileged path. The alternative was a dev-only
  bypass in the client, which is how write paths end up unenforced in production.
- **Test files run sequentially** (`fileParallelism: false`). Several suites drive the
  same Postgres, and the demo seed deliberately refuses to run where unexpected data
  exists - so parallel files made them see each other's fixtures.
- **Commissioner admin operations still write the whole league** (`replaceLeague`).
  Adding a team or editing scoring is low-frequency, single-user and genuinely
  league-wide; giving each its own row-level path would be ceremony without benefit. The
  hot path - stat entry, lineup swaps, schemes - is fully fine-grained, which is what P1
  and P3 were about.

### Known gaps, carried forward deliberately

- **No rate limiting on login.** A short shared code with unlimited attempts is
  brute-forceable; scrypt makes each guess cost ~20ms, which helps but is not a
  substitute. Should land before a real league is on a public URL.
- **Sessions never rotate**, and changing a team's join code does not invalidate
  existing sessions. One-line fix in `setTeamJoinCode`, deferred to Phase 3 with the
  rest of the session work.
- **`sessions` is hand-rolled** and should be replaced by real Supabase sessions rather
  than grown.

---

## Pre-deployment: the blank-league path

Adding a bootstrap for deployment surfaced the most dangerous bug in the project so far.

### Two gaps that made deployment impossible

1. **No bootstrap.** `supabase db push` creates the schema but runs no seed, so a freshly
   deployed database has zero leagues. `loadLeague()` correctly returned `null`, and the
   app then sat on "Loading Pigskin Poker..." forever. The Artifact bootstrapped by
   calling `createDefaultState()` in the browser; that path disappeared when state moved
   to Postgres. `scripts/bootstrap-league.mjs` replaces it.
2. **No way to create a league.** No endpoint, no UI. Nobody noticed because the
   in-memory adapter always has the demo league.

### The identity bug (would have destroyed the real league)

`decomposeLeague()` derived **every row id** from `leagueKey`. Two callers passing
different leagueKeys for the same league therefore produced different ids for every row.
So persisting an ordinary edit **inserted a whole new league and deleted the old one** -
and because `sessions` and `league_secrets` cascade from `leagues`, that wiped the
commissioner's code and every session.

In practice: **adding the first team to a real league would have permanently locked the
commissioner out of it.** Observed exactly that in the browser - four teams added, one
survived, `has_commissioner_code` flipped to false, subsequent requests 401'd.

It never appeared against the demo league because `"demo"` was hardcoded as the
leagueKey on both sides. 177 passing tests did not catch it, and neither would code
review, because both halves were individually correct.

**Fix:** identity is now *preserve-then-derive*. Existing rows are matched by NATURAL
KEY (team `legacy_id`, period `type-number`, stat line `(period, team, slot)`, and so
on) and keep their ids; derivation is only the fallback for genuinely new rows. Callers
no longer have to agree on a leagueKey for identity to be stable.

**Defence in depth:** `persistBlob` now refuses to delete from `leagues` or `seasons` at
all. No ordinary state write should ever remove one, and the blast radius when it does
is total.

**Regression guard:** `tests/bootstrap.test.js` bootstraps with one leagueKey, persists
with a deliberately different one, and asserts the league id, its secrets, live sessions
and the player pool all survive.

### A smaller one alongside it

`has_commissioner_code` was being cleared on every state write. `decompose` read only
`state.commissionerCode` (the plaintext), but a hydrated view carries just
`commissionerCodeSet` - because the code never reaches the browser. The flag now accepts
either shape, so it survives a round trip.

### Decisions taken

- **The commissioner code is set at bootstrap, not claimed in the UI.** The Artifact let
  the first person to type a code become commissioner, which was fine behind a private
  link and is a land-grab on a public URL. `scripts/bootstrap-league.mjs` requires
  `PIGSKIN_COMMISSIONER_CODE` (min 8 characters) so there is never an unclaimed slot.
- **Secrets come from the environment, never from CLI arguments** - arguments land in
  shell history and process listings.
- The bootstrap refuses to run against a database that already has a league, unless
  `--force`.

---

## Deploying: what only the hosted project could reveal

### Hosted default privileges silently undid the grant model

The first `db push` to a real Supabase project produced this:

```
GRANT ALL ON TABLE public.league_secrets TO anon;
GRANT ALL ON TABLE public.team_secrets   TO anon;
GRANT ALL ON TABLE public.sessions       TO anon;
```

`anon` is the role the **public, browser-side publishable key** authenticates as, and
those three tables exist precisely to be unreachable from a browser.

**Cause:** a hosted project ships with default privileges roughly equivalent to
`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated,
service_role`. Every table a migration creates is therefore *born* with `GRANT ALL` to
`anon`. The initial migration's `grant select ...` was **additive** and never took that
away. The local stack has no such defaults - which is why the local RLS suite passed and
why this was invisible until the first real push.

**Was anything exposed? No.** RLS was enabled on all 14 tables and those three have no
policy at all, so every row was denied. The data was safe throughout.

**What was lost was the second gate.** The stated model is "a grant denies it *and* a
policy denies it". It had degraded to "a policy denies it" - one `disable row level
security` during debugging away from publishing commissioner code hashes and live
session tokens.

**Fix:** `20260818020000_revoke_default_grants.sql`, written revoke-then-grant so it
produces an identical, correct end state on any project regardless of the defaults it
started with. It also alters default privileges so later tables do not inherit the
problem.

**Guard:** `npm run verify:grants` dumps the linked remote schema and asserts the live
posture - RLS on everywhere, zero browser-role grants on the secrets tables (now four,
with `auth_throttle`), SELECT-only on the ten readable ones, and
column-level-with-`submitted_at`-withheld on `schemes`. Structural tests cannot cover
this, because the environment that has the problem is not the one the tests run against.

**And the guard is now wired into the push itself.** `npm run db:push` runs
`supabase db push && verify:grants`, so the check is the default path rather than a
step to remember. A guard that depends on someone recalling it at the right moment is
most of a guard, and this one already failed that way once.

### A caught bug in the checker itself

The first version of `verify-grants.mjs` reported `schemes` as having no grants at all.
It did have them: `pg_dump` emits column-level grants one per column with the name
quoted (`GRANT SELECT("id") ON TABLE ...`), and the pattern omitted the quote character,
so it matched nothing. Worth recording because the failure mode of a checker with a
too-narrow pattern is a **false all-clear** - the same shape of mistake as the earlier
`grep` that reported the secrets tables as ungranted when they were not.

### Making misconfiguration loud instead of plausible

Three failure modes that were silent or unexplained, all found by walking the deployment
path rather than by testing:

1. **A production build with missing Supabase variables fell back to the in-memory demo
   league.** That deploys a site which looks entirely healthy - six teams, standings, a
   week in progress - but is a throwaway copy in each visitor's tab that saves nothing
   and resets on refresh. One typo in a hosting dashboard produced exactly that, with no
   error anywhere. Production now refuses to start and names the missing variable;
   development keeps the friendly fallback.
2. **The league was looked up by exact name**, so `VITE_LEAGUE_NAME` had to match what
   the bootstrap created, punctuation included, or the app hung on "Loading..." forever.
   The name is now an optional disambiguator: one league just works, and a real mismatch
   reports which names the database actually contains.
3. **A database with schema but no league** - the state immediately after `db push` -
   rendered the loading spinner indefinitely, which reads as a hang rather than a setup
   step nobody ran. It now explains itself and prints the bootstrap command.

The common thread: each one produced a *plausible* screen rather than an error, and the
person seeing it had no way to tell configuration from breakage.

### Codes could not be changed at all

Codes are stored as one-way hashes, so a mistyped commissioner code meant hand-editing
the database - a position nobody should be in mid-season. `npm run set-code` sets or
rotates it, and **deletes existing commissioner sessions** while doing so: a code change
usually means "someone should no longer have this", and a 30-day token surviving the
rotation would defeat the point. That closes one of the three gaps recorded in `AUTH.md`.

Two related fixes came out of using it for real:

- **Shell quoting leaked into the stored code.** A code passed as `'pigskinPoker'` with
  the quotes intact hashed the quotes, so nothing typed at the login screen could match.
  Both scripts now strip a matching surrounding quote pair, warn about non-ASCII
  characters (smart quotes are invisible in most terminals), and print the effective code
  between markers with a character count.
- **The script declared success without checking its own work.** It confirmed the write
  landed, not that the code would log anyone in. Those are different claims and only the
  second is useful. `set-code` now verifies the stored hash through the real verify path
  before reporting success - which would have caught the quoting problem at the point of
  failure instead of at the login screen.

Also: re-running `bootstrap` on an existing league correctly refused, but said nothing
about the commissioner code being left unchanged - so a second run with a new code
*looked* like it had worked. The refusal message now says so and points at `set-code`.

### What the deployment actually proved

Verified against the live site, not inferred:

- reads reaching Postgres, and Realtime pushing changes with no refresh;
- the publishable key - taken from the shipped bundle - can read the ten league-visible
  tables and **write to nothing**, with the three secrets tables returning `42501`;
- no secret key, server module, or hash material in the client bundle;
- login through the function: scrypt verification, session created, opaque token issued,
  stored only as a hash;
- **the identity fix holding under the exact operation that would have broken it** -
  adding a team left the league id, its secrets, live sessions and all 223 players intact.

### A pattern worth naming

Four separate times, a verification step reported "nothing found" when the data was fine:
a `grep` that missed quoted identifiers, a dump parser expecting `COPY` when pg_dump
emitted `INSERT`, a grant checker whose pattern omitted a quote character, and a shell
glob that silently ate part of a commit message.

Every one produced a **false all-clear** rather than an error. A checker that finds
nothing is making a claim about itself as much as about the data, and the habit that
caught these was refusing to report "clean" without first confirming the checker could
see anything at all.

---

## 2026-08-20: local development becomes the real stack, and codes are retired

Five changes, in the order they were made. The first two were the point; the last three
were what the first two unblocked.

### 1. `npm run dev` starts everything

It checks Docker, starts the Supabase stack, applies any migration the repo has and the
database does not, seeds the demo league and the development accounts, writes `.env.local`
from the running stack, and starts Vite. The old instructions were five manual steps
ending in copying four values into a file by hand - and none of them failed loudly when
skipped. You got a dev server pointed at nothing, or a green `npm test` that had silently
skipped the RLS and authorization suites.

### 2. The development accounts are real accounts

`scripts/seed-accounts.mjs` creates genuine Supabase Auth users with genuine
`league_members` rows, through the same admin API the tests use. Magic links are captured
by the local mail catcher and **printed to the dev console as they are sent**
(`npm run link` fetches the newest on demand), so signing in locally is one click without
going to look for the mail.

There is deliberately no dev-only sign-in bypass in the client. A bypass is how a login
path ends up unenforced in production.

**A bug this uncovered:** `tests/server.test.js` resets the demo league between tests by
piping `supabase/seed.sql` into psql, which deletes and rebuilds the league row -
cascading every `league_members` row away while the `auth.users` rows survive. The symptom
is an account that signs in perfectly and then lands on "You are not in a league yet".
`npm test` now restores the accounts when it finishes, rather than teaching the seed file
about accounts, which would make fixtures materialize in the middle of the security suite.

### 3. The in-memory adapter was deleted

It had no backend, so it could not authenticate anybody - meaning the fastest development
loop was the one that could not exercise accounts, memberships, invitations or league
scoping, i.e. everything added from Phase 3b onwards. It was also a second full
implementation of every operation, free to drift from the one that ships.

`tests/operations.test.js` went with it: it tested that second implementation. Before
deleting, its assertions were compared one by one against `tests/server.test.js`, which
exercises the real one. All but one were already covered there. The exception - that the
period version is qualified with the period's identity, so a client holding Week 2's `v1`
cannot match Week 3's fresh `v1` - was carried across with a comment saying where it came
from.

### 4. Join codes, `sessions` and the login throttle were dropped

`supabase/migrations/20260820000000_retire_join_codes.sql`. `verifySession` now accepts
exactly one credential: a Supabase access token, resolved against `league_members`.
`server/auth.js` no longer hashes, stores or compares a secret of our own; the scrypt
primitives moved to `server/hash.js`, whose only consumer is invite secrets.

`docs/AUTH.md` had described the hand-rolled `sessions` table as the piece most likely to
become a permanent security problem. The only thing keeping it alive was the in-memory
adapter needing something it could check without a backend - so step 3 is what made step 4
free.

Deleted with it: `scripts/bootstrap-league.mjs` and `scripts/set-commissioner-code.mjs`.
Bootstrap existed to close a land-grab - the Artifact let the first person to type a code
become commissioner - and with creation tied to an account there is no window to close.

**A vacuous test, found while doing this.** The RLS fixture for `invites` was written with
the wrong column names (`reference`/`secret_hash` rather than `code_ref`/`code_hash`). The
insert failed silently, so "anon cannot read invites" was passing with no invite in the
table. The fixture now throws if it fails to insert - the same lesson as the pattern named
above, in a new place.

### 5. The player pool became a table

`player_pool` is a global template, seeded by migration from `src/data/teamRows.js`
(`npm run pool:sql` generates the rows, so there is one source and no second copy to
drift). Creating a league copies it in a single `INSERT ... SELECT` through a
`SECURITY DEFINER` function, instead of shipping 223 rows of JSON per league from three
different code paths.

Per-league `players` rows stay, deliberately: a commissioner marking someone OUT is a
statement about *their* league, and sharing one row would leak it into everybody else's.
There is a test asserting exactly that.

### The hosted database was wiped, once, by hand

Applying the retire migration signs everybody out, and authorization becomes a
`league_members` row - which the deployed data had almost none of, because everyone was
still getting in by code. Two leagues, four accounts, one finalized week: all of it test
data, and the plan had always been to start the real league clean.

So it was deleted deliberately, in the SQL editor, before the push:

```sql
delete from public.leagues;   -- everything under a league cascades
delete from auth.users;       -- profiles and memberships cascade
```

Two statements really is all of it, because every public table hangs off `leagues` by a
chain of `on delete cascade`: seasons -> periods -> roster_slots / stat_lines / schemes /
period_results, teams -> the same four plus team_totals, and players, invites,
league_members and events directly. `auth.users` then takes `profiles` with it. The four
credential tables need no attention at all - the migration drops them.

`auth.users` is in the **auth** schema, which is why it does not appear in the dashboard's
table list while that is filtered to `public`.

**`player_pool` is the one table never to wipe.** It is the global template every new
league is stocked from, it has no foreign keys, and nothing cascades into it - so the
statements above cannot reach it whichever order they run in. `players` is the opposite:
per-league copies, which is what lets one commissioner mark someone OUT without touching
anybody else, and they go with their league.

**This is recorded here rather than in the migration or the runbook, on purpose.** It
was tried both of those ways first and both were wrong:

- *In the migration* - a first attempt had it delete leagues with no commissioner. A
  schema change that quietly empties a table is a landmine for whoever reads the
  migration list in a year and reasonably expects "retire join codes" to retire join
  codes.
- *In `DEPLOYMENT.md`* - as a numbered step it implied every deployment faces this
  choice. None will. Migrations run once per database, so every database after this one
  applies the retire migration while empty, and the code that could produce a
  code-only member no longer exists. The hazard is not just handled; it is unreachable.

A one-time act on one database is history, not procedure.

### What this costs

Docker is now required to run the app at all. That was a deliberate trade - it is what
both people working on this have - and it buys a single mode where "it works locally"
means it works against the same Postgres, the same RLS, the same auth and the same
privileged-write function that deploys.
