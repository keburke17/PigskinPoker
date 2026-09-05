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

---

## 2026-08-20: the sign-in loop

Reported by the league's owner the day after codes were retired: the first sign-in
worked; after signing out, no link ever worked again. Enter your email, get the email,
tap it, and land on a page asking for your email.

**Two bugs, in front of one dashboard setting.**

### The loop itself

A failed magic link comes back with its reason in the URL fragment -
`#error=access_denied&error_code=otp_expired&...` - and nobody read it. The Supabase
client has no use for it, so it drops it; the app dropped it too, and the failure had no
representation on screen at all. You are simply back at the sign-in box.

What made that a **loop** rather than an annoyance is that the obvious response makes it
worse: requesting another link **invalidates the one already in the inbox**. Confirmed
against a local GoTrue - ask twice, and the first token returns `otp_expired`. So anyone
who taps a stalled link, gets nothing, and asks again has cancelled the link they were
about to receive help from, and every subsequent attempt looks identical.

There are four ways to arrive holding a spent link, and no way to tell them apart from
the outside: already used, superseded, aged out, or opened by a mail scanner before the
human got there.

`src/storage/authCallback.js` now reads the fragment before the client consumes it and
says which. It reads at import time, not at store construction: the reading strips the
fragment from the address bar, and doing that during a React render meant StrictMode's
second render built a store from an already-cleaned URL and found nothing. The fix
worked in production and not in development, which is the wrong way round.

### Signing out walked you back in

`onLogout` called `setTab("home")` - and `home` is a TAB, so that builds `/l/<leagueId>`.
Signing out therefore navigated INTO the league just left, where being signed out means
the reads return nothing and the screen says the league is private. It also never
cleared `account`, so the landing page went on offering "Your Leagues" and a sign-out
button to someone who had just used it.

Both are now what they should be: clear the account, go to the front door.

### The setting behind them

The hosted project's **Site URL was still `http://localhost:3000`**, the Supabase
default, from the day magic links went live (2026-08-19). The redirect allow-list was
correct, which is exactly why nobody noticed - Site URL is consulted only when a
redirect is *rejected*,
so a healthy allow-list hides it completely, and the failure it produces is a member
being dropped on a dead address on somebody else's laptop.

`verify:redirects` now answers this without sending anything, by asking the auth server
to verify a token that was never valid and reading where it sends the rejection. That is
the same decision it makes for a real link. Running it against production is what turned
up the localhost fallback.

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co npm run verify:redirects -- https://your-site
```

The prefix is not optional, and the reason is the next section. **Site URL was fixed on
2026-08-21**, along with the domain move below.

---

## 2026-08-21: the domain move, and a third bug in the same family

The site moved from `pigskinpoker.netlify.app` to `pigskin.ballsohard.org` - a subdomain,
chosen so the root and `www` stay free for whatever else the domain is for. It is a
Netlify domain alias over a Cloudflare CNAME, DNS-only. The sending domain was already
`mail.ballsohard.org`, so the move made the URL and the from-address agree rather than
pulling them apart, which was luck rather than planning.

**Site URL was set first, deliberately, to the address that already worked.** Every
mistake available during a domain move produces exactly one symptom - the person lands on
the Site URL - so the first move is to make that a working front door. Pointing it at the
new domain before DNS resolved would have aimed the fallback at nothing, which is the
problem rather than the fix. It moved to the new domain last, after the certificate
existed and the allow-list had been proved.

Both domains stay in the redirect allow-list for a season. A magic link already sitting in
an inbox carries the old address inside it, and that address is checked at the auth server
before any browser redirect happens - so tidying the list early is the one action that
breaks somebody mid-flight.

The one thing no dashboard warns about: **everybody is signed out, once.** The session
lives in `localStorage`, which is per-origin. Unannounced, "the site moved and now it wants
your email again" is indistinguishable from a phishing message.

### The check was answering about the wrong stack

`verify:redirects` reads `.env.local`, which `npm run dev` writes from the LOCAL stack. Run
exactly as this repo's own docs gave it, with a production site, it probed `127.0.0.1` and
printed a report that read precisely like a production report: the local stack's `site_url`
reported as WRONG, a correct hosted allow-list reported as missing. Every line true, about
the wrong project.

This is worse than having no check. An unwritten check is merely absent; a confident one
about the wrong system is believed - and this one exists specifically to be believed about
a setting nothing else in the repo can see. It now refuses the combination rather than
answering it.

### Netlify does not redirect its own subdomain

Setting a primary domain does not retire the old address. A project stays "always
accessible at a netlify.app subdomain", and it answered 200, cache-busted. Two origins
serving the same app is not broken - but with per-origin sessions it turns a clean one-time
cutover into people being intermittently logged out depending on which URL they arrived by,
which is far harder to explain than the cutover would have been. One host-scoped rule in
`netlify.toml` closes it, and it must sit above the SPA fallback, whose `from = "/*"`
carries no hostname and matches every host.

### The sign-in screen flashed on the way into a league

Selecting a league showed the "give us your email" screen for a moment first.

Changing the league in the URL starts two independent round trips - the league read, and
re-asking `whoami` - and the read wins. That leaves a window with the league loaded and the
role still unknown, which the render gate read as a signed-out visitor.

The part worth keeping: **a flag existed for exactly this and could not do the job, because
it was only ever set true.** `accountChecked` meant "the answer is not known yet", and on
the second run of the effect - which is what changing league IS - it was already true
before the effect began. A guard that can only fire once is not a guard; it is a
description of the first page load.

A single-league stack resolves too fast to lose the race, so it was reproduced by inserting
a temporary delay before `whoami` and sampling which screen was rendered every 50ms. Before:
`LANDING -> LOGIN-SCREEN` at 471ms. After: `LANDING -> LOADING` at 94ms. Inducing a race you
cannot otherwise observe is cheaper than arguing about whether it exists.

The same change made two definite answers CLEAR a cached role - no account, and a server
answer placing you in a league with no role - because identity is one `localStorage` key
rather than one per league, so a commissioner of one league walked into another still
holding the panel. Never a hole, since the role has never come from the client and the
writes were already refused; the screen was lying about it. An error is not a definite
answer and leaves the cached value alone, so a blip does not sign anybody out.

### The pattern, again

Three bugs across two days, one shape: **not knowing looked exactly like being refused.**

- A magic link that failed had no representation on screen, so you got the sign-in box -
  which reads as "we do not know you."
- A redirect that was rejected was silently sent to the Site URL, so a link that worked
  looked like a link that was broken.
- An identity still being resolved was rendered as an identity that was absent.

In an authentication flow the absence of an answer and a negative answer are different
facts that produce the same screen unless somebody deliberately keeps them apart. All three
were found from the outside, by someone using the thing, because from the inside each one
looks like the state machine working.


---

## 2026-08-27: the blob write deletes what the browser cannot see

Found while working out why the commissioner's "N of M teams have submitted" count sat at
0 (fixed separately in `83bc6d4`). The count was one symptom; the same asymmetry has three
others, and one of them destroys data.

### The asymmetry

Reads and writes see different leagues, on purpose:

- the **browser** reads PostgREST with the publishable key, so RLS applies. After
  `20260818050000`, every table gates on `pp_can_read_league` - except `schemes`, which
  carries `resolved_at is not null` on top (OQ-9). It is the only table in the schema whose
  row policy is narrower than league membership, and the only one with a column-level
  grant.
- the **server** reads with the secret key, which bypasses RLS entirely.

Nothing reconciles the two at the boundary. PostgREST returns `[]` for a forbidden row
exactly as it does for a row that does not exist, so the narrowing is invisible to the
caller.

### What it costs

**1. `mutateLeague` deletes league history.** `src/storage/supabase.js` builds the blob
from a client-side `readView()`, `server/league.js` `persistBlob` diffs it against the
server's full rows, and deletes anything absent - *"Delete rows that no longer exist (e.g.
a removed team, a cleared scheme)."* The blob is a lossy projection of the database, so
"absent" and "deleted" are not the same fact:

- pending schemes are invisible to the client (RLS), so they are never in it;
- resolved schemes cannot round-trip at all - `hydrate.js` only ever emits *unresolved
  current-period* schemes, so the OQ-9 history dies too;
- historical `roster_slots` and `stat_lines` are not in it either. `decompose.js` says so
  in its own header: past periods are reconstructed from `weeklyResults` and get `periods`
  + `period_results` only. Written as a note about *importing* the artifact blob, where
  lossy is harmless. Wired to `mutate`, lossy becomes destructive.

Simulated against the demo league plus the rows a genuinely-played week leaves behind:

```
table            previous  in blob   DELETED
roster_slots          144       72        72
stat_lines             24       18         6
schemes                 2        0         2
```

Reachable from all ten `ops.mutate` call sites (`src/App.jsx`) at any phase:
`replaceLeague` is not in `PHASE_RULES` and never calls `guard()`. `mutateLeague` re-reads
rather than using the view on screen, so a preceding write does not save it.

**2. A manager's own pending scheme is invisible after a reload.**
`src/components/scheme.jsx` reads `state.schemes[team.id]`; `SchemeSummary` renders nothing
and `SchemeForm` resets to No Action, so the screen denies a submission that happened.

**3. The stale-write check on `submitScheme` is inert.** `hydrate.js` builds
`versions[vkey.scheme(t)]` only from unresolved schemes, so the browser never holds one,
and `guard` skips a key the client did not send (`server/operations.js`, `expect[key] ==
null) continue`). Every other operation has working optimistic concurrency; this one has
none.

**4. Backup export is lossy the same way.** `onDownloadBackup` serializes the client's
`state`, while `commissioner.jsx` tells the commissioner backups are his *primary* safety
net.

### Why nothing caught it

`replaceLeague` and `mutateLeague` have no test at all. Neither does the submitted-scheme
count. `tests/rls.test.js` has asserted the narrowing all along - *"still hides an
UNRESOLVED scheme even with the granted columns"* - but nothing asserts what the code above
it does with an empty answer.

### The pattern

The same shape as the sign-in family recorded above, moved one layer down: **an empty
answer and a forbidden one are the same value.** A missing scheme reads as no scheme; a row
the reader may not see reads as a row that was deleted. The write path then acts on that
reading with no way to tell the difference.

Worth noting the mirror image, recorded in OQ-9 the same day: write responses carry a
server-built view, so a manager who submits a scheme currently receives every rival's
pending scheme in the reply. Server views are too wide going down, and client views too
narrow coming back up. One boundary, two directions, both unguarded.

---

## Phase 4 stage 1 - the scoring split (2026-08-28)

**The first deliberate change to game behaviour since the port.** Everything above this
line preserved the artifact's rules; this one changes them, on the designer's decision.

### What changed

Yards and touchdowns were a single number each, converting at one rate for every
position. They are now three of each - passing, rushing, receiving - with six
commissioner-editable settings:

| | Yards | Touchdown |
|---|---|---|
| Passing | 1 pt per 25 | 4 |
| Rushing | 1 pt per 10 | 6 |
| Receiving | 1 pt per 10 | 6 |

Only those three count. Return yards, two-point conversions and fumble-recovery
touchdowns score nothing, and a starter who does not play scores zero rather than being
excluded. Coach scoring is untouched.

### Why

OQ-4c. Under one shared rate a 300-yard, 3-TD passing day was worth 45 points against a
120-yard, 1-TD receiver's 17, so the QB slot decided most weeks and was blocked or stolen
almost every time. The same day now scores 24 against 18. The designer's words: a
quarterback "would make the position dominant and protected or stolen almost every time."

This was never a written rule - the rules screen said "1 point per 10 yards" and stopped.
Manual entry meant the commissioner's fingers were the specification, which only became a
problem once a feed had to be told what to look up. See `docs/PHASE-4-PLAN.md`.

### How parity survived a rules change

`computeStarterPoints` has two branches. A stat line carrying any per-category value
scores the new way; one carrying only the artifact's combined `yards` / `tds` scores the
old way, at the old rates, which are kept in `scoringConfig` for exactly that purpose.

That is not caution for its own sake - it is forced by the data. A combined total does
not record how much of it was passing, so a row written before the split cannot be
converted, and any backfill would be inventing numbers.

The payoff is that **`tests/parity.test.js` still passes**, including both full simulated
seasons through the playoffs to a champion, because the simulation enters combined-shape
lines and therefore takes the frozen branch. The only recorded difference is the six new
`scoringConfig` keys, and the test asserts that everything outside them still matches the
artifact object-for-object. A hard cutover would have meant rewriting the safety net
around the change instead of keeping it.

`tests/scoring.test.js` (new, 20 tests) covers the per-category math.

### Two consequences worth knowing

**Each category floors on its own.** 15 rushing plus 15 receiving yards is 1 + 1, not 3 -
yards at different rates cannot be summed before dividing. Under the old single box the
same day would have been entered as 30 and scored 3. Documented on the rules screen.

**The stat entry screen shows two boxes, not six.** Each position leads with the pair it
needs (QB: passing, RB: rushing, WR/TE: receiving) and the rest open behind a "+ more"
toggle, which auto-expands when a line already has values in them. Entering a normal week
costs the same keystrokes it always did.

### Schema

`supabase/migrations/20260828000000_split_stat_categories.sql` adds six nullable columns
plus six `feed_*` mirrors to `stat_lines`. Forward-only; nothing is rewritten and the
legacy columns keep what they hold. No migration for `scoring_config` - the engine and
both screens fall back to the defaults for any key a stored config predates, so existing
leagues keep working untouched.

---

## Phase 4 stage 4 - the pool refresh (2026-08-28)

The other half of OQ-4b: the hand-typed pool is rebuilt from each NFL team's current
starters, so it tracks depth-chart moves and injuries instead of going stale.

### What it does

A commissioner-pressed button, **pre-deal only**, that reads the live depth charts and
makes the pool 1 QB, 2 RB, 2 WR, 1 TE and 1 head coach per team - 224 rows. Then it
reports what it changed, because the value is not that the pool refreshed, it is seeing
what moved before dealing.

The first run against the real feed corrected, among others: "Derek Henry" to Derrick
Henry, "Kalil Shakir" to Khalil Shakir, "Tet McMillan" to Tetairoa McMillan, "Jaxson
Smith-Njigba" to Jaxon, "Chubba Hubbard" to Chuba, and Arizona's head coach from Mike
LaFleur to Jonathan Gannon.

### Why pre-deal only

In pre-deal no rosters exist - finalize deletes them - so a refresh cannot move a player
who is on somebody's team. It is also the designer's rule: a player who stops being a
starter finishes his week and is simply absent from the next deal. Nothing is automatic
and nothing runs mid-week.

### The rule, and where it lives

**A refresh may correct its own work and nothing a person decided.** `players.source`
records where a row came from (`seed` / `feed` / `manual`) and `players.status_source`
records who last set its status. A player the commissioner added is never touched; a
status he set is never overwritten, and the feed's opinion is recorded in `feed_status`
beside it and shown as a disagreement.

The decision logic is `server/pool.js`, deliberately free of I/O so it is tested directly
(`tests/pool.test.js`, 26 tests). Retiring means status OUT, never deletion - a deleted
player would break the rosters, stat lines and results that reference him.

### Two bugs this turned up, both found in the running app

**Manual status changes were not recorded as manual.** Pool edits go through the blob
path (`replaceLeague` -> `decompose`), which wrote no provenance, so setting a player OUT
left `status_source` at `default` and the next refresh would have silently put him back -
defeating the entire rule above. `decompose.js` now marks a status that differs from the
stored row as `manual`, which is sound because that path is only ever driven by the
commissioner's own screens. `newPlayerSource` distinguishes the seed generator from a
person adding a player.

**`decompose` reset `external_ids` to `{}` on every blob write.** The app-state shape has
no field for provider ids, so an ordinary pool edit silently cleared them and the next
stats pull would have had nothing to match on. They are now carried forward from the row
already in the database.

Neither was reachable before this stage, and neither would have failed a test - both were
found by driving the real UI and reading the table afterwards.

### Not downloading 45MB

`depth_charts_<season>.csv` is the whole season's snapshots in one file, ~45MB, written
newest first with a `dt` column per snapshot. `readLatestSnapshot` reads until `dt`
changes and aborts the request - a few hundred KB, about 700ms, which is why the refresh
can live in an ordinary request handler with no scheduler and no new deploy surface. If
nflverse ever reorders the file it still returns the right answer, just reads further.

Head coaches come from `games.csv` (`home_coach` / `away_coach`), since depth charts do
not carry coaches. That is the same file the Coach slot's Win/Tie/Loss will come from.

### Schema

`supabase/migrations/20260828010000_pool_feed_sync.sql` adds `depth_rank`, `source`,
`status_source`, `feed_status` and `feed_updated_at` to `players`; the unique index on
`external_ids->>'gsis'` the initial schema anticipated, for both `players` and
`player_pool`; and `periods.nfl_week`, which a stats pull cannot fetch without. Existing
non-Active statuses are marked `manual` so the first refresh cannot overrule a decision
made before the column existed. Forward-only; no row deleted, no status changed.

### The refresh wrote one row at a time

Found on 2026-08-29, before the first live refresh rather than during it.

`planPoolRefresh` produces patches carrying an id and only the columns that change, and
`refreshPlayerPool` applied them in a `for` loop of `update().eq("id", id)` - one
PostgREST request per changed player. Locally a round trip is free, so a full 224-row
refresh looked instant and the shape never drew attention.

It is not free from a Netlify function against hosted Postgres. Measured against the
demo league, a refresh that claims 100 players and retires the rest issues **225
requests**, sequentially, on a 10-second default function timeout. The first real
refresh is the worst case, because the `external_ids` fix above means nearly every
matched row needs a write.

`poolWriteRows` (`server/pool.js`) now merges each patch onto the row it came from and
returns chunks of complete rows, which `refreshPlayerPool` upserts on `id` - 2 requests
instead of 224. Merging is what makes the upsert safe: a patch on its own would INSERT a
half-built player, so a patch whose row has vanished between the read and the write is
dropped rather than written. `version` is carried through untouched, exactly as the
per-row updates left it.

Nothing about the resulting rows could ever have revealed this, which is why the test
counts requests (`tests/server.test.js`) as well as checking the rows. Against the old
loop it fails with "expected 225 to be less than 10".

### The template was still the 2025 pool

Phase 4's refresh rewrites ONE LEAGUE's `players` rows. Nothing ever wrote back to
`player_pool`, the template `copy_player_pool_into` copies at league creation - so it
still held the names typed by hand for the artifact, and every league created after the
refresh shipped was born with "Derek Henry", "Kalil Shakir" and Arizona's coach from two
coaches ago. Correct within a minute of pressing Refresh, wrong until somebody did.

`supabase/migrations/20260829000000_pool_template_from_feed.sql` replaces it with a
snapshot of the live depth charts (2026-08-29T12:56:08Z): 224 rows - 32 coaches, 32 QB,
64 RB, 64 WR, 32 TE - carrying the `gsis` and `espn` ids the refresh and the coming stats
pull match on, which is how a league now starts with provider ids instead of needing them
backfilled.

Generated by `npm run pool:sql:feed`, which refuses rather than guesses in the two cases
that would otherwise fail a push halfway through: a position the depth chart cannot fill,
and two rows sharing a `gsis` (a traded player listed by both teams for a day), which
`player_pool_gsis_uniq` would reject.

**It does not touch any league that already exists.** Their `players` rows diverged on
purpose the moment they were created, and the only thing allowed to correct them is the
commissioner pressing Refresh. The template just moves the starting point from a year
stale to a few days stale.

The pool is 224 rows rather than 223, which moved the count in `tests/server.test.js`.
`tests/bootstrap.test.js` still says 223 and is still right: it builds its league from
`createDefaultState()`, which expands `teamRows.js`, rather than from the template.

Verified against the local stack rather than reasoned about: a league created after this
migration holds 224 players, 192 of them carrying `gsis` ids (the 32 coaches have none),
and refreshing it immediately against the live feed added nothing, retired nothing and
renamed nothing - it only stamped provenance on rows that were already correct.

### The feed became recordable

Two things were impossible to work on before this. Refreshing the pool against the live
depth charts retires whoever moved this morning, so no assertion about a refresh could
survive a day. And the stats half of Phase 4 could not be started at all:
`stats_player_week_2026.csv` returns 404 until games are played, so there was nothing to
pull, parse or score before the season it is meant to serve.

`server/feed/fixture/` is a committed recording - the newest depth-chart snapshot, one
season of `games.csv` cut to the columns the coach lookup reads, and one real week of
player stats filtered to players in the pool. `npm run feed:record` regenerates it.
`server/feed/fixture.js` serves it through the live module's own parsing, by handing
`fetchDepthChart` a `fetch` that answers from disk - so a fixture run exercises the real
code path with the network removed, not a second implementation.

**The stat lines are last season's week 1, relabelled to this season.** They are real
numbers from a real week; they are not a prediction and not that week in this season, and
`manifest.json` and the directory's README both say so at length. It is the only stat data
that exists while the pull is being built.

`server/feed/index.js` chooses between the two, and the choice is guarded twice:
`PIGSKIN_FEED=fixture` asks, and the database must ALSO be local. A fixture served in
production would freeze a league's pool at whatever was recorded and report success while
doing it - the failure would look like nothing at all - so the environment variable is
deliberately not sufficient on its own. `tests/feed.test.js` asserts the refusal with the
variable set and a hosted URL. `isLocalUrl` moved to `server/localUrl.js` because the
development scripts and this gate now guard the same mistake and must not drift.

Also landed with it: `parseWeeklyStats` in the live feed module (parsing only - stage 5
still has to decide how the file is fetched, which is a measurement to make rather than a
default to pick), and three provenance cases planted in the demo seed so the disagreement
screens have something to show on a fresh reset. They are derived against the recording
rather than hard-coded, so re-recording re-picks them: today they land on Jeremiyah Love
(OUT by hand, still starting per the feed), Jacoby Brisset (the artifact's misspelling,
marked as added by hand) and Derek Henry (already retired by the feed). `periods.nfl_week`
is seeded too, so a stats pull has a week to ask for - the real write path is stage 3.

---

## Phase 4 stage 3 - which NFL week a league week plays (2026-08-29)

The smallest stage in the plan and the one everything else was waiting on.
`periods.nfl_week` had existed since the M2 migration on 2026-08-28, and nothing but the
demo seed had ever written it, so an actual stats pull would have had no week to ask
nflverse for. `scripts/generate-seed.mjs` said so in a comment: *"nothing writes the
mapping yet (stage 3)"*.

**Why the column exists at all.** `periods.number` counts the weeks THIS LEAGUE has
played and nflverse publishes by NFL week. They coincide for a league that opened on
opening weekend and for nothing else - a league that started late, one playing through a
bye, next season. Deriving one from the other would be a guess that looks like a fact.

### The default counts forward from the mapping

`server/schedule.js` is the whole rule, and it is I/O-free for the same reason
`server/pool.js` is: the rule is the thing worth testing. A new period is mapped to one
week later than the furthest-along mapping the season already has. With nothing mapped
it falls back to the league's own week number - right for a league opening on opening
weekend, which is the reset league's case, and correctable when it is not.

Counting from the mapping rather than from `number` buys the property that matters:
**correct one week and every week after it follows.** Tell it league week 3 is NFL week 5
and week 4 becomes NFL week 6 by itself. That turns the control into a once-a-season
thing instead of a weekly chore, which is the difference between a mapping that stays
right and one that quietly rots.

A playoff round with nothing to count from stays **null**. "Playoff round 1" says nothing
about which Sunday it lands on, and a pull that refuses because the week is unmapped is a
question the commissioner can answer; a wrong number that looks right is not. Past week 23
it returns null for the same reason rather than clamping.

### It is kept off the blob path, and that is the design

The obvious way to make the mapping "correctable by the commissioner" is to put it in app
state and let it flow through `decompose`. That would have been the bug.

The artifact's state shape has no field for it, so the moment `nfl_week` appears in
decompose's period row it joins the upsert's `SET` list on every ordinary blob write -
deal, process schemes, finalize, every pool edit - and any path where the blob does not
carry it writes null straight over a correction. **That is exactly what happened to
`external_ids`** (see the 2026-08-28 notes above), on a column a stats pull cannot work
without.

So it is a server-owned column in the same family as `deal_seed` and `scheme_seed`:
written by direct update from `operations.js` in `afterPersist`, never derived from state.
Three places write it - `createLeague` for a blank league's week 1, and `mapNewPeriod`
after `finalizePeriod` and `startPlayoffs` create one - and `setNflWeek` is the
commissioner's correction. It reaches the UI through `_meta.nflWeek`, which is where
non-artifact facts live precisely so the state shape parity depends on stays untouched.

`tests/server.test.js` carries a test named for it - **"SURVIVES AN ORDINARY BLOB
WRITE"** - which runs finalize, deal and process-schemes and then reads the column back.
"decompose never writes it" is a claim about code; that is a check against a real
PostgREST.

### Checked rather than assumed: an omitted column is preserved

Worth recording because the first reading of this was wrong. **A PostgREST upsert that
omits a column does not null it** - the `ON CONFLICT DO UPDATE SET` list is built from the
payload's keys, so a column that is not in the payload is not in the SET list. Probed
against the running local stack with decompose's exact period column set, and `nfl_week`
came back untouched.

Which means the `external_ids` bug was never about omission. `decompose` wrote a literal
`external_ids: {}`, an explicit empty object, and PostgREST duly applied it. The lesson
generalises the other way round from how it first read: **omitting a column is safe;
writing a default for one you do not know about is not.**

### The fetch, measured

Stage 5's open engineering question, settled the same day. `stats_player_week_2025.csv`
is **8.66 MB**, served with no compression (the release blob store ignores
`Accept-Encoding: gzip`), supports byte ranges, downloads in 0.52-0.74 s, and is
**ordered by week ascending** - 19,423 rows across weeks 1 to 22. So the depth chart's
stream-and-abort trick applies verbatim, capped at the whole file for a late week, which
is under a second inside a 10 s function budget. No ranges, no cache, no new
infrastructure. `stats_player_week_2026.csv` is still a 404, so stage 5 is built entirely
against the recorded fixture - which is what it was recorded for.

`npm test`: **334 passed, 1 skipped, 20 files** with the local stack up.

<!-- stage 3's entry ends here; stage 5 follows. -->

---

## Phase 4 stage 5 - the stats pull (2026-08-29)

The Sunday-night payoff. A commissioner presses **Pull Stats** on the Live Stats screen
and every starter's boxes fill in from one NFL week of the nflverse feed.

**No migration.** The `feed_*` mirror columns went in with the scoring split the day
before precisely so this stage would not need one, and they did.

### The rule, and where it lives

`server/stats.js`, pure and free of I/O for the same reason `server/pool.js` is - and it
is the same rule, because it is the same promise:

> **A pull may write its own work and nothing a person typed.**

`stat_lines.source` says who last set a line. `'feed'` is the pull's own and it may
correct it; `'manual'` is the commissioner's and is never overwritten. The `feed_*`
mirrors are written **either way**, so "the feed says 91, you set 84" is available
whether or not anybody has typed over the numbers - which is what stage 6 renders beside
each box.

### Two identity spaces, deliberately

A skill player is matched on `gsis`, the id the depth charts and the stats file share,
and never on name: a wrong number that looks right is the worst outcome available here.
A head coach has no player id at all, so the Coach slot resolves **by team** - which also
means a team that changed coach mid-season still scores off the right game.

### An unplayed game is not a tie

`games.csv` carries the whole schedule from the day it is published with the score
columns empty, and `Number("")` is `0`. Read as a number, a blank would have given every
coach in the league a tie on Saturday morning. Absent from the results map means "no
result yet", and the pull reports it rather than writing it.

### A player the feed has nothing for is left blank, not zeroed

Scott's answer to OQ-4c is that a starter who does not play scores zero, and a blank
already scores zero - so writing an explicit `0` would claim the feed reported one. On a
Sunday afternoon with half the games still to kick off that is a different statement.
The report names those slots instead, and says which kind of nothing it was: a bye, a
game not finished, or a player with no provider id.

### Three things this turned up

**A batched upsert is not a faster loop.** PostgREST builds ONE insert statement whose
column list is the union of the keys across the batch - so the moment any row carried
`id`, every new row beside it was sent an explicit NULL and `default gen_random_uuid()`
never ran. It fails loudly (not-null violation) rather than corrupting anything, but only
once a pull has both new and existing lines in it, which is every pull after the first.
`statWriteRows` mints the ids. **Same shape as the bug `poolWriteRows` documents, and the
second time on this project** - which is why it is written down in both places.

**The demo league had no provider ids at all.** Its pool is the artifact's hand-typed one,
so every skill slot came back "no provider id" and the button looked broken locally.
`scripts/generate-seed.mjs` now attaches the recorded feed's ids by name, matching the
same pool the provenance scenarios are derived from. That is also what really happens:
`player_pool` was rebuilt from the feed with ids on it and `copy_player_pool_into` carries
them into a new league. A pull against a league whose pool has never been refreshed still
reports exactly that, and says to refresh it.

**A pre-split line cannot be compared field by field.** The demo league's week 2 lines are
the old combined shape, so comparing column by column reported six disagreements ("you
have passing yards blank, the feed says 295") about a line that was filled in perfectly
well. It is said once, on totals, and only when the totals actually differ. Only
historical rows and the seed reach this; nothing written since 2026-08-28 has the shape.

### The fixture grew

One recorded week was not enough - the demo league is dealt past week 1, so a pull asked
for a week the recording did not have and got an empty answer that looked like a fault.
`npm run feed:record` now takes `--stats-weeks` (default `1-4`) and also records
`results-week.csv`, a few weeks of finished games for the Coach slot. **Weeks outside the
recorded range still come back empty on purpose:** that is what the live feed does before
a game is played, so the "nothing for this week yet" path is reachable locally instead of
existing only in production.

### Refusals, each leaving the week exactly as it was

- **an unmapped period** - a pull needs a week of football to ask for, and guessing one
  would write another week's numbers into this one;
- **unlocked rosters** - the same rule `setStatLine` enforces (OQ-E): stats are keyed by
  slot, so a lineup change after a pull would move the numbers to a different player;
- **a feed that is down, late, or 404** - which before the season's first game is the
  ordinary state of affairs rather than a fault, and the message says so.

Nothing here finalizes anything. The week still ends when the commissioner says it does.

`npm test`: **365 passed, 1 skipped, 21 files** with the local stack up.

---

## The stats pull runs on a schedule (2026-09-05)

Stage 7 of `docs/PHASE-4-PLAN.md`, and the last piece of the live-stats feed except the
disagreement view.

**What was asked for:** the numbers should simply be there, without the commissioner
pressing a button.

**The premise turned out to be half wrong, which made this much smaller.** The working
assumption - written into `docs/LIVE-DATA.md` and repeated since - was that nflverse is a
Sunday-night feed. It publishes after games FINISH, which is true, but that happens about
six times in a game week rather than once: nightly, plus post-TNF, post-early-window,
post-late-window, post-SNF and post-MNF. And `fetchWeeklyStats` has always read the live
file at request time with no cache, so every one of those points was already reachable by
whoever pressed the button. **Nothing about the data half needed building.** The corrected
cadence is now recorded in `LIVE-DATA.md` section 5, with the caveat that it is nflverse's
documented intent rather than a contract and wants observing over a live week.

**The pull was already safe to repeat**, which is the other reason this was cheap. A
`feed` line may be corrected by a later pull and a `manual` line never is; a player the
feed has nothing for is left blank rather than zeroed; a coach whose game has not finished
gets no result. Those were written for "a Sunday afternoon with half the games still to
kick off" - which is exactly what a scheduled pull sees. Nothing in `server/stats.js`
changed.

**No new credential, and that is the main design decision.** The obvious shape is a
scheduled function POSTing to `/api` with a shared secret. That would have added a secret
to store and rotate, and an unauthenticated route that writes to every league - guarding
an operation we already have. It is unnecessary: a Netlify scheduled function runs inside
our own deployment and reads the same `SUPABASE_SECRET_KEY`, so
`netlify/functions/pull-stats-scheduled.mjs` is a peer of `api.mjs` and calls
`server/operations.js` directly. `verifySession` is untouched. `scheduledStatsPull` is
deliberately absent from the `ROUTES` table, with a comment there saying why.

**One implementation.** `runStatsPull` was split out of `pullStats` so the job and the
button write identically; only the authorization and how a refusal is reported differ.

**Opt-in per league**, `leagues.auto_pull_stats`, default false (M5,
`20260905010000_auto_pull_stats.sql`). Deploying a job must not start writing into leagues
that never asked. On `leagues` rather than `seasons` because it is operational, not a rule.

**Every guard is a skip.** Not opted in, no current week, wrong phase, unlocked rosters,
unmapped week: each is a normal Tuesday, so a run that skipped everything reports success.
Collapsing that into failure is how a job cries wolf weekly until nobody reads it. The
guards run before the fetch, so an ineligible league costs no outbound request.

**Every three hours**, not six crons chasing nflverse's timetable (Netlify allows one
schedule per function, and their times are not a contract) and not hourly (168 downloads
of an 8.6 MB file per week from a free community source, to save an hour of staleness on
numbers read in the morning).

**Found while building it: the two locks do not meet.** A league playing the `weekly`
lineup lock freezes every lineup automatically at Thursday's kickoff - and the scheduled
pull then still does nothing, because `periods.roster_locked` is a separate, manual
toggle and a pull refuses without it. Deliberately NOT resolved here: letting a clock open
the stats window is a change to the commissioner-driven weekly flow, which is Scott's.
Recorded as **OQ-12**; the scheduler shipped respecting `roster_locked` as it stands.

`npm test`: **249 passed, 135 skipped, 22 files** with no local stack on the machine this
was written on. With the stack up that should read **383 passed, 1 skipped**. The 6 new
database-backed tests in `tests/server.test.js` are in the skipped set and **have not been
run** - they want a green run before this is trusted against a live league. The 12 in
`tests/autoPull.test.js` run anywhere and pass.
