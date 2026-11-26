# Every league on the clock, and an admin console - the plan

Written 2026-11-25 from Scott's decisions in one session, for Kyle and Scott to read
together before anything is built. **Nothing here is built yet.** The bug fix this grew
out of is PR #125 (`docs/INCIDENT-2026-11-24.md`); that PR stands on its own and should
merge first.

The decisions are Scott's and are recorded as OQ-41 in `docs/OPEN-QUESTIONS.md`. The
"what it needs" notes, and the parts marked **Kyle**, are where the hosting, the database
or the deploy are involved.

---

## Why

Over the last few weeks, in both live leagues: deals dealt twice, the emailed roster not
the one the game kept, and on 2026-11-24 a week finalized before it was dealt. PR #125
fixes the cause found so far. But Scott's goal is a public game next season - possibly
thousands of leagues nobody here commissions - and the current shape cannot get there:

- **One hourly job does every league, one after another, inside one Netlify scheduled
  function** (about 30 seconds before the platform stops it). A Tuesday for one league
  downloads the 8.6 MB schedule twice, the stats file and the depth charts, then writes.
  A handful of leagues can run it out of time; 10,000 cannot fit at all. A run cut off
  mid-step leaves a week half-written.
- **The same NFL files are downloaded again for every league.**
- **A step is several separate writes** (`persistBlob`, then `afterPersist`), so a step
  that stops halfway has no rollback.
- **Nobody is told when a league goes wrong.** Scott heard about Week 12 from his managers.
  In a league he does not commission he would never hear at all.
- **Commissioners hold the step buttons**, and a button pressed at the same moment as the
  clock was one of the two ways the Week 12 race could start.

## What Scott decided

### 1. Everything runs automatically, in every league

- Deal, process schemes, pull stats, refresh the pool and finalize all run on the clock,
  in **every** league, always. The three switches (`auto_process_schemes`,
  `auto_advance_week`, `auto_pull_stats`) stop being switches.
- **Commissioners lose** Deal, Process Schemes, Finalize, Pull Stats, Refresh Player Pool,
  and manual stat entry. That includes the dealer in the Weekly table and Last Digit's
  Deal Teams.
- **Commissioners keep** creating the league and its settings (below), invites, members,
  and Delete League. **Managers keep** naming their team, setting their lineup and picking
  their scheme.

### 2. The weekly clock (unchanged, written down in one place)

| Step | When (league's own time zone) |
|---|---|
| Finalize last week, deal this week | Tuesday 6am |
| Schemes process | Thursday 3am - **Wednesday 3am in a week with a Wednesday game** (OQ-40, built in PR #125) |
| Stats pull | every three hours while the week is open |
| Stat corrections to a finished week | until Thursday 3am - see 4 |

### 3. When a league starts - one rule for all three games

- **The commissioner picks a start week and a maximum number of teams when he creates the
  league.** Created before the season: the earliest is Week 1. Created during the season:
  **the earliest is the following week** - created in Week 2, the earliest is Week 3.
- **The league starts by itself** at that week's Tuesday 6am deal, **with whoever has
  joined by then.** Twelve allowed, ten joined: it starts with ten. Nobody presses
  "ready".
- **The commissioner can push the start week back, any time before it starts**, as many
  times as he likes - to give people longer to join, or for any reason of his own.
- **Season League:** joining closes at that first deal, as today (OQ-35).
- **Weekly table:** the start week is a hard start; after that the lobby works as it does
  now (OQ-39) - people join the line between hands, at most the set number a hand.
- **Last Digit:** starts at the start week with whoever has joined; teams are handed out
  at that moment. This **changes OQ-37**, which allowed a start week already played; the
  earliest becomes the following week, like the other two.

### 4. Stat corrections

- A finished week **keeps listening to the feed until Thursday 3am** (the same moment the
  next week's schemes lock). A correction in that window re-scores the week, re-ranks it,
  and moves standings points and the week win if the order changes - automatically.
- **Every correction is shown, not hidden**: e.g. "Stat correction: Player A, Week 7,
  10.0 -> 10.1 points. Team B moves from 2nd to 1st." In the activity feed, on the week's
  scoreboard, and on the standings, so nobody wonders why the table moved.
- After Thursday 3am the week is final for good.
- **The playoff bracket is still open - see "Waiting on Scott".**

### 5. Settings after the league has started

| Setting | After the start |
|---|---|
| League email on/off | Any time |
| Scoring values | Any time; **never re-scores a finished week** - applies going forward (see open question b) |
| Playoff start week | Set at creation; **locked once the season begins** |
| Lineup lock | **Always per player, at his own game's kickoff** - no choice (see open question d) |
| Start week | Can be pushed back until the league starts |
| Max teams | Before the start |

### 6. The admin console - Scott and Kyle only

A screen that sits on the homepage for site admins only (`site_admins`, as the head-coach
screen uses today):

- **Every league**, searchable by name, commissioner or ID - not only leagues they belong
  to. Each shows its game, current week and phase, and whether anything is wrong.
- **Open any league read-only**: its weeks, rosters, schemes, stats, standings, activity,
  and everything the clock did to it and when.
- **The step buttons, for one league at a time**: Deal, Process Schemes, Pull Stats,
  Refresh Pool, Finalize, and the repairs ("put back a skipped week", re-run a step that
  failed). Every press goes in that league's activity log with which admin pressed it.
- **The problem list**, fed by the checker in the build plan below, and an email to both
  admins when a league goes wrong.

## The build plan

In order. Each step is safe to ship on its own, and the order matters: switching every
league to automatic is what loads the clock the most, so the clock is made sturdy first.

1. **PR #125** - the Week 12 race, the deal race, `finalized_at`, the Wednesday rule.
   **Kyle:** merge after 3am ET Thursday Nov 26, before 6am ET Tuesday Dec 1. Run
   `scripts/repair-skipped-week.mjs` for Week 12 before that (it does not need the merge).
2. **Download each NFL file once per run** and share it across leagues. Small, no schema
   change.
3. **The checker.** Hourly, after the clock: scan every league for states that should be
   impossible - a week finalized that was never dealt; a week where every team scored 0; a
   week dealt twice; a league week out of step with the NFL week; a week past a deadline
   and not moved; a step left half-done. Email both admins with the league's name and ID.
   Needs a small table to remember what was already reported (**Kyle:** `db:push`).
4. **The admin console** (section 6). Server routes guarded by `site_admins`, the same
   pattern as `server/coaches.js`.
5. **One job per league.** The hourly function only decides which leagues are due and
   queues one job each; each job runs on its own, with its own time allowance, retry and
   record of success or failure. A slow or broken league cannot hold up the others.
   **Kyle - the main hosting decision:** Netlify background functions (15 minutes each),
   a Supabase queue (`pgmq`) with `pg_cron`, or another worker. Needs a jobs table and
   probably a plan check on both services.
6. **Each step all-or-nothing.** Deal, process schemes and finalize each become one
   Postgres transaction (a database function), so a step that stops halfway undoes itself
   and the next run starts clean. The biggest change in the list; **Kyle:** migration.
7. **Stat corrections** (section 4), on top of 5 and 6: a finished week re-scores until
   Thursday 3am, with the correction notices.
8. **Start weeks** (section 3) for all three games, and the settings rules (section 5).
9. **Switch every league to automatic and take the step buttons away from commissioners.**
   **Kyle:** a migration turning the three switches on for every existing league.
10. **Prove it at scale before next season**: a test that runs a whole simulated season
    for thousands of leagues against the local stack, including the bad cases - two runs
    at once, a run cut off halfway, an admin pressing a button at the same moment as the
    clock. The numbers decide whether step 5's choice is enough.

Dependencies stay boring (CLAUDE.md): nothing above needs a new npm package; a queue, if
chosen, is a Supabase or Netlify feature rather than a library.

## Scott's answers of 2026-11-26

- **The playoffs get a consolation bracket.** Teams that miss the playoffs are still dealt
  and play on for the final standings. **Consolation teams cannot steal from playoff
  teams; playoff teams can steal from consolation teams.** Stated on the Rules tab.
- **The final seeding settles at Thursday 3am**, at the scheme run: corrections land, a team
  moves between the brackets if they change who is in, then schemes run on the final
  seeding. Everyone is dealt either way, so a seeding change never needs a re-deal. The last
  regular-season week still finalizes Tuesday.
- **The Rules tab gets a Stat corrections section**: corrections count until the Thursday
  3am scheme run, and can change a finished week's scores, places and standings until then.
- **Fewer than two teams at the start week**: the start moves back a week by itself.
- **Lineups** lock at each player's own kickoff, in every league.
- **Last Digit**: the commissioner hand-picks teams or sets them to deal automatically;
  anyone without a team at the start gets a random one.

This adds a step to the build plan, between 7 and 8: **the consolation bracket and the
Thursday seeding.** It is a game-rules change (`src/engine/`, and `tests/parity.test.js`
records it).

## Still waiting on Scott

b. **A scoring change made while a week is being played** - say TDs go from 4 to 6 on a
   Friday: does that week count with 4 or with 6?
f. **The consolation bracket's shape**: an elimination bracket of its own (the winner
   finishes first among the non-playoff teams), or one table of points for those places?
   And do teams knocked out of the playoffs drop into it, or are they done?
