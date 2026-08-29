# Pigskin Poker - orientation

Read this before changing anything. It exists so a Claude Code session can be productive
here without first re-deriving how the project is shaped, and - more importantly -
without "helpfully" fixing things that are deliberate.

---

## What this is

A custom fantasy-football league game. Each week every team is dealt a fresh random
12-player roster, managers play one scheme (block / steal / redraw), the commissioner
enters stats, and the week is finalized into standings. Playoffs run the same cycle until
one team is left.

It began as a single-file React app running as a published Claude.ai Artifact, designed
and built by the league's owner. **The original is preserved untouched in
`LegacyProject/`.** This repo is that app ported to run as a real website, with the game
itself unchanged.

Live at <https://pigskin.ballsohard.org>.

---

## Who you are working with

Two people run sessions in this repo, and they want different things from you.

**Scott - the designer.** He invented the game and built the original Artifact. He is a
football guy, not a developer: he works on rules, screens, wording and feel, and he is
here to keep making the app more his. Talk about the game, not the codebase - "Week 2's
standings" rather than "finalizeCurrentPeriod". **Do the mechanical work yourself**
(see "Doing the git work" below); a list of commands for him to run is a worse answer
than running them.

**He is the designer this file keeps deferring to.** Every "ask the designer" here, and
every open question in `docs/OPEN-QUESTIONS.md`, is addressed to him. So when he is the
one in the session he can simply answer - that is not a rules change made behind
anyone's back, it is the decision the question was waiting for. When he decides one:

1. Say plainly what it does to the league *before* changing anything - "teams level on
   the first five tiebreakers currently get ranked by whichever joined first; this makes
   them a real tie" - then do what he says. Do not talk him into it, and do not let him
   change a rule without realising he did.
2. Make the change in `src/engine/`, and follow "If you are changing game rules" below.
3. Record the answer and the date in `docs/OPEN-QUESTIONS.md` in the same change.

**Kyle - the plumbing.** He did the port and owns the hosted services the game runs on:
Supabase, Netlify, Resend, DNS, the secrets, and applying migrations to the live database.
Technical, drives his own git, wants the reasoning rather than the summary. **He owns the
configuration, not the code** - `server/`, `netlify/` and the migration files themselves
are ordinary repository code and Scott changes them too. The intent is that the services
stay put and both of them iterate on the app on top of them - so if a request needs the
hosting, the secrets or the live database changed, that is worth saying out loud rather
than quietly doing.

If you cannot tell which of them you are talking to, ask once, early.

---

## Doing the git work

Kyle pushes and merges himself - offer, do not assume. **For Scott, drive it.** He should
be able to say "save this" or "put it live" and have it happen.

1. **Never commit on `main`.** Branch off the remote, so a bare `git push` cannot land on
   main: `git checkout -b scott/<short-name> --no-track origin/main`.
2. `npm test` before committing: **302 passed, 1 skipped, 18 files**. If the output says
   files were *skipped*, Docker is not running, the security tests did not execute, and
   you have not verified what the green tick suggests. Say so rather than reporting a
   pass.
3. Conventional commit, push the branch, open the pull request. Use `gh pr create` if the
   GitHub CLI is signed in; otherwise push and hand him the link:
   `https://github.com/keburke17/PigskinPoker/compare/<branch>?expand=1`.
4. **Merging is publishing.** Netlify rebuilds <https://pigskin.ballsohard.org> from
   `main` a minute or two after a merge, with no further step. Say that out loud before
   merging, every time. Nothing else is automatic - migrations never run themselves.

Hand these back to Kyle rather than doing them in Scott's session:

- `npm run db:push`, or any other command that touches the hosted database
- environment variables, keys, DNS, and the hosted service settings - Netlify, Supabase,
  Resend

**Repository code is not on that list, and that includes `server/` and `netlify/`.** Scott
works server-side as well as on screens: `83bc6d4` is his, and it added a route to
`server/operations.js` and wired it through `netlify/functions/api.mjs`. What is Kyle's is
the hosted *configuration*, and anything that changes the live database - not the code in
this repository that runs against them.

Writing a migration on a branch is fine; applying one is not. The live database holds a
season people are actually playing, and there is no undo.

**That split is a two-person rule, not a limit on what Scott is allowed to do**, and it is
worth knowing which - so a session does not send him away for a permission he is not
actually missing. `db:push` needs a Supabase account with access to the project
(`supabase login`, then `supabase link`, both per-machine and neither of them in this
repository). It is Kyle's because the account is; nothing in the code gates it, and an
organization invitation would change that whenever they decide to. It stays with him
because applying a migration is the one step here with no undo: they are forward-only, so
a mistake is corrected by writing another one against a live season, and hosted Supabase
grants `GRANT ALL` to `anon` on every new table - which `verify:grants` reports only after
the push has already happened. Scott writes the migration; Kyle runs `db:push`.

If something breaks live, the fastest fix is Netlify's own **rollback to the previous
deploy** (`docs/DEPLOYMENT.md`), not a hurried commit.

`.claude/settings.json` pre-approves the local, reversible half of that list - inspecting,
committing, branching, pulling, the test and build scripts - so a session is not four
prompts deep before anything happens. **`git push`, `gh pr create`, `gh pr merge`,
`npm run dev` and every `db:` script are deliberately left out.** Those are the moments
something leaves the machine or changes a database, and one prompt there is worth having.
Do not add them.

---

## The rule that matters most

**The game rules belong to the original designer. Restructuring is fair game; behaviour
is not.**

If something looks like a bug in the game logic, it may well be one - several are known.
Write it down in `docs/OPEN-QUESTIONS.md` and ask. Do not fix it. A silent rules change
in a league that is actually being played is worse than a bug everyone has adapted to.

### Specific things that look wrong and must stay

- **`rankTeamsWithTiebreak` compares only 5 of its 6 tiebreakers** (`src/engine/standings.js`,
  the `i < 5` loop). The sixth documented tiebreaker never applies, and teams level on the
  first five get ranked by input order instead. **This is OQ-A, deliberately preserved,
  pending the designer's decision.** `tests/standings.test.js` asserts the current
  behaviour on purpose and carries a skipped test for the fix. Changing the loop bound
  changes the league's standings.
- **`CP()` / `String.fromCodePoint` for every glyph** (`src/engine/constants.js`). The
  source is deliberately 100% ASCII. The original author hit real bugs with escapes in
  JSX text rendering literally. Do not "simplify" this to raw unicode or `\u` escapes.
- **The refusal to start blank on a load error.** If loading the league fails for any
  reason other than "no league exists", the app blocks with an error screen rather than
  falling back to an empty league - because auto-save would then write emptiness over
  real data. See `src/hooks/useLeague.js`.
- **The commissioner-driven weekly flow**: `pre-deal -> dealt -> schemes-processed ->
  stats -> finalized`. Do not automate away the commissioner's control.
- **`commissionerCode` and each team's `joinCode` still exist in the engine's state
  shape** (`src/engine/state.js`, `src/storage/demoLeague.js`) even though nothing
  persists or checks them any more. That shape is the artifact's, and
  `tests/parity.test.js` compares against it field by field - removing them would break
  parity. `decompose.js` drops them on the floor instead, which
  `tests/roundtrip.test.js` asserts.
- **Blocks resolve before steals and redraws**, and steals resolve in a single shuffled
  pass so freed players can flow between actions (`src/engine/schemes.js`). The ordering
  is load-bearing.

---

## Layout

```
src/
  engine/       pure game logic - no React, no I/O, fully tested
  routing/      hand-written URL routing - no dependency, see the note in index.js
  storage/      ALL persistence, behind one interface
  hooks/        useLeague.js - the read/write lifecycle
  components/   the UI, extracted from the original single file
  styles/       global.css
  data/         teamRows.js - player pool source data (see the note below)
server/         privileged operations. NEVER imported from src/
netlify/        the one HTTP endpoint, a thin wrapper over server/
supabase/       migrations (forward-only) and the local demo seed
tests/          18 suites
docs/           design, decisions, deployment
LegacyProject/  the original Artifact, untouched
```

### `src/engine/` is the valuable part

Dealing, scheme resolution, scoring, ranking, finalization, playoff advancement. All pure
functions: state in, state or `{ error }` out. No React, no I/O, no network. The same
server-side code runs in the Netlify function, so there is no second implementation to
drift.

The **one** concession is `rng.js`: functions needing randomness take an `rng` parameter
defaulting to `Math.random`. That is what makes tests deterministic and lets the server
store a seed so a week can be replayed.

### The storage boundary

Nothing outside `src/storage/` knows how data is persisted. There is no `window.storage`
anywhere in `src/`. One adapter implements the interface:

- **Supabase** - reads directly via PostgREST, writes through the Netlify function

There was a second, in-memory adapter - the default with no configuration, seeded with a
demo league. It was deleted once local development moved to the real stack, because it
was a second full implementation of every operation that could not authenticate anybody.
`src/storage/index.js` carries the reasoning.

`hydrate.js` turns database rows back into the exact shape the original UI expects, which
is why ~90 components survived the port unchanged. `decompose.js` is the inverse.

### `server/` is not importable from `src/`

It holds the secret key, which bypasses Row Level Security. `tests/bundle.test.js` fails
if anything from `server/` - or any secret - reaches the browser bundle.

---

## Running it

Docker Desktop must be running. Then:

```bash
npm install && npm run dev
```

One command: it starts the local Supabase stack, applies migrations, seeds the demo
league, creates the development accounts, writes `.env.local` from the running stack, and
starts Vite. It does not reset the database unless you pass `--reset`.

**Local development is the real stack, deliberately.** Same Postgres, same RLS, same
Supabase Auth, same privileged-write function that deploys. The alternative - a
zero-config in-memory mode - could only ever exercise the join-code half of
`verifySession()`, which meant everything from Phase 3b onwards (accounts, memberships,
invites, multi-league) existed only in production and in tests. Local and hosted never
talk to each other; only migrations cross, and only when someone runs `db push`.

Sign in with an account - the only credential there is:

- **an account** - `commish@pigskin.test`, or `team1@pigskin.test` .. `team5@pigskin.test`.
  Magic links are captured at <http://127.0.0.1:54324> rather than sent, and `npm run dev`
  prints each one to its console as it arrives (`npm run link` fetches the newest on
  demand). Seeded by `scripts/seed-accounts.mjs` as genuine Supabase Auth users with
  genuine `league_members` rows. The link plumbing reads the mailbox a human would
  otherwise read - there is no dev-only sign-in bypass in the client, and adding one
  would defeat the point of developing against the real thing.
Team 6 is left unclaimed on purpose, with a standing invitation (`PGSKN2-DEMTEAM234`), so
the new-member path - unknown address signs in, redeems, lands on a team - can be tried
without issuing a code first. `scripts/seed-accounts.mjs` reissues it every run.

`npm run db:reset` is the way back to a clean, populated league. `npm run dev` also
applies any migration that is in the repo but not in your local database, so a pull that
adds one does not leave you running against a stale schema.

**If `tests/server.test.js` skips itself complaining about extra leagues**, you made one
through the UI (Phase 3d added that button). The demo seed refuses to run where other
leagues exist, on purpose. `npm run db:reset` clears it.


## Tests

```bash
npm test
```

302 tests. Three groups worth knowing about:

- **`tests/parity.test.js`** is the safety net. It lifts the pure-JS region straight out
  of `LegacyProject/PigskinPokerCode.jsx`, runs it against `src/engine/` on identical
  seeds, and asserts identical results - including two full simulated seasons through the
  playoffs to a champion. **If it fails, the game has changed.** That is either a bug you
  just introduced, or a rules change that needs the designer's sign-off *and* an update
  to that file explaining what changed and why.
- **`rls.test.js`, `server.test.js`, `bootstrap.test.js`** need the local Supabase stack
  (started for you by `npm run dev`) and **skip themselves silently without it** - 110 of the 302
  tests. They cover every Row Level Security assertion, all server-side authorization,
  and the regression guard for a bug that would destroy the league on the first team
  added.

  **A green `npm test` with no local stack has verified none of that.** Check the skip
  count before trusting a pass on anything touching storage, auth or the schema.
- Everything else runs anywhere.

Engine tests are deterministic - randomness is injected, the clock frozen where it
matters.

---

## If you are changing game rules

1. Check `docs/OPEN-QUESTIONS.md` first - it may already be a recorded question.
2. Change the engine, not the UI. Rules live in `src/engine/`.
3. `npm test` will fail on `parity.test.js`. That is correct and expected.
4. Update `tests/parity.test.js` to record the intended difference, with a comment saying
   what changed and why. Do not delete the test.
5. Update `docs/RULES.md` if it exists by then, and `docs/MIGRATION-NOTES.md`.

### The player pool lives in two places on purpose

`player_pool` is the table every league is created from; `src/data/teamRows.js` is the
artifact's hand-typed pool, and since Phase 4 the two have different jobs.

- **The table comes from the live depth charts.** `20260829000000_pool_template_from_feed.sql`
  rebuilt it as each NFL team's 1 QB, 2 RB, 2 WR, 1 TE and head coach - 224 rows with the
  provider ids attached - generated by `npm run pool:sql:feed`. It goes stale from the day
  it is taken, so it is a starting point, not a substitute for the Refresh Player Pool
  button. Regenerate into a NEW migration; never edit an applied one.
- **`teamRows.js` cannot move, and is no longer the pool.** `tests/parity.test.js` lifts
  `TEAM_ROWS` straight out of the original artifact and replays dealing against it, so it
  is a test fixture now. `npm run pool:sql` still expands it, for reading the artifact's
  own pool as SQL - it is not how the template is built any more.
- **`player_pool` is a TEMPLATE, not shared data.** Creating a league copies it into that
  league's own `players` rows (`copy_player_pool_into`). A commissioner marking someone
  OUT is a statement about their league, and sharing one row would leak it into
  everybody else's. `tests/server.test.js` asserts exactly that.
- **To correct the pool for future leagues**, change the table (forward-only migration).
  To change what the engine deals in tests and parity, change `teamRows.js`. Doing one
  without the other is legitimate; doing neither and editing a league's `players` rows
  directly only affects that league, which is often what you actually want.

## If you are changing the database

Migrations are **forward-only**. Never edit one that has been applied - add a new one.
Every table ships with its RLS policies in the same migration; a table without them is
unreachable.

**Push with `npm run db:push`, never with `npx supabase db push` directly.**

```bash
npm run db:push
```

That runs the push and then `verify:grants`, which is not optional and must not be left
to anyone's memory. Hosted Supabase grants permissive defaults on new tables that the
local stack does not, so **every** table added by a migration is born with `GRANT ALL`
to `anon` - the role the public browser key uses. It is invisible locally, no unit test
can catch it, and it has happened once already on this project
(`supabase/migrations/20260818020000_revoke_default_grants.sql` exists because of it).

If you add a table that must be unreachable from a browser, add it to `SECRETS` in
`scripts/verify-grants.mjs` in the same change, or the verifier will not know to check
it. `docs/DEPLOYMENT.md` explains the whole failure mode.

---

## What is deliberately unfinished

| | |
|---|---|
| **Real accounts** | **Done.** Magic-link sign-in is the only way in. Join codes, the hand-rolled `sessions` table, our login rate limiter and the `has_*_code` flags were all dropped (`supabase/migrations/20260820000000_retire_join_codes.sql`). A role is a `league_members` row; people join by invitation. See `docs/AUTH.md`. |
| **Live stats feed** | The seam exists (`stat_lines` carries provenance); no provider is wired. **Planned in `docs/LIVE-DATA.md`, deliberately not started** - it blocks on OQ-4c, which is Scott's. |
| **Backup import** | Export/restore works and is validated, but no historical league has been imported - the Artifact league was a worked example, not real history. |
| **Public league directory** | `leagues.visibility` is a checked text column with room for a `'listed'` state; the directory itself is not built. |

---

## Where to read next

| Document | For |
|---|---|
| `docs/OPEN-QUESTIONS.md` | **Decisions waiting on Scott.** Start here if you are him. |
| `docs/FOR-THE-DESIGNER.md` | Scott's own guide - setup, and what working with you looks like |
| `docs/LIVE-DATA.md` | **The stats-feed plan.** Provider survey, what it would take, and what it waits on |
| `docs/DATA-MODEL.md` | Schema, concurrency design, RLS plan |
| `docs/AUTH.md` | How login works, and why join codes were retired |
| `docs/EMAIL-SETUP.md` | **Making magic links arrive.** Dashboard steps; required before accounts work in production |
| `docs/DEPLOYMENT.md` | Getting it live, operations, troubleshooting |
| `docs/MIGRATION-NOTES.md` | What changed from the Artifact, and every bug found on the way |

---

## Conventions

- Source files are ASCII-only. So are the docs.
- Conventional commits.
- Dependencies stay boring. The original had exactly one (React); this has React, Vite,
  Vitest and the Supabase client. Anything beyond that needs justifying - it is being
  handed to a hobbyist, and every dependency is something he has to maintain.
- No UI kit, no state library, no CSS framework. The hand-written CSS is fine.
