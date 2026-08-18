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

```bash
npm install
```

```bash
npm run dev
```

Open <http://localhost:5173>. **No database or configuration is needed** - the app boots
against an in-memory store seeded with a populated demo league (six teams, one finalized
week, a second week in progress with stats part-entered).

### Demo logins

These are obviously-fake, local-only development credentials. They exist solely in the
in-memory store, are never sent anywhere, and must never be used for a real league.

| Role | Code |
|---|---|
| Commissioner | `DEMO-COMMISH` |
| Team manager | `DEMO-TEAM-1` through `DEMO-TEAM-6` |

Pick "I'm the Commissioner" or "I'm a Team Manager" on the login screen. A full page
refresh resets the demo league to its seeded state - refresh is the reset button.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with the seeded demo league |
| `npm test` | Run the engine test suite once |
| `npm run test:watch` | Tests in watch mode |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## How the code is laid out

```
src/
  engine/       pure game logic - no React, no I/O, fully unit tested
  storage/      ALL persistence, behind one interface
  components/   the UI, extracted from the original single file
  styles/       global.css (was an injected <style> template literal)
  data/         teamRows.js - the player pool source data
tests/          Vitest suites, including parity against the original artifact
docs/           data model, open questions, and design decisions
LegacyProject/  the original Artifact version, untouched, for reference
```

**`src/engine/` is the important part.** Dealing, scheme resolution, scoring, ranking,
period finalization and playoff advancement are all pure functions: state in, state or
`{ error }` out. They are the same functions the original ran, moved with their
behaviour intact and verified against it (see below).

**Nothing outside `src/storage/` knows how data is persisted.** There is no
`window.storage` anywhere in `src/`.

## Tests

```bash
npm test
```

83 tests. Two kinds:

- **Behaviour tests** for dealing, schemes, scoring, the tiebreak chain, finalization
  and playoff advancement - including the awkward paths: an exhausted player pool at
  each position, a steal where every target is blocked, and an empty free-agent pool.
- **[`tests/parity.test.js`](tests/parity.test.js)** - the important one. It lifts the
  pure-JS region straight out of `LegacyProject/PigskinPokerCode.jsx`, runs it against
  `src/engine/` on identical random seeds, and asserts the results are identical -
  including a full simulated season through the playoffs to a champion.

  **If that file fails, the game has changed.** That is either a bug, or a rule change
  that needs the original designer's sign-off.

All tests are deterministic: randomness is injected (`src/engine/rng.js`) and the clock
is frozen where it matters.

## Where things stand

Ported and working: the whole game, running in a normal browser against a pluggable
storage layer, with the engine under test.

Deliberately not done yet: real persistence (Supabase), server-enforced authorization,
and a live stats feed. Those are Phases 2-4 - see [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md)
for the schema and concurrency design they are built on, and
[`docs/OPEN-QUESTIONS.md`](docs/OPEN-QUESTIONS.md) for the decisions still open.

The join-code login is currently checked in the browser, exactly as the original did.
**It is not access control yet** - that is Phase 3. Don't put a real league on a public
URL before then.
