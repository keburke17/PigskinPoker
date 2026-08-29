# Pigskin Poker

A custom fantasy-football league game: every week each team is dealt a fresh random
12-player roster, managers play one scheme (block / steal / redraw), the commissioner
enters stats, and the week is finalized into standings. Playoffs run the same cycle
until a champion is left.

Originally designed and built as a single-file React app running as a published
Claude.ai Artifact. This repo is that app, ported to run as a real website. The original
lives untouched in [`LegacyProject/`](LegacyProject/) as the reference version.

---

## Quick start

Requires [Docker Desktop](https://docs.docker.com/desktop/). Start it first.

```bash
npm install && npm run dev
```

Open <http://localhost:5173>.

That one command starts the local Supabase stack, applies every migration, seeds a
populated demo league, creates the development accounts, writes `.env.local` from the
running stack, and starts Vite. Re-running it is safe. It does **not** reset your
database unless you ask:

```bash
npm run dev -- --reset
```

**Local development runs the real stack, on purpose.** Same Postgres, same Row Level
Security, same Supabase Auth, same privileged-write function that deploys. Three test
files covering every RLS assertion and all server-side authorization skip themselves
silently without it - so "it works locally" against anything less means much less than
it sounds.

### Signing in locally

**With an account** - the only way in. Enter one of these on the Sign In screen.
Nothing is sent anywhere; the local stack captures every message it would have sent.

**You do not have to go looking for the email.** `npm run dev` watches the mailbox and
prints each sign-in link to its console the moment it is sent. On demand:

```bash
npm run link
```

That prints the newest link; `npm run link -- team1@pigskin.test` picks one address, and
`npm run link -- --open` opens it straight away. The mail catcher itself is at
<http://127.0.0.1:54324> if you would rather click the button in the message.

| Account | Role |
|---|---|
| `commish@pigskin.test` | Commissioner |
| `team1@pigskin.test` .. `team5@pigskin.test` | Manager of demo teams 1-5 |

**Team 6 is deliberately unclaimed**, so the path every real member takes is testable
without setting it up first. Sign in as *any* address you like - `nobody@pigskin.test`,
anything - then choose **I Have An Invite Code** and paste:

```
PGSKN2-DEMTEAM234
```

That joins you as manager of the All-In Antlers. The invite is reissued on every
`npm run dev`, so it works again after you redeem it. (The code uses the real alphabet -
no `O`, `I`, `L`, `U`, `0` or `1`, because those get misread aloud - and the real scrypt
hashing. Only its unpredictability is given up, on a database that refuses to hold real
data.)

These are genuine Supabase Auth users with genuine `league_members` rows, created by
`npm run seed:accounts`. There is deliberately no dev-only sign-in bypass in the client -
a bypass is how a login path ends up unenforced in production. The password
`pigskin-local-dev` is set for scripts and `curl`; the app itself only ever uses magic
links. `.test` is reserved by RFC 2606, so these addresses can never receive real mail
even by accident.

### What the demo league contains

Six teams; Week 1 played and finalized so standings and results have data; Week 2 dealt,
schemes resolved, stats part-entered - the state the app is actually in on a Sunday
afternoon. `npm run db:reset` is the one-command way back to it.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Everything: local Supabase, migrations, seed, dev accounts, Vite |
| `npm run dev -- --reset` | The same, but rebuild the database from scratch first |
| `npm test` | Run the engine test suite once |
| `npm run test:watch` | Tests in watch mode |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run seed:generate` | Regenerate `supabase/seed.sql` from the demo league |
| `npm run pool:sql` | Print the `player_pool` rows from `teamRows.js`, for a migration |
| `npm run db:reset` | Rebuild the local database, reseed it, recreate the dev accounts |
| `npm run seed:accounts` | Recreate the local development accounts (idempotent) |
| `npm run link` | Print the newest sign-in link from the local mail catcher |

Deployment commands, all documented in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md):

| Command | What it does |
|---|---|
| `npm run db:push` | Apply migrations to the linked remote **and verify grants** - use this, not `supabase db push` |
| `npm run verify:grants` | Check the live security posture of the linked remote database |
| `npm run verify:email -- you@example.com` | Send one real sign-in email and report what happened |

## How the code is laid out

```
src/
  engine/       pure game logic - no React, no I/O, fully unit tested
  storage/      ALL persistence, behind one interface
  components/   the UI, extracted from the original single file
  styles/       global.css (was an injected <style> template literal)
  data/         teamRows.js - the artifact's player pool, now a test fixture
tests/          Vitest suites, including parity against the original artifact
docs/           data model, open questions, and design decisions
LegacyProject/  the original Artifact version, untouched, for reference
```

**`src/engine/` is the important part.** Dealing, scheme resolution, scoring, ranking,
period finalization and playoff advancement are all pure functions: state in, state or
`{ error }` out. They are the same functions the original ran, moved with their
behaviour intact and verified against it (see below).

**Nothing outside `src/storage/` knows how data is persisted.** There is no
`window.storage` anywhere in `src/`. One adapter implements the interface - Supabase,
reading directly through PostgREST and writing through the Netlify function. There was
a second, in-memory one that let the app boot with no configuration; it is gone, and
`src/storage/index.js` says why.

## Tests

```bash
npm test
```

317 tests. Several kinds:

- **Behaviour tests** for dealing, schemes, scoring, the tiebreak chain, finalization
  and playoff advancement - including the awkward paths: an exhausted player pool at
  each position, a steal where every target is blocked, and an empty free-agent pool.
- **[`tests/parity.test.js`](tests/parity.test.js)** - the important one. It lifts the
  pure-JS region straight out of `LegacyProject/PigskinPokerCode.jsx`, runs it against
  `src/engine/` on identical random seeds, and asserts the results are identical -
  including a full simulated season through the playoffs to a champion.

  **If that file fails, the game has changed.** That is either a bug, or a rule change
  that needs the original designer's sign-off.

- **Security tests** (`tests/rls.test.js`, `tests/server.test.js`,
  `tests/bootstrap.test.js`) run against the real local Postgres. They assert that a
  browser holding the publishable key can read what the league should see and **write
  nothing, anywhere**, that secrets are unreachable, and that a manager cannot enter
  stats, finalize a week, or touch another team's lineup.

  **They skip themselves silently when the local stack is not running - 114 of the 317.**
  Since `npm run dev` now starts that stack for you, the ordinary case is that they run.
  Check the skip count before believing a pass on anything touching storage, auth or the
  schema.

  `server.test.js` resets the demo league between tests by piping `supabase/seed.sql`
  into psql, which deletes and rebuilds the league row - and `league_members` cascades
  with it, so a test run leaves the development accounts signed in but belonging to
  nothing. `npm test` therefore restores them when it finishes
  ([`scripts/test.mjs`](scripts/test.mjs)); the alternative, putting the memberships in
  the seed file, would make fixtures appear in the middle of the security suite.
- **`tests/bundle.test.js`** asserts the secret key never reaches the browser bundle.

Engine tests are deterministic: randomness is injected (`src/engine/rng.js`) and the
clock is frozen where it matters.

## Where things stand

**Live at <https://pigskin.ballsohard.org>**, running on Supabase and Netlify.

Working and verified against real infrastructure: the whole game; real persistence;
server-enforced authorization; live updates over Realtime. Sign-in is a Supabase account
and a magic link; a role is a `league_members` row, checked server-side on every
privileged write; two people editing at once cannot silently overwrite each other; and a
browser holding the public key can read what the league should see and write nothing,
anywhere.

Not done yet:

| | |
|---|---|
| **Phase 4** | Live NFL data. The pool refreshes from nflverse depth charts and scoring splits by category (done); the weekly stats pull is not built yet |
| **Phase 6** | `docs/RULES.md` - the game rules written down outside the code |

Phase 3 is done. Accounts and magic links are the only way in; join codes, the hand-rolled
`sessions` table and our own login rate limiter were dropped rather than finished, because
Supabase Auth does all three. See `docs/AUTH.md`.

### Documentation

| Document | What it covers |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Orientation for a Claude Code session - read automatically |
| [`docs/FOR-THE-DESIGNER.md`](docs/FOR-THE-DESIGNER.md) | Scott's guide: setup, working with Claude, and the decisions waiting on him |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Getting it live, routine operations, troubleshooting |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | The schema, concurrency design, and RLS plan |
| [`docs/AUTH.md`](docs/AUTH.md) | How login works, and the path to real accounts |
| [`docs/OPEN-QUESTIONS.md`](docs/OPEN-QUESTIONS.md) | Decisions still open, for Scott |
| [`docs/MIGRATION-NOTES.md`](docs/MIGRATION-NOTES.md) | What changed from the Artifact, and every bug found on the way |

**Before running a league you care about on a public URL**, read "What is not safe yet" in
[`docs/FOR-THE-DESIGNER.md`](docs/FOR-THE-DESIGNER.md) - a league set to public is readable
by anyone with the address, and email is the only way in, so the mail provider is a single
point of failure. Login guessing is not on that list any more: there is no code to guess,
and Supabase rate limits its own sign-in.
