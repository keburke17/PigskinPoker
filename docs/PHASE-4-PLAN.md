# Phase 4 - Live stats and live rosters

The plan `docs/LIVE-DATA.md` was waiting on. Scott answered OQ-4c and OQ-4b on
**2026-08-28**, and the answers are larger than "wire a feed": the scoring rule itself
changes, and the hand-typed player pool is replaced by current NFL starters.

**Nothing here is built yet. No code has changed.** This document is the plan.

---

## 1. What Scott decided

| # | Question | Answer |
|---|---|---|
| **OQ-4c** | What counts as "yards"? | **Split into three categories, each with its own rate.** Passing 1 point per 25 yards, rushing 1 per 10, receiving 1 per 10. All three customizable, exactly as `yardsPerPoint` is today. |
| **OQ-4c** | Touchdowns | **Split the same way.** Passing TD 4, rushing TD 6, receiving TD 6. All customizable. |
| **OQ-4c** | Return yards, two-point conversions, fumble-recovery TDs | **Out.** Only passing, rushing and receiving count, for both yards and TDs. |
| **OQ-4c** | A starter who does not play | **Zero.** The line reads 0 and he contributes 0. Same bad break as any manager who starts an inactive player. |
| **OQ-4c** | When it takes effect | **Next week, mid-season.** Finalized weeks keep the scores they were given. |
| **OQ-4b** | Is `TEAM_ROWS` curated or typed? | **Typed out of necessity - rebuild it from live rosters.** The pool becomes each team's current starters, refreshed so it tracks injuries and depth-chart moves. |
| - | Pool depth | **Per NFL team: 1 QB, 2 RB, 2 WR, 1 TE, 1 head coach.** No WR3s, no second tight ends. |
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

**Weeks already played do not move.** `weeklyResults` stores each week's raw score and
standings points as recorded, so finished weeks are frozen. The standings will be part
old-scoring, part new for the rest of this season. That is a real thing to tell the league
before the first week under the new rates, not after.

**Old stat lines cannot be converted.** Every `stat_lines` row already in the database
holds one combined `yards` number, and nothing records how much of it was passing. There
is no way to split them after the fact, which forces the design in section 3.2.

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

This is not hedging. It is forced by the data: a row recorded before 2026-08-28 has one
combined yards number that cannot be split, so the only honest way to score it is the way
it was scored when it was entered. The payoff is large:

- **`tests/parity.test.js` stays green.** It feeds legacy-shaped lines, so it takes the
  legacy path and still matches the artifact exactly. The safety net survives the rules
  change rather than being rewritten around it.
- Re-deriving an old week produces the number that is already on the board.
- The cutover is automatic. The first week entered with the new boxes scores the new way;
  nothing has to be flipped on a date.

The legacy branch is frozen and commented as historical. It only ever reads rows written
before the split.

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

### 4.1 What the pool becomes

Per NFL team: **1 QB, 2 RB, 2 WR, 1 TE, 1 head coach** = 224 rows.

Today's hand-typed pool is 223 (32 coaches, 32 QB, 54 RB, 66 WR, 39 TE), so the dealt pool
is the same size to within one player and dealing is unaffected. What changes is that it is
correct: no more "Derek Henry", no more players who have moved teams, no more depth-chart
staleness.

`src/data/teamRows.js` **does not move.** `tests/parity.test.js` lifts it straight out of
the artifact and replays dealing against it; it is a fixture now, not the live pool.

### 4.2 Where "starter" comes from

nflverse publishes weekly depth charts to GitHub releases as plain CSV, from the same
project as the stats, with the same player ids. Depth-chart rank picks the starters
directly: QB1, RB1+RB2, WR1+WR2, TE1.

Backfield committees are the awkward case, which is why the pool takes two backs. Where the
chart is wrong - and it sometimes is - the commissioner overrides it by hand, and the
override survives the next refresh (section 4.4).

**Open: how the "top 150-200" filter works.** nflverse publishes no fantasy ranking, and
adding a ranking provider means a second source and a second identity space. The clean
answer is to rank by season-to-date points **under this league's own scoring config** - the
pool then ranks players by Scott's rules rather than somebody else's. Needs his
confirmation; see section 8.

### 4.3 A refresh is per-league and commissioner-pressed

`player_pool` is a template that leagues copy from. A league's own `players` rows are where
"Marvin Harrison Jr is OUT" lives, and that is a statement about one league, never shared.

So the refresh writes into **the league's `players`**, triggered by the commissioner from
his own screen. Never automatic, never mid-week. The template is refreshed separately so
new leagues start current.

### 4.4 What a refresh may and may not do

- It **adds** players who are now starters and were not in the pool.
- It **retires** players who are no longer starters - marks them out of the dealt pool, does
  not delete them, and **does not touch anyone currently on a roster**. He finishes the
  week. Scott's answer: nothing until the next deal.
- It **never overwrites a status the commissioner set by hand.** Same provenance rule as
  stats: a manual edit wins, permanently, and the feed's opinion is recorded beside it.
- It reports what it changed, and what it could not resolve, rather than resolving quietly.

### 4.5 Migrations required

- **M2 - `periods.nfl_week`:** one nullable column. League week 1 is only NFL week 1 by
  coincidence, and nothing can be fetched without the mapping. Set at period creation,
  correctable by the commissioner.
- **M3 - player identity:** the unique index on `external_ids` the schema already
  anticipates, plus a one-off backfill joining the live league's `players` to the template
  on `legacy_id`. **This one touches the live season.** It is the reconciliation described
  in `LIVE-DATA.md` 4.1 - proposes an id for each pool row, auto-accepts exact matches
  only, and makes a human confirm everything ambiguous. Fuzzy-matching a hand-typed pool
  unattended is the worst available outcome: a wrong number that looks right.
- **M4 (optional) - `players.depth_rank`:** records why a player is in the pool, so a
  disputed roster can be audited.

---

## 5. The feed

**Provider: nflverse.** Free, no key, no account, no terms exposure, and `fetch` against a
URL that returns a file - which keeps the promise in `CLAUDE.md` about dependencies staying
boring. It has all three halves this needs from one source: weekly player stats, schedule
results for the Coach slot, and depth charts plus injuries for the pool.

It publishes after games finish, which matches Scott's "ready by Sunday night".

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
| **1** | **The scoring split.** Engine, settings, stat entry. **No feed at all.** | M1 | Scott builds, Kyle applies M1 | Playable the next week it ships, whatever happens to the feed. This is the change that alters the game. |
| **2** | Player identity reconciliation | M3 | Kyle, with review | Everything downstream needs stable ids. Human in the loop, not fuzzy matching. |
| **3** | `nfl_week` mapping | M2 | Kyle | An hour, but nothing can be fetched without it. |
| **4** | **"Refresh pool" button** - current starters, injuries, depth chart | M4 optional | either | Delivers the live-roster half. Independent of stats. |
| **5** | **"Pull stats" button** - fills the boxes, manual lines protected | no | either | The Sunday-night payoff. |
| **6** | Show the disagreement - "the feed says 91, you set 84", one-click revert | no | Scott | What makes stage 5 trustworthy. Should not lag far behind it. |
| **7** | Scheduled polling, or a live provider | no, but new infra | **Kyle** | Optional once 5 exists. First piece that can fail silently at 3am. |

Stages 1 and 4 are each independently worth shipping. Neither needs the other.

---

## 8. Still open

| # | Question | Whose |
|---|---|---|
| 1 | How the "top 150-200" filter ranks players. Recommendation: season-to-date points under this league's own scoring config - no second provider, no new identity space. | Scott |
| 2 | Does the league get told before the first week under the new rates? Recommended yes - standings become part old-scoring, part new, and that is better said out loud in week 1 than argued about in week 15. | Scott |
| 3 | Backfield committees: does the commissioner want a standing override list for teams whose depth chart is wrong, or is per-refresh correction enough? | Scott |
| 4 | A head coach fired mid-season: the refresh picks up the interim, nothing until the next deal. Consistent with the rostered-player answer - confirm it reads right. | Scott |
| 5 | The two scoring paths in 3.2 - confirm keeping the old math for old rows, rather than a hard cutover. | Scott / Kyle |

**Also still on the standing agenda, unrelated to this phase:** OQ-A (the sixth tiebreaker),
OQ-B (blocks validated server-side), OQ-E (stat writes while the roster is unlocked), and
the season archive.
