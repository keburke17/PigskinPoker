# Phase 4 - Live stats and live rosters

The plan `docs/LIVE-DATA.md` was waiting on. Scott answered OQ-4c and OQ-4b on
**2026-08-28**, and the answers are larger than "wire a feed": the scoring rule itself
changes, and the hand-typed player pool is replaced by current NFL starters.

> **Stages 1 and 4 are BUILT AND LIVE.** The scoring split (engine, settings, stat entry,
> rules screen) and the pool refresh (nflverse feed, the "Refresh Player Pool" button and
> its report) shipped 2026-08-28; their migrations were applied to hosted on **2026-08-29**,
> which is when both actually started working in production - the frontend deployed on
> merge and spent a day running against a schema that did not have the columns yet.
> `npm test`: 317 passed, 1 skipped, 19 files, with the local stack up. What they changed -
> and the bugs they turned up - is recorded in `docs/MIGRATION-NOTES.md`.
>
> **Three things landed on 2026-08-29, after the handoff was written:** the refresh's
> writes are batched (it was one request per player, 225 of them, against a 10-second
> function timeout); `player_pool` was rebuilt from the live depth charts, so a new league
> is no longer born holding the 2025 names; and the feed is recorded into
> `server/feed/fixture/` for local development, which is what makes stage 5 buildable
> before any 2026 game has been played.
>
> **Stage 3 landed on 2026-08-29:** every period now carries the NFL week it plays, so a
> pull has a week to ask the feed for. See "Stage 3, as built" below.
>
> **Stage 5 landed on 2026-08-29:** the "Pull Stats" button reads one NFL week off the
> feed and fills every starter's boxes in, and never overwrites a line the commissioner
> typed. See "Stage 5, as built" below.
>
> **Stage 7 landed on 2026-09-05:** the pull runs on a schedule for leagues that opt in.
> See "Stage 7, as built" below.
>
> **Still unbuilt: stage 6** - the persistent disagreement view beside each box. Stage 2's
> identity reconciliation is done in passing: the refresh attaches `gsis` and `espn` ids
> as it matches, and the rebuilt template carries them from league creation, so there is
> no reconciliation pass to run.

**Sections 6 onward describe the rules everything here has to keep; stages 6 and 7 in
section 7 are the work not started.** Everything else is built.

**Read section 2 first if you are Kyle.** The deployed league is test data and resets before
NFL week 1, which makes three of the four migrations easier than they look - and turns the
reset into a deadline for the two stages that should be true on day one.

---

## 1. What Scott decided

| # | Question | Answer |
|---|---|---|
| **OQ-4c** | What counts as "yards"? | **Split into three categories, each with its own rate.** Passing 1 point per 25 yards, rushing 1 per 10, receiving 1 per 10. All three customizable, exactly as `yardsPerPoint` is today. |
| **OQ-4c** | Touchdowns | **Split the same way.** Passing TD 4, rushing TD 6, receiving TD 6. All customizable. |
| **OQ-4c** | Return yards, two-point conversions, fumble-recovery TDs | **Out.** Only passing, rushing and receiving count, for both yards and TDs. |
| **OQ-4c** | A starter who does not play | **Zero.** The line reads 0 and he contributes 0. Same bad break as any manager who starts an inactive player. |
| **OQ-4c** | When it takes effect | **NFL week 1, on the reset league.** Originally "next week, mid-season"; Scott confirmed later the same day that the deployed league is test data and resets before the season, so there is no mid-season cutover to manage (section 2). |
| **OQ-4b** | Is `TEAM_ROWS` curated or typed? | **Typed out of necessity - rebuild it from live rosters.** The pool becomes each team's current starters, refreshed so it tracks injuries and depth-chart moves. |
| - | Pool depth | **Fixed counts: 32 QB, 64 RB, 64 WR, 32 TE, 32 head coaches = 224.** That is each NFL team's starters - 1 QB, 2 RB, 2 WR, 1 TE, 1 coach. No WR3s, no TE2s, **and no ranking step** (updated 2026-08-28, replacing an earlier "top 150-200" filter). |
| - | "Automatic" means | **Ready by Sunday night now; keep the option to go live later.** |
| - | What a pull does | **Fills the boxes in.** Scott corrects what is wrong; anything he has touched is never overwritten. |
| - | A rostered player who stops being a starter | **Nothing until the next deal.** He finishes the week; he is simply not in the pool when fresh rosters are dealt. |

---

## 2. What this does to the league

Worth stating plainly, because this is the first deliberate rules change in the port.

**The quarterback stops deciding the week.** A 300-yard, 3-TD passing day goes from
`30 + 15 = 45` points to `12 + 12 = 24`. A 120-yard, 1-TD receiver goes from `12 + 5 = 17`
to `12 + 6 = 18`. QB moves from "block or steal him every single time" to one good slot
among six. That is the stated goal, and it will visibly change scheme behaviour - expect
blocks and steals to spread across the roster instead of piling on the QB.

**Nothing already played has to survive it.** Scott confirmed on 2026-08-28 that the
deployed league is **test data, to be reset before NFL week 1**. That removes the whole
mid-season problem this section originally described - there is no live season to split
down the middle, no part-old-scoring standings, and nobody to warn.

It also changes three things elsewhere in this plan, and they are all simplifications:

| Was | Is now |
|---|---|
| M3 backfills player ids into a live season (4.6) | The reset league copies a template that already has ids. **The delicate migration stops being delicate.** |
| `nfl_week` needs a sensible default and a correction path (M2) | League week 1 **is** NFL week 1. The column still earns its place for later seasons, but the mapping is not a guess. |
| The league is told mid-season that scoring changed | Nothing to tell. The new rules are simply the rules from week 1. |

**What it does add is a deadline.** Everything that should be true on day one - the scoring
split, and a pool built from real starters - wants to land **before the reset**, not after
it. Miss that window and the mid-season problem comes back, this time in a season that
counts. See section 7.

**Old stat lines still cannot be converted**, and that still shapes section 3.2 - but now
only because `tests/parity.test.js` replays the artifact's combined-yards data, not because
anybody's real scores depend on it.

---

## 3. The scoring change (no feed involved)

### 3.1 Config shape

`scoringConfig` grows. New keys, with Scott's values as defaults:

```
passYardsPerPoint: 25      pointsPerPassTD: 4
rushYardsPerPoint: 10      pointsPerRushTD: 6
recYardsPerPoint:  10      pointsPerRecTD:  6
coachWin: 2   coachTie: 1   coachLoss: 0        (unchanged)
yardsPerPoint: 10   pointsPerTD: 5              (legacy - see 3.2)
```

**No migration.** The engine supplies defaults for keys a league's stored config does not
have, so the live league's `scoring_config` is not touched and every existing league keeps
working the moment the code ships.

### 3.2 Two scoring paths, on purpose

`computeStarterPoints` reads the new fields when a stat line has any of them, and falls
back to the old `yards` / `tds` math when it does not.

**Why keep the old path at all, once the league is reset?** For one reason, and it is
enough: **`tests/parity.test.js` stays green.** It lifts the artifact's own scoring code and
replays it on combined-yards data. A hard cutover means that test has to be rewritten around
the rules change instead of surviving it - and `CLAUDE.md` is emphatic that parity is the
safety net, not a formality. Keeping a frozen legacy branch costs about six lines and keeps
the net intact.

Two things fall out for free:

- Any stat line still carrying the old shape - test fixtures, an imported backup, a league
  that was not reset - scores the way it was entered rather than being silently rescored.
- The cutover needs no flag and no date. The first line entered with the new boxes scores
  the new way.

The legacy branch is frozen and commented as historical. Nothing new ever writes rows that
reach it.

### 3.3 Stat entry

Per slot, showing only what applies:

| Slot | Boxes |
|---|---|
| QB | passing yards, passing TDs (+ rushing behind a "more" toggle) |
| RB | rushing yards, rushing TDs (+ receiving behind the toggle) |
| WR, TE | receiving yards, receiving TDs (+ rushing behind the toggle) |
| FLEX | whichever the player's position implies |
| Coach | Win / Tie / Loss, unchanged |

Two boxes visible per player, same as today. The extra categories are one click away, so a
running quarterback or a receiving back is enterable without making the common case
slower. The commissioner settings screen gains the six new rates beside the existing ones.

### 3.4 Migration required

**M1 - `stat_lines`:** add `pass_yards`, `rush_yards`, `rec_yards`, `pass_tds`,
`rush_tds`, `rec_tds`, plus matching `feed_*` mirrors for each. All nullable. The existing
`yards` / `tds` columns stay exactly as they are and are never rewritten.

Kyle applies it. Stage 1 cannot ship before it lands.

---

## 4. The pool rebuild

### 4.1 What a roster needs, which is what sizes the pool

`dealRosters` deals **12 players per team, six and six**:

```
starters:  Coach, QB, WR, RB, TE, FLEX (WR or RB, chosen at random per team)
bench:     Coach, QB, WR, RB, TE, FLEX (WR or RB, chosen at random per team)
```

So every team consumes **two** of Coach, QB and TE, **two** WRs and **two** RBs
guaranteed, plus two flex picks that each land on WR or RB at random - meaning a single
team can take up to four WRs or four RBs.

> **Confirmed with Scott, 2026-08-28.** Describing the roster from memory he listed the
> bench without a tight end, which would have made it 11 players rather than 12. Checked
> against `src/engine/deal.js` and confirmed with him: **the bench does include a TE**, so
> the roster is a clean six and six and every team needs two of every position.
>
> Correction to an earlier draft of this note: it is not undocumented. `RulesTab` already
> says "6 bench: one more of each (Coach, QB, WR, RB, TE), plus one more FLEX-eligible
> player", and derives the 2-TE cap from it. The prose was right and the recollection was
> not.

### 4.2 What the pool becomes

**Fixed counts, decided 2026-08-28: 32 QB, 64 RB, 64 WR, 32 TE, 32 head coaches = 224.**

That is each NFL team's starters - 1 QB, 2 RB, 2 WR, 1 TE, 1 head coach - which is where
the numbers come from, and it is what makes the pool clean to build. **There is no ranking
step and no top-150 list**, which removes the only part of this plan that needed a second
data source.

Taking them per team rather than as a global top-32 matters: the Coach slot's result is
read off that team's game, so the pool wants every NFL team represented rather than four
quarterbacks from the best four offences.

Against today's hand-typed 223 (32 coaches, 32 QB, 54 RB, 66 WR, 39 TE) it is one row
larger. What changes is that it is correct: no more "Derek Henry", no more players who have
moved teams, no more depth-chart staleness.

**What it supports:** two per team at Coach, QB and TE means 32 of each covers **16 teams**;
64 WR and 64 RB cover 16 teams even in the worst case where every flex in the league goes
the same way. Comfortable for a 12-team league, and `dealRosters` already refuses with a
readable error rather than dealing a broken week if the pool ever runs short.

`src/data/teamRows.js` **does not move.** `tests/parity.test.js` lifts it straight out of
the artifact and replays dealing against it; it is a fixture now, not the live pool.

### 4.3 Where "starter" comes from

nflverse publishes depth charts to GitHub releases as plain CSV, from the same project as
the stats and **with the same player ids** - which is the point. Depth-chart rank picks the
starters directly: QB1, RB1+RB2, WR1+WR2, TE1.

Backfield committees are the awkward case, which is why the pool takes two backs. Where the
chart is wrong - and it sometimes is - the commissioner overrides it by hand, and the
override survives the next refresh (section 4.5).

### 4.4 A refresh is per-league and commissioner-pressed

`player_pool` is a template that leagues copy from. A league's own `players` rows are where
"Marvin Harrison Jr is OUT" lives, and that is a statement about one league, never shared.

So the refresh writes into **the league's `players`**, triggered by the commissioner from
his own screen. Never automatic, never mid-week. The template is refreshed separately so
new leagues start current.

### 4.5 What a refresh may and may not do

- It **adds** players who are now starters and were not in the pool.
- It **retires** players who are no longer starters - marks them out of the dealt pool, does
  not delete them, and **does not touch anyone currently on a roster**. He finishes the
  week. Scott's answer: nothing until the next deal.
- It **never overwrites a status the commissioner set by hand.** Same provenance rule as
  stats: a manual edit wins, permanently, and the feed's opinion is recorded beside it.
- It reports what it changed, and what it could not resolve, rather than resolving quietly.

### 4.6 Migrations required

- **M2 - `periods.nfl_week`:** one nullable column, set at period creation and correctable
  by the commissioner. With the reset landing on NFL week 1 the mapping starts out correct
  rather than guessed - but the column is still needed, because a league starting late, a
  bye-week schedule, or next season all break the coincidence.
- **M3 - player identity:** the unique index on `external_ids` the schema already
  anticipates, plus ids on the `player_pool` template. It is the reconciliation described
  in `LIVE-DATA.md` 4.1 - proposes an id for each pool row, auto-accepts exact matches only,
  and makes a human confirm everything ambiguous. Fuzzy-matching a hand-typed pool
  unattended is the worst available outcome: a wrong number that looks right.

  **The reset removes the hard half of this.** The original plan needed a backfill joining a
  live league's `players` rows to the template on `legacy_id`, mid-season. With the league
  reset before week 1, `copy_player_pool_into` carries the ids across at creation and there
  is nothing to backfill. What remains is confirming the names once, against a pool that is
  being rebuilt from the feed anyway.
- **M4 (optional) - `players.depth_rank`:** records why a player is in the pool, so a
  disputed roster can be audited.

---

## 5. The feed

**Provider: nflverse.** Free, no key, no account, no terms exposure, and `fetch` against a
URL that returns a file - which keeps the promise in `CLAUDE.md` about dependencies staying
boring. It has all three halves this needs from one source: weekly player stats, schedule
results for the Coach slot, and depth charts plus injuries for the pool.

It publishes after games finish, which matches Scott's "ready by Sunday night".

### 5.1 Why not ESPN, given ESPN has the depth charts

Scott asked this on 2026-08-28, and it is a fair question with a tidier answer than
expected: **nflverse's depth charts are sourced from ESPN.** They are the same underlying
data, republished with nflverse's cleaning and - the part that matters - **nflverse's player
ids**, the same ids the weekly stats file uses.

That decides it. Going direct to ESPN would be slightly fresher and would hand us a
*second* identity space to reconcile: ESPN ids on the roster side, nflverse ids on the
stats side, and a join between them that has to be right for every player every week.
Section 4.6's reconciliation is already the most delicate migration in this plan; doing it
twice, against an undocumented endpoint that can change shape without notice, is a bad
trade for a few hours of freshness on a pool that is only ever refreshed between weeks.

**ESPN is recorded as the fallback, not the choice.** If nflverse's depth-chart release is
ever late or stops, the endpoint is
`sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/teams/{id}/depthcharts`
- no key, undocumented, unsupported. Worth knowing it exists; not worth building on.

The other providers surveyed in `LIVE-DATA.md` section 5 are unchanged by this: the paid
and account-based feeds (MySportsFeeds, SportsDataIO, and newer bundles like Highlightly)
buy live-during-the-game latency, which is the "live later" option Scott deferred. They do
not buy better depth charts.

**One engineering note found while checking:** the 2026 depth-chart CSV is ~44 MB
uncompressed (~9 MB gzipped). That is too big to fetch inside a request handler on every
call. The refresh fetches once, derives the 224-row pool, and stores the result - so the
big download happens when the commissioner presses the button, not when anyone loads a
page. The weekly stats file is far smaller and is fine either way.

**"Live later" is kept cheap** by putting the fetch behind one module (`server/feed/`) with
a documented shape - what a provider must return, not an abstraction layer. Swapping to a
live provider later is that one file plus an account, not a rewrite.

---

### 5.2 The fetch, measured (2026-08-29)

The plan said this was a measurement to make rather than a default to pick. Measured
against the live release:

| | |
|---|---|
| `stats_player_week_2025.csv` | **8,656,387 bytes** (8.66 MB) |
| Compression | **none on the wire** - the release blob store ignores `Accept-Encoding: gzip` |
| `accept-ranges` | **bytes** (206 confirmed on a 512 KB range) |
| Full download | 0.52 - 0.74 s, TTFB ~0.25 s |
| Rows | 19,423 for a full season, **ordered by week ascending**, week 1 through 22 |

So the depth chart's trick applies verbatim: `readLatestSnapshot` streams and aborts
when the key field changes; a stats read streams and aborts once `week` passes the one
wanted. Week 1 reads about 5% of the file and week 18 reads most of it - and most of it
is the 0.7 s measured above, inside a 10 s function budget. **No range requests, no
cache, no new infrastructure.** Ranges are the recorded fallback if nflverse ever
reorders the file.

`stats_player_week_2026.csv` is **still a 404**, as expected before any game is played,
so stage 5 is built and tested entirely against `server/feed/fixture/stats-week.csv`.
That is what the fixture was recorded for.


## 6. What must not change

Carried forward from `LIVE-DATA.md` section 7, and still true under these answers:

- **The commissioner stays the source of truth.** A feed proposes; a person finalizes. The
  `pre-deal -> dealt -> schemes-processed -> stats -> finalized` flow is untouched, and no
  week ever finalizes itself.
- **A manual entry is never overwritten.** Stats and player status both.
- **The engine does not learn about feeds.** A feed writes stat lines; `src/engine/` scores
  them. If `parity.test.js` ever fails, the feed has changed the game rather than fed it.
- **A feed writes into a league, never into another league's data.**
- **No new dependency.** `fetch`, a small CSV parse, and the existing Supabase client.

---

## 7. Stages

Ordered so the thing Scott most wants does not wait on the feed.

| # | What | Migration | Whose | Why here |
|---|---|---|---|---|
| **0** | Write the rules down - `docs/RULES.md`, and the rules screen | no | Scott | The answers above are the specification. Recording them is the deliverable OQ-4c was actually asking for. |
| **1** | **The scoring split.** Engine, settings, stat entry, rules screen. **No feed at all.** **DONE and LIVE** | M1 applied 2026-08-29 | Done | Playable the next week it ships, whatever happens to the feed. This is the change that alters the game. |
| **2** | Player identity reconciliation | M3 | **Mostly folded into stage 4** | The refresh attaches gsis/espn ids as it matches, and refuses to fuzzy-match a misspelling - it replaces the row instead. No separate pass to run. |
| **3** | `nfl_week` mapping. **DONE** (2026-08-29) | M2 applied | Done | `server/schedule.js` defaults it, `setNflWeek` corrects it, and every week created after a correction counts on from it. Kept OFF the blob path on purpose - see below. |
| **4** | **"Refresh pool" button** - current starters and head coaches from the live depth charts. **DONE and LIVE**, writes batched, template rebuilt | M2-M4 applied 2026-08-29 | Done | Delivers the live-roster half. Independent of stats. |
| **5** | **"Pull stats" button** - fills the boxes, manual lines protected. **DONE** (2026-08-29) | no | Done | The Sunday-night payoff. `server/stats.js` holds the rule, `pullStats` in operations.js writes it, and the button lives under Commissioner -> Enter Stats (it was the Live Stats screen until issue #30 moved it). See below. |
| **6** | Show the disagreement - "the feed says 91, you set 84", one-click revert | no | Scott | What makes stage 5 trustworthy. Should not lag far behind it. |
| **7** | **Scheduled polling.** Auto-pull on a cron, per-league opt-in. **DONE** (2026-09-05) | M5 | Done | Optional once 5 exists. Needed NO new credential - the scheduled function is a peer of api.mjs, not a client. See below. |

Stages 1 and 4 are each independently worth shipping. Neither needs the other.

### Stage 3, as built (2026-08-29)

`periods.nfl_week` had existed since the M2 migration and nothing but the demo seed had
ever written it, which is why a stats pull had no week to ask the feed for.

**The default counts forward from the mapping, not from the league's week number.** A
new period is mapped to one week later than the furthest-along mapping the season
already has; with nothing mapped yet it falls back to the league's own week number,
which is right for a league opening on opening weekend - the reset league's case - and
correctable when it is not. The consequence worth having: **correct one week and every
week after it follows.** Tell it league week 3 is NFL week 5 and week 4 becomes NFL week
6 on its own. That makes the control a once-a-season thing rather than a weekly chore.

A playoff round with nothing to count from stays **null** rather than guessing. "Playoff
round 1" is no evidence about which Sunday it lands on, and unmapped is a question the
commissioner can answer - a wrong number that looks right is not.

**It is deliberately not in the app-state blob, and that is the whole design.** The
artifact's state shape has no field for it, so putting `nfl_week` into `decompose.js`'s
period row would put it in the upsert's `SET` list on every ordinary blob write - deal,
process schemes, finalize, every pool edit - and any path where the blob did not carry
it would write null straight over a correction. That is exactly the bug `external_ids`
hit (`PHASE-4-HANDOFF.md`). It is a server-owned column in the same family as
`deal_seed` and `scheme_seed`: written by direct update from `operations.js`, never
derived from state. `tests/server.test.js` has a test named for it - *"SURVIVES AN
ORDINARY BLOB WRITE"* - which runs finalize, deal and process-schemes and then checks
the column, because "decompose never writes it" is a claim about code and that is a
check against a real PostgREST.

**Checked while building it:** a PostgREST upsert that OMITS a column preserves that
column - the `SET` list is built from the payload's keys. So the omission itself was
never the bug; the explicit `external_ids: {}` was. Probed against the local stack
rather than reasoned about.


### Stage 5, as built (2026-08-29)

**No migration.** The `feed_*` mirror columns went in with the scoring split on
2026-08-28 precisely so this stage would not need one, and they did.

**The feed grew two reads.** `fetchWeeklyStats` streams `stats_player_week_<season>.csv`
and stops once the week asked for has gone by - the measurement in 5.2 made flesh, and
it reports `stoppedEarly` so a file that gets reordered shows up as a symptom rather than
a slow afternoon. `fetchGameResults` reads `games.csv` for the Coach slot's Win/Tie/Loss.
Both are generalised onto one `readCsvRows`, which `readLatestSnapshot` now sits on too.

**Two identity spaces, deliberately.** A skill player is matched on `gsis` and never on
name - a wrong number that looks right is the worst outcome available here. A head coach
has no player id at all, so the Coach slot resolves BY TEAM, which also means a team that
changed coach mid-season still scores off the right game.

**An unplayed game is not a tie.** `games.csv` carries the whole schedule from the day it
is published with the score columns empty, and `Number("")` is 0 - so a blank read as a
number would have given every coach in the league a tie on Saturday morning. Absent from
the results map means "no result yet", and the pull reports it rather than writing it.

**A player the feed has nothing for is left blank, not zeroed.** Scott's answer is that a
starter who does not play scores zero, and a blank already scores zero - so writing an
explicit 0 would claim the feed reported one, which on a Sunday afternoon with half the
games still to kick off is a different statement. The report names those slots instead.

**Found while building it, both against real Postgres:**

- **A batched upsert is not a faster loop.** PostgREST builds ONE insert whose column
  list is the union of the batch, so the moment any row carried `id`, every new row
  beside it was sent an explicit NULL and `default gen_random_uuid()` never ran. It fails
  loudly rather than corrupting anything, but only once a pull has both new and existing
  lines - which is every pull after the first. `statWriteRows` mints the ids. Same shape
  as the bug `poolWriteRows` documents; second time on this project.
- **The demo league had no provider ids at all.** Its pool is the artifact's hand-typed
  one, so every skill slot came back "no provider id" and the button looked broken.
  `scripts/generate-seed.mjs` now attaches the fixture's ids by name, which is also what
  really happens: `player_pool` was rebuilt from the feed with ids on it, and
  `copy_player_pool_into` carries them into a new league. **A pull against a league whose
  pool has never been refreshed still reports exactly that, and says to refresh it.**
- **A pre-split line cannot be compared field by field.** The demo league's week 2 lines
  are the old combined shape, and comparing them column by column reported six
  disagreements ("you have passing yards blank, the feed says 295") about a line that was
  filled in perfectly well. Said once, on totals, instead. Only historical rows and the
  seed reach this.

**The fixture now records several weeks and the game results.** One week was not enough:
the demo league is dealt past week 1, so a pull asked for a week the recording did not
have. Weeks outside the recorded range still come back empty on purpose - that is what
the live feed does before a game is played, so the empty case is reachable locally.

### Stage 7, as built (2026-09-05)

**No new credential, and that is the design.** The obvious shape - a scheduled function
POSTing to `/api` with a shared secret - would have added a second way into the same
operation, a secret to store and rotate, and a route that writes to every league without
a session behind it. It is unnecessary: a Netlify scheduled function runs inside our own
deployment and reads the same `SUPABASE_SECRET_KEY` from the same environment, so
`netlify/functions/pull-stats-scheduled.mjs` is a PEER of `api.mjs` and calls
`server/operations.js` directly. `verifySession` is untouched; there is still exactly one
credential in this system, and it is an account.

`scheduledStatsPull` is deliberately NOT in the `ROUTES` table, with a comment there
saying why. Adding it would undo the whole argument above.

**One implementation, not two.** `runStatsPull` was split out of `pullStats` so the job
and the button run the same code - the same reason `src/engine/` is shared with the
server. What differs is only what surrounds it: the button answers to a commissioner's
session and returns 409s he reads on screen; the job answers to a cron and treats those
same conditions as reasons to skip a league. A second pull that drifted from the first
would be a very quiet way to write different numbers on a Monday than on a Sunday.

**Opt-in, defaulting to off** (`leagues.auto_pull_stats`, migration M5). A league must
never start receiving numbers from a job because we deployed one. It sits on `leagues`
beside `visibility` rather than on `seasons` beside `lineup_lock`, because it is an
operational setting rather than a game rule: it says who presses the button, not what
the button does.

**Every guard is a skip, not a failure** (`server/autoPull.js`). Not opted in, no current
week, wrong phase, rosters unlocked, week unmapped - each of those is the ordinary state
of a Tuesday afternoon. A run that skipped every league reports success, which is what
keeps a genuine failure visible instead of buried in weekly noise. The guards also run
BEFORE the feed is fetched, so most of the week the job makes no outbound request at all.

**Every three hours** (`netlify.toml`), which is neither of the two obvious schedules.
Chasing nflverse's six publish points would need six crons - Netlify allows one per
function - and would hardcode a publisher's timetable that is not a contract and has
already moved. Polling hourly would re-download an 8.6 MB file 168 times a week from a
free community-run source to save an hour of staleness on numbers nobody reads until the
morning. Three hours picks up each publish point within one cycle and is one line.

**Repeated pulls were already safe, which is what made this cheap.** `source: 'feed'` is
the pull's own and may be corrected by a later pull; `'manual'` is never touched. A
player the feed has nothing for is left blank rather than zeroed, and a coach whose game
has not finished gets no result. So Thursday's numbers are simply improved on Sunday and
again on Tuesday, and nothing about stage 5 had to change to allow it.

**What it deliberately does NOT do:** deal, process schemes, lock rosters, or finalize.
The commissioner-driven weekly flow in section 6 is untouched, and a pull still refuses
unless he has locked the rosters himself. See the open question about that in
`docs/OPEN-QUESTIONS.md` - under a `weekly` lineup lock the two locks do not yet meet.

`npm test`: **313 passed, 149 skipped, 26 files** with no local stack. The 6 new
database-backed tests in `tests/server.test.js` are in that skipped set and **have not
been run**; the 12 in `tests/autoPull.test.js` run anywhere and pass.

---

### The reset is the deadline

Scott is resetting the league before NFL week 1 and starting the real season on it. That
splits the table above into two halves with very different urgency:

**Wanted before the reset - stages 0, 1, 2 and 4.** The scoring split and a pool built from
real starters should both be true on the day the season starts. Landing them after it puts
the league back in exactly the mid-season position that section 2 just deleted, except in a
season that counts. Stage 2 (identity) comes along because the reset is what makes it easy -
ids get copied into the new league at creation instead of backfilled into a running one.

**Fine after the reset - stages 3, 5, 6 and 7.** The stats pull, the disagreement view and
status sync all improve a week that is already being played correctly. Week 1's numbers can
be typed in by hand exactly as they are today if the button is not ready; that is the whole
reason stage 1 was separated from the feed in the first place.

If the window is too short for all four, the order to cut from is 4, then 2 - a season can
open on the current hand-typed pool and have it replaced at a later refresh. **Stage 1 is
the one that should not slip**, because it is the only one that changes what a score means.

---

## 8. Still open

| # | Question | Whose |
|---|---|---|
| 1 | ~~**How much of this has to be in before the reset?**~~ **Settled 2026-08-29: stages 0-4 are all in and live, with a week to spare.** The reset can happen whenever Scott wants it. | Closed |
| 2 | Backfield committees: does the commissioner want a standing override list for teams whose depth chart is wrong, or is per-refresh correction enough? | Scott |
| 3 | A head coach fired mid-season: the refresh picks up the interim, nothing until the next deal. Consistent with the rostered-player answer - confirm it reads right. | Scott |
| 4 | The two scoring paths in 3.2 - now purely about keeping `parity.test.js` intact, since no live data will carry the old shape. Confirm that is worth six frozen lines. | Kyle |

**Closed since the first draft:**

- How a "top 150-200" filter should rank players - replaced on 2026-08-28 with fixed
  per-team starter counts (section 4.2). No ranking, no second data source.
- Whether to use ESPN rather than nflverse for depth charts - section 5.1. nflverse gets
  them from ESPN.
- Whether the bench includes a tight end - it does (section 4.1).
- Whether the league needs telling that scoring changed mid-season - **no.** The deployed
  league is test data and resets before NFL week 1, so the new rules are simply the rules
  from day one (section 2).

**Also still on the standing agenda, unrelated to this phase:** OQ-A (the sixth tiebreaker),
OQ-B (blocks validated server-side), OQ-E (stat writes while the roster is unlocked), and
the season archive.
