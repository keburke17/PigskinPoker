# Phase 4, stages 1 and 4 - handoff to Kyle

Written 2026-08-28, at the end of the session that built them. This is the entry point:
what changed, what you have to run, and what to argue with. Everything below is already
in the branch - this exists so you are not reading a 400-line plan document cold.

Branch: `scott/phase-4-plan`. Five commits, 27 files.

---

## The one thing that needs you - DONE 2026-08-29

```bash
npm run db:push
```

> **Applied 2026-08-29, and the day it took is the lesson.** The frontend deployed on
> merge, as it always does; the migrations did not, because migrations never run
> themselves. So for a day the live site ran Phase 4 code against a Phase 3 schema, and
> Scott hit it as *"Adding new players failed: Could not find the 'depth_rank' column of
> 'players' in the schema cache"*. That message reads like a stale PostgREST cache and was
> not one - check `npx supabase migration list --linked` before reaching for a cache
> reload. Nothing was half-written: the insert is one statement, and it runs before the
> updates, so the failed refresh left the pool untouched.

**Two migrations, and nothing works until they land.** Both are forward-only, add
nullable or defaulted columns, rewrite no rows and delete nothing.

| Migration | What it adds | Why |
|---|---|---|
| `20260828000000_split_stat_categories.sql` | Six per-category columns on `stat_lines` plus six `feed_*` mirrors | Yards and TDs now count separately as passing / rushing / receiving |
| `20260828010000_pool_feed_sync.sql` | `players.depth_rank`, `.source`, `.status_source`, `.feed_status`, `.feed_updated_at`; the unique index on `external_ids->>'gsis'`; `periods.nfl_week` | Lets the pool be refreshed from a feed without overruling the commissioner |

Neither adds a table, so `verify:grants` has nothing new to check - the new columns
inherit the existing policies. The second one runs one `update`: it marks any
already-non-Active player status as `manual`, so the first refresh cannot overrule a
decision made before the column existed.

**There is deliberately no migration for `scoring_config`.** The engine and both screens
fall back to defaults for any key a stored config predates, so existing leagues keep
working untouched and the first "Save Scoring" writes the full shape. Changing the
column default would only affect seasons created afterwards and leave existing rows
inconsistent with it.

---

## What changed, in one paragraph each

**Scoring split (OQ-4c).** One yards number at one rate for every position made a
quarterback worth several times any other slot - a 300-yard, 3-TD passing day scored 45
against a good receiver's 17. Yards and touchdowns now split three ways, each with its
own commissioner-editable rate: passing 1:25, rushing 1:10, receiving 1:10, TDs 4/6/6.
The same day now scores 24 against 18. Only passing, rushing and receiving count -
returns, two-point conversions and fumble-recovery TDs are worth nothing, and a starter
who does not play scores zero.

**Pool refresh (OQ-4b).** The hand-typed 223-player pool is replaced by each NFL team's
current starters read off the live depth charts - 1 QB, 2 RB, 2 WR, 1 TE and the head
coach, 224 rows. Commissioner-pressed, pre-deal only, never automatic. Its first real run
corrected "Derek Henry" to Derrick Henry, "Kalil Shakir" to Khalil Shakir, "Tet McMillan"
to Tetairoa McMillan, and Arizona's head coach from Mike LaFleur to Jonathan Gannon.

---

## The four decisions worth knowing before you review

**1. Parity survived the rules change, and that was the point.**
`computeStarterPoints` keeps a second, frozen branch for stat lines carrying the
artifact's combined `yards`/`tds`, scored at the artifact's rates. That is forced by the
data rather than chosen: a combined total does not record how much of it was passing, so
a pre-split row cannot be converted and any backfill would be inventing numbers. Because
`parity.test.js` feeds combined-shape lines, **both full simulated seasons still run to a
champion and match the artifact object-for-object.** The six new `scoringConfig` keys are
the only recorded difference, and the test asserts everything outside them still matches.

**2. Pre-deal only is the whole safety argument for the refresh.**
Finalize deletes the week's rosters, so in pre-deal there is nobody on a team to disturb.
It is also Scott's rule: a player who stops being a starter finishes his week and is
simply absent from the next deal. The phase gate is in `PHASE_RULES`, same as everything
else.

**3. The feed may correct its own work and nothing a person decided.**
`players.source` (`seed` / `feed` / `manual`) and `players.status_source` (`default` /
`feed` / `manual`) carry that. A player Scott added is never touched; a status he set is
never overwritten, and the feed's opinion is recorded in `feed_status` beside it and shown
to him as a disagreement. The logic is `server/pool.js`, deliberately free of I/O so it is
tested directly - `tests/pool.test.js`, 26 tests. **Retiring is `status = OUT`, never
deletion**, because a deleted player breaks the rosters, stat lines and results that
reference him.

**4. nflverse over ESPN, and it is not the call it looks like.**
nflverse *sources its depth charts from ESPN*. Same data, republished with the player ids
the weekly stats file uses. Going direct to ESPN buys a few hours of freshness and costs a
second identity space to reconcile against an undocumented endpoint. ESPN's endpoint is
recorded in `PHASE-4-PLAN.md` 5.1 as the fallback if a release is ever late.

---

## Two bugs this turned up, both pre-existing

Neither was reachable before this work and neither would have failed a test. Both were
found by driving the real UI and then reading the table.

**`decompose` reset `external_ids` to `{}` on every blob write.** The app-state shape has
no field for provider ids, so any ordinary pool edit silently cleared them - and the
coming stats pull would have had nothing to match on. Now carried forward from the stored
row.

**Manual status changes were not recorded as manual.** Pool edits go through
`replaceLeague` -> `decompose`, which wrote no provenance, so marking a player OUT left
`status_source` at `default` and the next refresh would have quietly put him back -
defeating decision 3 entirely. `decompose` now records a status differing from the stored
row as `manual`, which is sound because that path is only ever driven by the
commissioner's own screens. A new `newPlayerSource` option distinguishes the seed
generator (rows a refresh may replace) from a person adding a player (rows it must not).

---

## Performance note, since it changes where this can live

`depth_charts_<season>.csv` is the whole season's snapshots in one file - about 45MB. It
is written **newest first**, with a `dt` per snapshot, so `readLatestSnapshot` reads until
`dt` changes and aborts the request: a few hundred KB, ~700ms measured against the live
file. That is why the refresh sits in the existing request handler with no scheduler and
no new deploy surface. If nflverse ever reorders the file it still returns the right
answer, it just reads further - an optimisation, not a correctness bet.

Head coaches come from `games.csv` (`home_coach` / `away_coach`), since depth charts carry
no coaches. That is the same file the Coach slot's Win/Tie/Loss will score from later.

---

## Verification

`npm test`: **295 passed, 1 skipped, 18 files** at the time of writing; **317 / 19** after
the three follow-ups below. Local stack up, no skipped files, so RLS, server and bootstrap
all ran. New in this handoff: `tests/scoring.test.js` (20), `tests/pool.test.js` (26).

Driven end to end in the running app, not just asserted:

- 300 passing yards + 3 passing TDs reads 24 pts; adding 40 rushing yards and a rushing TD
  reads 34. Both survive a reload. The database shows the split columns populated, the
  legacy columns null, all 15 pre-split rows untouched and no row carrying both shapes.
- The refresh button refuses during the stats phase and explains why.
- First refresh: 223 active from the feed, 27 stale rows retired, and **exactly one row
  left alone** - Josh Allen, OUT because it was set by hand. 31 active QBs, not 32.
- Second refresh added and retired nothing, and reported the disagreement in one line.
- Week 3 dealt cleanly from the rebuilt pool.
- No horizontal overflow at 375px on either screen.

---

## What happened after this was written (2026-08-29)

Three changes, all merged, none of them in the description above:

- **The refresh's writes are batched.** It issued one PostgREST request per changed
  player - 225 of them, measured, sequentially, against a 10-second function timeout, and
  the first live refresh is the worst case. `poolWriteRows` merges each patch onto its row
  and upserts in chunks: 2 requests instead of 224.
- **`player_pool` was rebuilt from the live depth charts** (`20260829000000`). The refresh
  only ever rewrote one league, so the template every NEW league is copied from still held
  "Derek Henry". A league created now starts current, with provider ids attached.
- **The feed is recorded** into `server/feed/fixture/`, and local development reads it by
  default. `stats_player_week_2026.csv` is a 404 until games are played, so a recorded past
  week is the only stat data stage 5 can be built against. It cannot reach production:
  `server/feed/index.js` refuses the fixture unless the database is local.

## What is NOT built

Stages 5, 6 and 7 in `PHASE-4-PLAN.md`: the "Pull stats" button, the disagreement view for
stat lines, status sync, and scheduled polling. Stats are still typed in by hand, exactly
as today - which is fine for week 1 if the calendar gets tight, and is why stage 1 was
built without any feed dependency.

**The deadline is Scott's reset**, not a date. He is resetting the league before NFL week
1 and starting the real season on it. Both of these want to be true on day one; landing
them afterwards recreates a mid-season rules change in a season that counts.

---

## Where to read next

| Document | For |
|---|---|
| `docs/PHASE-4-PLAN.md` | The full plan, the decisions table, and what is left |
| `docs/MIGRATION-NOTES.md` | The two "Phase 4" sections at the end - what changed and why |
| `docs/OPEN-QUESTIONS.md` | OQ-4c and OQ-4b, answered 2026-08-28 with Scott's reasoning |
| `server/pool.js` | The refresh rule, and the best single file to argue with |
| `server/feed/nflverse.js` | The fetch, the parse, and the early-abort |
