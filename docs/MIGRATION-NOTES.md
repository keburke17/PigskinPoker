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
not the final shape: `docs/DATA-MODEL.md` §6 defines the operation-shaped interface that
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
  The `<style>` tag that was injected in all four render paths is gone. The CSS itself
  is byte-for-byte unchanged.
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
