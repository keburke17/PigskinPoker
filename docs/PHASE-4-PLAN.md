# Phase 4 - Live stats and live rosters

The plan `docs/LIVE-DATA.md` was waiting on. Scott answered OQ-4c and OQ-4b on
**2026-08-28**, and the answers are larger than "wire a feed": the scoring rule itself
changes, and the hand-typed player pool is replaced by current NFL starters.

> **Stage 1 is BUILT as of 2026-08-28** - the scoring split, its settings, the stat entry
> screen and the rules screen, with migration M1 written and waiting for Kyle to apply.
> `npm test`: 269 passed, 1 skipped, 17 files, with the local stack up. Verified in the
> running app, including the database round-trip. What it changed is recorded in
> `docs/MIGRATION-NOTES.md`. **Everything below stage 1 in section 7 is still unbuilt.**

**The rest of this document is the plan.** Sections 4 through 6 describe work not started.

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
| **1** | **The scoring split.** Engine, settings, stat entry, rules screen. **No feed at all.** **DONE 2026-08-28** - awaiting M1 | M1 written, **not applied** | Built; Kyle applies M1 | Playable the next week it ships, whatever happens to the feed. This is the change that alters the game. |
| **2** | Player identity reconciliation | M3 | Kyle, with review | Everything downstream needs stable ids. Human in the loop, not fuzzy matching. |
| **3** | `nfl_week` mapping | M2 | Kyle | An hour, but nothing can be fetched without it. |
| **4** | **"Refresh pool" button** - current starters, injuries, depth chart | M4 optional | either | Delivers the live-roster half. Independent of stats. |
| **5** | **"Pull stats" button** - fills the boxes, manual lines protected | no | either | The Sunday-night payoff. |
| **6** | Show the disagreement - "the feed says 91, you set 84", one-click revert | no | Scott | What makes stage 5 trustworthy. Should not lag far behind it. |
| **7** | Scheduled polling, or a live provider | no, but new infra | **Kyle** | Optional once 5 exists. First piece that can fail silently at 3am. |

Stages 1 and 4 are each independently worth shipping. Neither needs the other.

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
| 1 | **How much of this has to be in before the reset?** Stage 1 is the one that should not slip. Whether stages 2 and 4 make the window is a scheduling call, not a design one - see section 7. | Scott + Kyle |
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
