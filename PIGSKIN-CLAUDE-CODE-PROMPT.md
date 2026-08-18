# Pigskin Poker — Port & Productionize

**A kickoff prompt for Claude Code.** Paste this whole file as your first message in a
Claude Code session opened at the repo root, with `LegacyProject/` present.

---

## Who this is for and what the job is

Pigskin Poker is a custom fantasy-football league game. It was designed and built by a
friend of mine working with Claude, as a **single-file React app running as a published
Claude.ai Artifact**. It works, the league has been played on it, and the rules in it are
his design — they are not a first draft to be improved on.

The job is to take it out of the Artifact sandbox and turn it into a real website that
can live on a custom domain, without changing the game he designed. Three things are
driving that:

1. **Persistence is the blocker.** It depends on `window.storage`, a Claude-only API that
   does not exist in a normal browser. Nothing runs outside Claude until this is replaced.
2. **Some of it is doing more work than it needs to.** Specifically the save path — see
   P3 below. But read the "Do not change" section first, because some of what looks like
   over-engineering is deliberate and must survive.
3. **It is not structured for what's next** — real user accounts and live NFL stats feeds.
   Both should be made *possible* now, structurally, without being built out yet.

The finished repo goes to GitHub so my friend can keep building on it with his own Claude.
Treat "his Claude can pick this up cold and be productive" as a first-class requirement,
not a nice-to-have.

---

## What's in the repo right now

```
LegacyProject/
  PigskinPokerCode.jsx          2,532 lines — the entire app
  PigskinPoker-HANDOFF-README.md  the original author's handoff notes — read this first
```

Read the handoff README before touching anything. It states the author's intent, and
where this prompt and that README disagree, ask me rather than picking one.

---

## Audit findings — already verified, don't re-derive

I have read the whole file. This map is accurate as of the version in `LegacyProject/`.
Use it to skip discovery and go straight to work. Spot-check line numbers as you go, but
you should not need to re-read all 2,532 lines to get oriented.

### Architecture

- One file, one default export (`App`, line 2109). React function components and hooks
  only — `useState`, `useEffect`, `useCallback`, `useRef`. **The only import in the entire
  file is React** (line 1). No router, no state library, no CSS framework, no icon library,
  no fetch, no network calls of any kind.
- ~90 components, all declared at module scope. They are not nested inside `App`, so there
  is no remount-on-every-render problem. This is good and makes extraction mechanical.

### Layout by line

| Lines | What |
|---|---|
| 10–239 | `GLOBAL_CSS` — one big template literal, injected via `<style>` in each render path |
| 242–275 | `TEAM_ROWS` — hardcoded 32-team player pool source data |
| 277–297 | `generatePlayerPool()` — flattens `TEAM_ROWS` (32 teams) into ~220 player objects with ids `p1…pN` |
| 299–322 | Constants: `POSITIONS`, `SCHEME_POSITIONS`, `CP()`/`SUIT_CH`/`ICON` glyphs, `DEFAULT_SCORING` |
| 324–400 | Pure helpers: `shuffle`, `uid`, `deepClone`, `periodLabel`, `makeEmptyLineup`, … |
| 402–429 | `createDefaultState()` — **the canonical state shape**, `schemaVersion: 1` |
| 430–472 | Roster/team lookup helpers |
| 476–550 | `dealRosters()` — pure, with real pool-exhaustion error handling |
| 554–657 | `processSchemes()` — pure; block → steal/redraw resolution |
| 661–857 | Scoring and standings: `computeStarterPoints`, `rankTeamsWithTiebreak`, `finalizeCurrentPeriod`, `seasonStandingsRows`, `startPlayoffs` |
| 859–2097 | All UI components |
| 2099–2100 | `LEAGUE_KEY` / `IDENTITY_KEY` storage keys |
| 2109–2529 | `App` — all state, all handlers, all wiring |

### The crown jewel

Everything in **476–857** is pure, framework-independent JavaScript: dealing, scheme
resolution, scoring, ranking, period finalization, playoff advancement. It takes state in
and returns state or errors out. It has no React in it and no I/O.

This is the most valuable code in the project and it is genuinely well factored. It should
come out nearly verbatim into a testable module. Do not rewrite it while moving it.

### Every point of contact with the outside world

There are only six, which is why this port is tractable:

- `window.storage.get(LEAGUE_KEY, true)` — line 2135, initial league load
- `window.storage.get(IDENTITY_KEY, false)` — line 2168, per-device login
- `window.storage.set(LEAGUE_KEY, …, true)` — line 2187, every save
- `window.storage.set(IDENTITY_KEY, …, false)` — line 2209, identity save
- `Blob` + `createObjectURL` + anchor click — lines 2383–2392, JSON backup download
- `FileReader` + `JSON.parse` — lines 2399–2412, JSON backup restore

---

## Problems, ranked by how much they'll hurt in production

**P1 — Concurrent writes silently destroy each other.** The whole league is one JSON blob
written whole on every change (line 2187), with no version, no compare-and-swap, no merge.
State is loaded exactly once on mount (2178–2181) and never refreshed. So: the commissioner
enters stats while a manager swaps a lineup, and whoever saves second overwrites the other's
work with a stale snapshot — no error, no warning. Nobody finds out until someone notices
their lineup reverted. This is the single most important thing to fix, and it is worse than
the `window.storage` dependency because at least that one fails loudly.

**P2 — The login is not access control.** `commissionerCode` (2225–2237) and each team's
`joinCode` (2240–2247) are stored *inside the league blob* and compared in the browser.
Every visitor's browser downloads all of them. `isCommissioner` (2464) only decides what UI
renders; nothing stops a client from writing any state it likes. Among friends on a private
Artifact link this was a reasonable call. On a public domain it isn't.

**P3 — Write amplification on every keystroke.** This is the over-engineering, and it's
narrower and more specific than it looks:

- `update()` (2214–2220) does `JSON.parse(JSON.stringify(prev))` over the **entire** league
  state for every change.
- The save effect (2201–2205) fires on every `state` change with no debounce, and
  `JSON.stringify`s the whole state again (2187).
- The stat entry yards/TDs boxes are controlled inputs calling `onChange` **per keystroke**
  (lines 1558–1559).

Typing "127" in a yards box is therefore three full clones + three full serializations +
three network writes of a state object holding ~220 players plus an activity log and a
weekly-results array that both grow all season. On game day, with the commissioner entering
stats for every team, this is the thing that will feel slow.

**P4 — `schemaVersion: 1` exists (line 404) but nothing reads it.** There is no migration
path. The moment the shape changes, old backups and stored leagues break.

**P5 — Deals aren't reproducible.** `dealRosters` and `processSchemes` use `Math.random()`
in the browser (326–333, 534–535, 584, 617). A weekly deal can't be replayed or audited, and
a client could in principle re-roll a deal it didn't like.

**P6 — No routing.** Navigation is component state (`tab`, line 2122). No deep links, no
back button, no "here's a link to the standings."

**P7 — No tests at all**, on a codebase whose whole point is fiddly scoring and tiebreak rules.

**P8 — The player pool is hardcoded** (242–275) with local-only ids, and stats are typed in
by hand (`statsEntry`, `StatEntryRow` at 1529). Nothing here can be joined to an external
data source.

**P9 — Backup restore trusts its input.** Line 2402 parses an arbitrary uploaded file and
puts it straight into app state with no shape validation.

**P10 — Elaborate retry machinery** (2129–2199): staged load retries with backoff, a save
retry timer, a manual Save Now, a save-status bar, a blocking error screen. This exists to
compensate for flaky Artifact storage. With a real backend most of it collapses — **but read
the next section before deleting any of it.**

---

## Do not change these

Some of this looks like cruft and is not. Preserve the behaviour; you may change the
mechanism underneath it.

1. **The refusal to silently start blank.** Lines 2138–2147: on a storage read error that
   isn't "key not found," the app deliberately does *not* fall back to an empty league,
   because auto-save would then overwrite real data with nothing. It blocks with a "Couldn't
   load your league" screen (2417–2444) instead. This is correct and hard-won. It must
   survive the port intact.

2. **The strong save guarantee.** The author chose aggressive immediate saving on purpose so
   nothing is ever lost. Keep the *guarantee*; fix the *cost*. Debounce writes, send only
   what changed, flush on `visibilitychange`/`beforeunload`, keep the save-status UI and the
   manual Save Now button. "We optimized it so it saves less" is a wrong answer.

3. **`CP()` / `String.fromCodePoint` for all glyphs** (304–314). The source file is
   deliberately 100% ASCII — I verified, zero non-ASCII bytes. The comment explains why:
   `\u` escapes in JSX text render literally and caused real bugs. Leave the pattern alone.

4. **The game rules, in full.** 6 starters (Coach/QB/WR/RB/TE/FLEX) and 6 bench; each FLEX
   slot independently rolled WR-or-RB at deal time (534–535); block/steal/redraw schemes with
   blocks resolving first (561–574); configurable scoring; the tiebreak chain; the playoff
   bracket and advancement config. These are my friend's design. If something looks like a
   bug, write it down and ask — do not fix it.

5. **The commissioner-driven weekly flow**: `pre-deal → dealt → schemes-processed → stats →
   finalized`. Don't automate away the commissioner's control.

---

## Constraints that shaped the design — and are now gone

This is the counterweight to the section above, and it matters as much.

The author built inside a sandbox with **no database and no network access**. I verified
the second part: the file contains zero `fetch` calls, zero URLs, and zero occurrences of
the string "http." Its only persistence was `window.storage`, a **key-value store** — so a
single JSON blob under one key wasn't a data-modeling decision, it was the only shape
available. He also hit the limits of that storage hard enough to build staged retries, a
save-status bar, a manual Save Now button and a JSON export/import lifeline around it.

So several things that look like design are actually workarounds for walls he couldn't see
past — and some of them may not even have registered as constraints at the time. **Do not
silently "fix" these, and do not silently preserve them either.** List them in
`docs/OPEN-QUESTIONS.md` with a short recommendation each, so the author can say which he
actually wants. My read:

1. **The data model is genuinely open for the first time.** One blob was forced by KV
   storage. Now that it's Postgres, ask what the entities really are — league, season,
   team, roster, period, stat line, event — instead of porting the blob shape into a
   single `jsonb` column out of habit. This is the highest-leverage decision in the
   project and the hardest to change later, which is why it's a Phase 0 deliverable.

2. **There is no such thing as a past season.** `CommResetPanel` (line 2028) wipes the
   league to start over — that's the only way to begin a new year, and it destroys
   everything. Nothing archives. A league that has been running a while wants last year's
   champion on the wall, and season-over-season records. With real tables this is close to
   free, and it's invisible in the current design only because it was impossible.

3. **History exists but isn't queryable.** `activityLog` is prose strings and
   `weeklyResults` is a flat array (lines 416–417). As real rows, these answer questions
   nobody could ask before: head-to-head records, best week ever, how a player performed
   across the season, who gets stolen from most. Model them as data, not as log lines.

4. **Manual stat entry may not be a preference.** With no network, typing stats in was the
   only option — so we can't tell from the code whether the commissioner-as-source-of-truth
   flow is a deliberate choice or a workaround. Ask. Phase 4 scaffolds the seam either way,
   and manual override stays regardless, but the answer changes how prominent a feed should
   be. Same question for the hardcoded `TEAM_ROWS` pool (242–275) — hand-typed because a
   roster couldn't be fetched.

5. **Join codes were the only option, not a chosen one.** No auth primitives existed in the
   sandbox. He may well prefer real accounts now, or may like that there's nothing to sign
   up for. Ask before assuming either. (Phase 3 keeps the code UX and fixes the security
   underneath, which is the safe default until he answers.)

6. **Nobody can be notified of anything.** No email, no push, nothing. For a commissioner,
   "rosters are dealt — submit your scheme before Sunday" is probably the single biggest
   quality-of-life feature in the whole app, and it simply could not exist before. Worth
   raising even though it's out of scope for this pass.

7. **Backup/restore was a lifeline; now it's a convenience.** The JSON export (2382–2413)
   exists because storage wasn't trustworthy. With Postgres and real backups, keep it — it's
   still useful, and it's how the existing league data migrates over — but it should no
   longer constrain the design of anything else.

8. **Check it on a phone.** The league will be looking at this on phones on Sunday
   afternoon. Artifacts are usually built and tested in a desktop panel. Verify the real
   responsive behaviour rather than assuming.

---

## How I want you to work

### Phase 0 — Confirm the stack and design the schema, then stop

**The stack is already decided: Supabase (Postgres + Auth + Realtime + RLS) with the
static frontend on Netlify, served from a custom domain I own.** The Supabase project is
already created, with **"Enable automatic RLS" turned on** — an event trigger that enables
Row Level Security on every new table in the `public` schema.

Sizing, so you can right-size decisions: roughly 10–14 managers, one commissioner, a
17-week season plus playoffs. Traffic is spiky — near zero midweek, everyone at once on
Sunday. Total data is small; a full season is well under 10 MB.

**Do not write application code in this phase.** Produce `docs/DATA-MODEL.md` covering:

- The **schema**: tables, columns, keys, and how the current single-blob state (line 402,
  `createDefaultState`) decomposes into them. Explicitly say which parts stay as `jsonb`
  and why — full normalization is not automatically the right answer here.
- The **concurrency design** for P1: where the version/`updated_at` check lives, what a
  rejected stale write looks like to the user, and which tables Realtime subscribes to.
- The **storage adapter shape that follows from that schema** — this drives Phase 2, so
  don't leave it implicit.
- The **RLS policy plan** — see the section below.
- Anything about this stack you think is a bad fit, and what you'd do instead.

Then **stop and wait for my approval** before building. If you disagree with the stack,
say so now rather than after the migration.

#### Supabase specifics you must account for

These have bitten people; handle them deliberately rather than discovering them at runtime.

- **RLS on + no policy = deny all.** Because the auto-RLS trigger is on, every table you
  create via SQL or migration starts locked. If a query returns zero rows during
  development, suspect a missing policy *before* you suspect the query. Write policies in
  the same migration as the table — never as a follow-up commit.
- **Use the new API key scheme, not the legacy one.** Supabase now issues `sb_publishable_…`
  and `sb_secret_…` keys; the older `anon` / `service_role` JWTs still work but are
  deprecated by the end of 2026. This project is being built in August 2026 — do not build
  on the legacy keys. Where older docs and tutorials say `anon`, read "publishable"; where
  they say `service_role`, read "secret."
- **The publishable key is public.** It ships to every browser. Assume an attacker holds it
  and can call the REST API directly. RLS is what makes that safe; UI conditionals are not.
  Nothing secret — join codes, the commissioner code, their hashes — may sit in a table the
  publishable key can read.
- **The secret key bypasses RLS.** Privileged writes (deal, process schemes, enter stats,
  finalize) go through a Netlify Function holding the secret key, which enforces the
  commissioner check in code. That key stays server-side, lives in Netlify's environment
  variables and a git-ignored `.env.local`, and is never exposed to the browser or
  committed. RLS is the backstop that stops the client routing around that function.
- **Default posture**: the publishable key gets read access to what the league is meant to
  see and write access to almost nothing. Manager lineup and scheme edits are the narrow
  exception — either scope them by policy to that manager's own team, or route them through
  a function too. Recommend one and say why.

#### Project details

- Project URL: `https://wzzrxoslcwpyopdvvxmn.supabase.co` (ref `wzzrxoslcwpyopdvvxmn`).
  This is public by design — it appears in every request from the browser.
- Keys are in the dashboard under **Settings → API Keys**. I will put them in `.env.local`
  and in Netlify myself. **Never ask me to paste a secret key into a chat window, and never
  write one into a file that git tracks.** Read them from the environment only.
- Use the Supabase CLI and keep `supabase/migrations/` in the repo, so the entire schema
  rebuilds from an empty project with one command. My friend will need to stand up his own
  instance, and I want a local stack that isn't my production data.
- **Free projects pause after ~1 week of inactivity** (one-click resume). Invisible during
  the season, relevant in the offseason. Note it in the deployment docs so nobody panics in
  March.

### Phase 1 — Scaffold and restructure

Vite + React. Modern tooling, minimal config, no framework beyond what's needed.

```
src/
  engine/        pure game logic — no React, no I/O, fully unit tested
    deal.js, schemes.js, scoring.js, standings.js, playoffs.js, state.js
  storage/       persistence behind ONE interface (see below)
  components/    the extracted UI
  hooks/
  styles/        GLOBAL_CSS becomes a real stylesheet
docs/
tests/
```

Move lines 476–857 into `src/engine/` **as directly as possible**. Same function names,
same behaviour. This step should be nearly mechanical — resist the urge to improve it in
transit.

**One permitted signature change, and only this one: inject the randomness.** The engine
currently calls `Math.random()` internally (via `shuffle` at 326–333, and directly at
534–535, 584 and 617). Thread an RNG in as a parameter instead, defaulting to a real random
source. Do this **now, in Phase 1**, not later — it's what makes the tests below
deterministic, and it's the same seam Phase 2 needs to move dealing server-side with a
stored seed. Doing it in Phase 1 costs nothing; retrofitting it after the tests are written
means rewriting them.

Use **Vitest** — it comes with Vite and needs no extra config. Then write unit tests
against the moved code, including:

- dealing with a pool too small at each position (the errors at 500–514 and 539–542)
- a steal where every candidate target is blocked (the no-victim path, 609–616)
- a steal or redraw when the free-agent pool is empty at that position (623–639)
- the full tiebreak chain in `rankTeamsWithTiebreak` (684)
- `finalizeCurrentPeriod` (708) — standings points, cumulative rollups, best-player tracking
- playoff advancement through to a champion (836)

Those tests are the safety net for everything that follows, and they're the main artifact
that will let my friend's Claude change scoring rules later without fear.

#### Make it runnable locally with demo logins from day one

I want to click around a working app without touching production data, and so will my
friend. Build this in early rather than bolting it on:

- **`supabase/seed.sql`** creating a demo league in a known state: a commissioner, ~6 teams
  with fixed names, a dealt week with schemes submitted and some stats entered, and at
  least one finalized week so standings and results pages have something in them. Seeds run
  automatically on `supabase start` and `supabase db reset`, so `supabase db reset` becomes
  the one-command way back to a clean, populated app.
- **Two documented demo logins** — a demo commissioner code and a demo team join code, both
  in `README.md`. These are obviously-fake development credentials, seeded only locally and
  never in production. Make that impossible to confuse: name them something like
  `DEMO-COMMISH` / `DEMO-TEAM-1`, and have the seed refuse to run against a non-local
  database.
- **An in-memory storage adapter** so `npm run dev` works with no Supabase running at all.
  Fastest possible loop for pure UI work, and it doubles as the test adapter.
- Deterministic seeding: fix the RNG seed so the demo league deals the same rosters every
  time. Reproducible bug reports matter more than variety here.

When Phase 3 introduces real sessions, extend the same seed to create demo auth users
(via the admin API in a seed script — `auth.users` should not be hand-INSERTed), keeping
the same two personas so the local workflow doesn't change.

### Phase 2 — Real persistence, and fix P1

All persistence goes behind **one interface** in `src/storage/`, with two implementations:
Supabase, and in-memory for tests and offline UI work. Nothing outside `src/storage/`
should know Supabase exists.

**The shape of that interface falls out of the Phase 0 schema — don't fix it before then.**
The naive version is a blob API (`load() → {state, version}`, `save(state, expectedVersion)`),
and if Phase 0 concludes the state should stay largely as a single `jsonb` document, that's
fine and simple. But if the schema decomposes into real tables — which is what I expect and
what fixes P3 properly — then a whole-state `save()` is the wrong shape and would just
recreate the artifact's problem on top of Postgres. In that case the interface should be
**operation-shaped**: `submitScheme`, `swapLineupSlot`, `setStatLine`, `dealPeriod`,
`finalizePeriod`, and so on, each writing only what it touches.

Whichever shape it takes:

- **Every write carries the version it was based on.** A stale write is rejected, not
  applied. On rejection: refetch, tell the user plainly ("someone else just updated the
  league — reloading"), and re-apply if it's safe to. Never resolve a conflict by
  overwriting.
- **Writes touch only what changed.** A stat entry writes a stat line, not the league.
  This is what actually kills P3 — debouncing alone only reduces how often you send too
  much data.
- Add live updates via Supabase Realtime so a manager watching on Sunday sees the
  commissioner's stats without refreshing. Fall back to polling only if Realtime turns out
  not to fit.
- Debounce the save path and coalesce keystrokes, but flush on blur, on
  `visibilitychange`, and on `beforeunload`. Keep Save Now.
- Add real schema migrations keyed off `schemaVersion`, and validate restored backups
  against the expected shape before letting them near app state (fixes P4 and P9).
- Move dealing and scheme resolution server-side, using the RNG seam from Phase 1 with a
  seed stored on the period, so a week can be replayed and audited (fixes P5). This also
  stops a client re-rolling a deal it didn't like.
- Per-device identity (line 2209) does not need the backend — `localStorage` is the right
  home for it.

### Phase 3 — Real authorization now, real accounts later

To be clear about what this phase is: the **login experience** stays as-is, but the
**enforcement** becomes real. That's not cosmetic work — it's the fix for P2.

The commissioner-code / team-join-code login is what my friend's league knows. **Keep that
experience.** Change what's underneath:

- Codes never ship to the browser. Store them hashed; verify server-side; return a session.
- Real tables — `leagues`, `league_members` with a role, and a profile table — even though
  today a "member" is just someone holding a join code. Adding email or Google sign-in
  later should be additive. **Don't create your own `users` table in `public`** — Supabase
  owns `auth.users`; reference it and put your own columns in a `profiles` table keyed to
  it, so real accounts drop in without a data migration.
- **Enforce authorization on the server.** Only the commissioner can deal, process schemes,
  enter stats, or finalize. Only a manager can edit their own team. Right now these are UI
  conditionals; they need to be real checks (fixes P2).
- Write down the path from "join codes" to "real accounts" in `docs/AUTH.md`, including how
  existing members would be migrated.

### Phase 4 — Scaffold the live-data seam, don't wire a provider

- Give every player a stable `externalIds` field (e.g. `{ provider: 'x', id: '…' }`),
  nullable for now, so the pool can be reconciled against a real feed.
- Move `TEAM_ROWS` (242–275) out of source into a data file that can be regenerated.
- Define a `StatsProvider` interface — something like `getWeeklyStats(season, week) →
  { playerId, yards, tds }[]` plus coach W/L/T — with the current **manual commissioner
  entry as the default implementation**. Manual override must always remain available; the
  commissioner is the source of truth even when a feed exists.
- In `docs/LIVE-DATA.md`, survey the realistic NFL stats API options with current pricing
  and licensing, and note which ones would fit. Don't sign anything up.

### Phase 5 — Deploy, and bring the real league across

Get it live on my domain. Document DNS, HTTPS, environment variables, preview deploys, and
how to roll back, in `docs/DEPLOYMENT.md` — written so someone who has never deployed a site
can follow it.

**Then migrate the actual league.** There is a real league with real history sitting in the
Artifact right now, and it only comes out through the Commissioner → Backup JSON export
(2382–2413). Build a one-shot importer that reads that export and writes it into the new
schema, and **verify it by comparing standings, cumulative totals and the champion against
the old app side by side** — not by checking that the import didn't throw.

Two things to get right here:

- Ask me for the export early rather than at the end. If the Artifact ever stops working,
  that JSON file is the only copy of the league's history that exists.
- Never point the importer at production first. Import into local, verify, then production.

### Phase 6 — Hand off to my friend

This is the part that matters most and gets skimped most often. The repo must be pickup-ready
for someone using their own Claude:

- `README.md` — what the game is, how to run it locally, how to deploy.
- `CLAUDE.md` — orientation for the next Claude session: architecture, where the engine
  lives, the invariants in "Do not change" above, how to run tests, what's deliberately
  unfinished.
- `docs/RULES.md` — the game rules as implemented, extracted from `RulesTab` (1734) and the
  engine, so the design is written down outside the code for the first time.
- `docs/MIGRATION-NOTES.md` — what changed from the Artifact version and why. Anything you
  had to decide unilaterally goes here, explicitly.
- `LegacyProject/` stays in the repo, untouched, as the reference original.
- Conventional commits, a sensible `.gitignore` (**and confirm `.env` is in it**), no
  secrets committed. Then walk me through the GitHub repo creation and first push.

---

## Ground rules

- **Phase 0 ends in a stop.** Do not start Phase 1 until I approve the schema and RLS plan.
- **Every table ships with its policies in the same migration.** No "we'll add RLS later."
- **Ask before changing game behaviour.** Restructuring is yours to decide. Rules are not.
- **Stay boring with dependencies.** The original has exactly one — React. That is a real
  asset for a project being handed to a hobbyist and his Claude. Vite, Vitest, the Supabase
  client and a router are expected; anything beyond that, justify it first. No UI kit, no
  state library, no CSS framework. The existing CSS is hand-written and fine.
- **The league may be mid-season.** Don't leave production in a half-migrated state
  overnight. Cut over deliberately, and tell me when a step is one-way.
- Keep the app runnable at the end of each phase. No phase should end with a broken tree.
- Commit per phase, with real messages.
- If a phase turns out much bigger than described, tell me and propose a split rather than
  silently half-doing it.
- When you finish a phase, summarize what changed, what you decided on your own, and what
  you're unsure about. I would much rather have an open question than a confident guess.

## Done means

- Runs on my domain, at a real URL, with no `window.storage` anywhere in `src/`.
- Two people editing at once cannot silently clobber each other.
- Managers see live changes on Sunday without refreshing.
- Commissioner-only actions are enforced on the server, not in the browser — and holding
  the publishable key gets you nothing you couldn't get through the UI.
- No table in `public` is reachable with the publishable key except through a policy
  someone wrote on purpose.
- Engine tests pass, cover the scoring and tiebreak rules, and are deterministic.
- The real league's history is imported and verified against the old app, not just loaded.
- Adding real accounts, or a stats feed, is a change to one module — not a rewrite.
- `supabase db reset && npm run dev` gives anyone a working, populated league with demo
  logins, in one step, against no production data.
- `docs/OPEN-QUESTIONS.md` exists and gives the author real decisions to make, not a list
  of things already decided for him.
- My friend can clone the repo, read `CLAUDE.md`, and be productive with his own Claude
  in ten minutes.
