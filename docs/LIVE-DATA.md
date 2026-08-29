# Live Stats Data (Phase 4)

`DATA-MODEL.md` section 9 promised this file would become "a real procurement document"
once a feed was on the table. This is it.

**Status when this was written: nothing was wired.** That is no longer true - see the 2026-08-28
update below, and `docs/PHASE-4-PLAN.md` for what has since been built. Read this file for
the provider survey and the reasoning, not for status. What existed then was the seam - the schema columns a feed needs, paid for up front in
Phase 0 so that adding one later would not mean a migration and a backfill across a season
people are playing. This document is the plan, the survey, and the questions that have to
be answered before any of it can be built.

Written 2026-08-23, scoping the idea with Kyle. **It is deliberately not started**, because
the central question belongs to Scott. See OQ-4c in `docs/OPEN-QUESTIONS.md`.

> **Update 2026-08-28 - Scott answered, and the plan moved.** OQ-4c and OQ-4b are both
> settled: yards and touchdowns split into passing / rushing / receiving at customizable
> rates, and the hand-typed pool is rebuilt from current NFL starters. **Build from
> `docs/PHASE-4-PLAN.md`**, which carries the decisions, the staging and the migrations.
> This file stays as the provider survey and the reasoning behind choosing nflverse -
> sections 3 and 8 below are the questions that were open, kept for the argument in them,
> not for their answers.

---

## 1. Where this stands today

> **Superseded 2026-08-29 - this section describes the position BEFORE Phase 4, and is
> kept because the rest of the document argues from it.** The stats pull is built: the
> commissioner presses **Pull Stats** and every starter's boxes fill in from one NFL week,
> with anything he typed left exactly as he typed it. `docs/PHASE-4-PLAN.md` and
> `docs/MIGRATION-NOTES.md` are the authority on what shipped. **The goal stated in this
> section is the one that was met** - the Sunday-night job is now correcting a couple of
> numbers rather than entering seventy-two.

Every stat in the league is typed in by hand. The commissioner opens the stats tab after
the games, fills six slots for each team, and finalizes. That is `setStatLine`
(`server/operations.js`), gated on being the commissioner and on the roster being locked.

It works, and it is not going away - the commissioner stays the source of truth. The goal
here is narrower than "automate the week": it is to make the typing rare, so that what the
commissioner does on a Sunday night is *correct a couple of numbers* rather than enter
seventy-two of them.

### What is already built

| Piece | Where | State |
|---|---|---|
| Provenance on every stat line | `stat_lines.source` (`'manual'` / `'feed'`) | Shipped, unused *(in use since 2026-08-29)* |
| What the feed last reported | `stat_lines.feed_yards`, `feed_tds`, `feed_coach_result` | Shipped, always null *(written since 2026-08-29, alongside six per-category mirrors added by the scoring split)* |
| Which provider, and when | `stat_lines.feed_provider`, `feed_updated_at` | Shipped, always null *(written since 2026-08-29)* |
| Stable player identity | `players.external_ids`, `player_pool.external_ids` (jsonb) | Shipped, always `{}` *(carries gsis/espn ids since 2026-08-29)* |
| Identity survives league creation | `copy_player_pool_into` copies `external_ids` | Shipped, copies `{}` *(copies real ids since the template rebuild)* |

So the expensive half is done. Retrofitting provenance onto live season data would have
been a migration plus a backfill; adding a feed on top of these columns is application
code.

### What is not built

**All four of these were built during Phase 4 (2026-08-28 and 2026-08-29).** The list is
kept because sections 3 and 4 argue against it.

- ~~No mapping from a league week to an NFL week (section 4.2).~~ `periods.nfl_week`,
  defaulted by `server/schedule.js` and correctable by the commissioner.
- ~~No player identity resolved against any provider (section 4.1).~~ `gsis` and `espn`
  ids are attached by the pool refresh and carried into new leagues by the template.
- ~~No definition of what the `yards` number means (section 3 - **the blocker**).~~
  Answered as OQ-4c: split into passing / rushing / receiving, each at its own rate.
- ~~No fetch, no operation, no UI.~~ `server/feed/nflverse.js`, `pullStats` in
  `server/operations.js`, and the Pull Stats button on the Live Stats screen.

**Still not built:** the persistent disagreement view beside each stat box (the pull
reports its disagreements, but only in the report it returns), and scheduled polling -
stages 6 and 7 in `docs/PHASE-4-PLAN.md`.

---

## 2. What a feed actually has to produce

The scoring surface is unusually small, which is the main reason this is tractable at all.
`computeStarterPoints` (`src/engine/scoring.js`) is the whole of it:

```
non-Coach:  floor(yards / yardsPerPoint) + tds * pointsPerTD     (default 10, 5)
Coach:      coachWin | coachTie | coachLoss                      (default 2, 1, 0)
```

Six starters per team. There is no PPR, no per-position scoring, no bonus tier, no
fractional anything. Per team per week, a feed has to supply:

| Slot | What the feed must supply |
|---|---|
| QB, WR, RB, TE, FLEX | one `yards` integer and one `tds` integer, per starter |
| Coach | `Win` / `Tie` / `Loss` |

**The Coach slot is easier than it looks.** No stats provider exposes "how did this head
coach do this week", and that was the awkward gap `DATA-MODEL.md` flagged. But the game
does not actually need the coach: `players` carries `nfl_team`, so the Coach slot's result
is just that team's result that week, read off a schedule endpoint. The coach's identity
never has to be resolved against anything - which also means the pool's coach names, typos
and all, do not matter here.

---

## 3. The blocking question: what counts as "yards"

**Nothing in this repo, or in the original artifact, defines which yards.** `RulesTab`
says "1 point per 10 yards" and stops. The engine takes one `yards` integer regardless of
position.

That is fine under manual entry, because the commissioner's fingers *are* the
specification. It is fatal for a feed, because a QB and a WR share one field at one
conversion rate:

```
Josh Allen    300 passing yards + 3 TDs  ->  30 + 15 = 45 points
Puka Nacua     90 receiving yards + 1 TD ->   9 +  5 = 14 points
```

If passing yards count at par, the QB slot decides the week and the other five are noise.
That may be exactly what the game is - a quarterback *should* matter - or the commissioner
may have been entering something else entirely. Both are legitimate. Only Scott knows.

**This is not a rules change. It is an undocumented rule** that manual entry allowed us to
never write down. The question to ask is not a design question, it is
"what have you been typing in for a quarterback?"

The same absence repeats down the list, and each needs an answer before a feed can be
wired:

- Do passing TDs count the same as rushing and receiving TDs?
- Does a QB's rushing yardage get added to his passing yardage?
- Do receiving yards count for a running back, and rushing yards for a receiver?
- Do return yards, two-point conversions or fumble-recovery TDs count at all?
- What does a player who did not play produce - `0`, or a blank line?

Recorded as **OQ-4c** in `docs/OPEN-QUESTIONS.md`. Until it is answered, nothing else in
this document can be built, because there is no way to test whether the feed is right.

---

## 4. The two smaller gaps

### 4.1 Player identity

`src/data/teamRows.js` is hand-typed, and it shows: "Derek Henry", "Kalil Shakir",
"Tet McMillan", "Jaxson Smith-Njigba", "Sam Laporta", "Kevin Stafanski". Fuzzy name
matching will resolve most of the pool and quietly mis-resolve the rest, which is the worst
available outcome in a league that is being played - a wrong number that looks right.

**The fix is a one-time reconciliation script, with a human in the loop.** It proposes a
provider id for each pool row, auto-accepts only exact matches, and makes someone confirm
everything ambiguous. The confirmed ids go into `player_pool.external_ids`, with the unique
index the schema comment already anticipates, so a later refresh cannot double-match.

Two consequences worth knowing:

- New leagues inherit the ids for free - `copy_player_pool_into` already copies
  `external_ids`.
- **Existing leagues do not.** Their `players` rows were copied before the ids existed, so
  they need a one-off backfill joined on `legacy_id`. That is a migration, and it touches
  the live season.

This also settles **OQ-4b** as a side effect: doing the reconciliation tells us whether
`TEAM_ROWS` was curated on purpose or typed out of necessity, because we will see exactly
how far it sits from a real roster.

### 4.2 League week is not NFL week

`periods` has `number`, `seasons` has `year`, and nothing connects either to an NFL week.
League week 1 is only NFL week 1 if the league happened to start on opening weekend.

One nullable `nfl_week` column on `periods`, set when the period is created, defaulting to
something sensible and correctable by the commissioner. Trivial to add, but it has to exist
before a single stat can be fetched, and it is a migration.

---

## 5. Provider survey

| Provider | What it is | Cost | Latency | Risk |
|---|---|---|---|---|
| **nflverse** | Weekly player stats and schedules published as static files on GitHub releases | Free, no key, no account | After games complete | Community-run; a release could be late |
| **MySportsFeeds** | Full sports data API, boxscores and injuries | Free for non-commercial | Near-live | Account and key; terms are per-use |
| **ESPN (undocumented)** | The endpoints their own site calls | Free, no key | Live | Unsupported, undocumented, can change or close without notice |
| **SportsDataIO** | Commercial real-time NFL feed | Paid | Live | None technically; it is a bill |
| **FantasyPros** | Rankings, projections, news | Freemium | n/a | Projections, not results - wrong shape for this |

> **Correction, 2026-08-28.** The ESPN row above is misleading by omission: **nflverse
> sources its depth charts from ESPN.** So for the roster half of this, the two are the same
> data, and nflverse adds cleaning plus its own player ids - the ones the weekly stats file
> uses. Choosing ESPN directly would buy freshness and cost a second identity space to
> reconcile. Reasoning in `docs/PHASE-4-PLAN.md` section 5.1. ESPN's depth-chart endpoint is
> recorded there as a fallback.

### Recommendation: nflverse

Not close, for this project specifically:

- **No key, no account, no rate limit, no terms-of-service exposure.** It is `fetch`
  against a URL that returns a file. That matters more here than usual - the app is being
  handed to a hobbyist, and a provider account is one more thing that can expire, get
  rotated, or start charging.
- **It adds no dependency.** No SDK, no client library. That keeps the promise in
  `CLAUDE.md` about dependencies staying boring.
- **It has both halves**: weekly per-player stats, and schedule results for the Coach slot,
  from one source with one identity space.
- **It is auditable.** The same file can be fetched by hand and diffed when a number looks
  wrong, which is what actually happens the first time somebody disputes a score.

**What it costs us:** it publishes after games finish, not during them. The `LiveScoresBar`
stays a Sunday-night thing rather than a live one.

**That is a question for Scott, not a limitation to work around.** If "automatic" means he
wants to watch numbers move during the 1pm games, nflverse is the wrong choice and the
answer is MySportsFeeds or a paid feed - a different project with an account, a key, and a
polling budget. If "automatic" means the numbers are simply there when he sits down to
finalize, nflverse is strictly better than the alternatives.

---

## 6. The shape to build

Staged so that each stage is useful alone, and so the one that needs new infrastructure
comes last.

### Stage 1 - a "Pull stats" button

The commissioner presses it during the stats phase. No scheduler, no cron, no background
job, no new deploy surface.

- One new operation beside `setStatLine` in `server/operations.js`, reachable through the
  existing single Netlify function. Same commissioner check. **Same roster-locked guard**,
  for the same reason as OQ-E: numbers that arrive while the lineup can still move will
  land on the wrong player.
- It writes `feed_*` on every slot it can resolve, always.
- It writes the *effective* `yards` / `tds` / `coach_result` only where `source` is not
  already `'manual'`. **A line the commissioner has touched by hand is never overwritten.**
- Slots it cannot resolve are left alone and reported, not zeroed.

This is the version where a bad feed week costs one ignored button press, and it keeps the
commissioner-driven weekly flow that `CLAUDE.md` is emphatic about.

### Stage 2 - show the disagreement

"The feed says 91, you set 84", with a one-click revert. The columns for this already
exist; this stage is entirely UI. It is what makes stage 1 trustworthy, and it should not
be deferred far behind it.

### Stage 3 - scheduled polling

A Netlify scheduled function that runs stage 1's operation on a timer during the season.
Genuinely optional once stage 1 exists, and it is the first piece that adds a deploy
surface and a thing that can fail silently at 3am. **Kyle's, not Scott's.**

### Stage 4 - status sync

Pull `OUT` / `IR` / `BYE` into `players.status` from the same source. Arguably worth more
than the stats themselves: a roster dealt full of inactive players is the thing that
actually ruins a week, and it happens *before* kickoff, where there is still time to react.

### Cost and ownership

| Stage | Rough size | Migration? | Whose session |
|---|---|---|---|
| OQ-4c answered | one conversation | no | **Scott** |
| Identity reconciliation (4.1) | half a day, plus review time | yes - id index, plus backfill for the live league | Kyle |
| `nfl_week` (4.2) | an hour | yes | Kyle |
| 1 - pull button | a session or two | no | either; Kyle applies nothing |
| 2 - diff and revert | a session | no | Scott |
| 3 - scheduled polling | a session | no, but new infra | **Kyle** |
| 4 - status sync | a session | no | either |

Migrations can be *written* on a branch in any session. Applying them is Kyle's, always -
the live database holds a season people are playing.

---

## 7. What this must not change

- **The commissioner stays the source of truth.** A feed proposes; a person finalizes. The
  `pre-deal -> dealt -> schemes-processed -> stats -> finalized` flow is untouched, and
  there is no path where a week finalizes itself.
- **The engine does not learn about feeds.** A feed writes stat lines; `src/engine/` scores
  them exactly as it does today. `tests/parity.test.js` must stay green through every stage
  above - if it ever fails, the feed has changed the game rather than fed it.
- **A feed writes into a league, never into the template.** `player_pool` is a template
  that leagues copy from; `stat_lines` and `players` belong to one league. The only thing a
  feed ever writes to `player_pool` is `external_ids`, during reconciliation. A player
  marked OUT is a statement about one league (`tests/server.test.js` asserts this).
- **No new dependency.** `fetch` and the existing Supabase client. If a provider can only
  be used through its SDK, that counts against the provider.

---

## 8. Open questions

| # | Question | Whose |
|---|---|---|
| **OQ-4c** | What counts as "yards", and as a TD, per position? | **Scott - blocks everything** |
| **OQ-4b** | Is `TEAM_ROWS` curated on purpose, or typed out of necessity? | Scott; answered in passing by 4.1 |
| - | Does "automatic" mean live during games, or ready by Sunday night? | Scott; decides the provider |
| - | Should a pull fill the numbers in, or propose them for approval? | Scott; stage 1 vs. a heavier stage 2 |
| - | Is a missing player a zero or a blank? | Scott; part of OQ-4c |
