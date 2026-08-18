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

Live at <https://pigskinpoker.netlify.app>.

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
- **Blocks resolve before steals and redraws**, and steals resolve in a single shuffled
  pass so freed players can flow between actions (`src/engine/schemes.js`). The ordering
  is load-bearing.

---

## Layout

```
src/
  engine/       pure game logic - no React, no I/O, fully tested
  storage/      ALL persistence, behind one interface
  hooks/        useLeague.js - the read/write lifecycle
  components/   the UI, extracted from the original single file
  styles/       global.css
  data/         teamRows.js - player pool source data
server/         privileged operations. NEVER imported from src/
netlify/        the one HTTP endpoint, a thin wrapper over server/
supabase/       migrations (forward-only) and the local demo seed
tests/          15 suites
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
anywhere in `src/`. Two adapters implement one interface:

- **in-memory** - the default with no configuration, seeded with a demo league
- **Supabase** - reads directly via PostgREST, writes through the Netlify function

`hydrate.js` turns database rows back into the exact shape the original UI expects, which
is why ~90 components survived the port unchanged. `decompose.js` is the inverse.

### `server/` is not importable from `src/`

It holds the secret key, which bypasses Row Level Security. `tests/bundle.test.js` fails
if anything from `server/` - or any secret - reaches the browser bundle.

---

## Running it

```bash
npm install && npm run dev
```

No database, no keys, no configuration. Boots against an in-memory demo league:
commissioner `DEMO-COMMISH`, managers `DEMO-TEAM-1` .. `DEMO-TEAM-6`. Refresh resets it.

**This is the right mode for trying rule changes.** It cannot touch the live league.

For the real stack (Docker required):

```bash
npx supabase start && npx supabase db reset
```

then create `.env.local` from `npx supabase status` - see `README.md`. Local and hosted
never talk to each other; only migrations cross, and only when someone runs `db push`.

---

## Tests

```bash
npm test
```

190 tests. Three groups worth knowing about:

- **`tests/parity.test.js`** is the safety net. It lifts the pure-JS region straight out
  of `LegacyProject/PigskinPokerCode.jsx`, runs it against `src/engine/` on identical
  seeds, and asserts identical results - including two full simulated seasons through the
  playoffs to a champion. **If it fails, the game has changed.** That is either a bug you
  just introduced, or a rules change that needs the designer's sign-off *and* an update
  to that file explaining what changed and why.
- **`rls.test.js`, `server.test.js`, `bootstrap.test.js`** need the local Supabase stack
  (`npx supabase start`) and **skip themselves silently without it** - 59 of the 190
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

## If you are changing the database

Migrations are **forward-only**. Never edit one that has been applied - add a new one.
Every table ships with its RLS policies in the same migration; a table without them is
unreachable. After any `db push` to a hosted project, run `npm run verify:grants` -
hosted Supabase grants permissive defaults on new tables that local does not, so this
class of mistake is invisible locally. `docs/DEPLOYMENT.md` explains.

---

## What is deliberately unfinished

| | |
|---|---|
| **Rate limiting on login** | None. The single thing to fix before a league anyone cares about is on a public URL. |
| **Team join code length** | No minimum. A two-character code is currently possible. |
| **Real accounts** | Join codes only. `docs/AUTH.md` has the migration path; the schema is ready for it. |
| **Live stats feed** | The seam exists (`stat_lines` carries provenance); no provider is wired. |
| **Routing** | Navigation is component state. No deep links, no back button. |
| **Backup import** | Export/restore works and is validated, but no historical league has been imported - the Artifact league was a worked example, not real history. |
| **Multiple leagues** | The database supports it; the app does not. See OQ-10. |

---

## Where to read next

| Document | For |
|---|---|
| `docs/OPEN-QUESTIONS.md` | **Decisions waiting on the designer.** Start here if you are him. |
| `docs/DATA-MODEL.md` | Schema, concurrency design, RLS plan |
| `docs/AUTH.md` | How login works, path to real accounts |
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
