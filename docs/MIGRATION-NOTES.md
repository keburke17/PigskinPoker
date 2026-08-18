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
