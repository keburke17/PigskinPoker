# Pre-live steps

The one-time cutover from "everything in the hosted database is test data" to "everything
in it is a season people are playing", and then what the first week actually looks like.

Written to be followed on the day, in order. Two people appear in it: **Kyle** runs the
commands that touch the hosted database, **Scott** does everything inside the app.

> **Before you start.** `npm run db:backup` and `npm run db:wipe` arrive with the branch
> that adds `scripts/backup-hosted.mjs` and `scripts/wipe-hosted.mjs`. If `npm run` does
> not list them, that branch is not merged yet and the rest of Part 1 has nothing to run.

---

## Part 0 - the one genuine blocker

```bash
npx supabase migration list --linked
```

`20260907000000_site_admins.sql` is dated the day the head-coach screen was built. **A
migration sitting on `main` is not a migration applied** - nothing runs them for you. If
it shows as local-only, the hosted database has no `site_admins` table, `/admin` fails,
and step 5 below is impossible.

```bash
npm run db:push
```

That applies whatever is missing and runs `verify:grants` afterwards, which is not
optional: hosted Supabase grants `ALL` on every newly created table to `anon`, the local
stack does not, and no unit test can see the difference. See `docs/DEPLOYMENT.md`.

---

## Part 1 - wipe, coaches, first league

| # | Who | Step | Why it is here and not somewhere else |
|---|---|---|---|
| 1 | Kyle | `npm run db:backup` | Three dumps into `backups/`. The free tier takes no snapshots for you, so this is the only backup that exists |
| 2 | Kyle | `npm run db:wipe -- --dry-run` | Shows every league, account and finalized week it would destroy. Change nothing yet |
| 3 | Kyle | `npm run db:wipe` | Asks you to type the project ref. A reflex `y` cannot confirm it |
| 4 | Scott | Sign in | The accounts were deleted, so this is a fresh magic link. `site_admins` is keyed on email, so he is still an admin |
| 5 | Scott | `/admin` - correct the 32 head coaches | The report will say "0 leagues updated". That is correct: there are no leagues yet |
| 6 | Scott | Create A League | Whoever presses it is the commissioner. This copies `player_pool`, corrected coaches included |
| 7 | Scott | Add the teams | |
| 8 | Scott | Commissioner -> Invite, one per manager | An account nobody invited is nobody. There is no join code any more |
| 9 | Scott | **Refresh Player Pool** | `pre-deal` only. Pulls the live depth chart *and* real injury status |
| 10 | Scott | Set the lineup lock and `auto_pull_stats` | Both have silent defaults - `gametime`, and auto-pull OFF |
| 11 | Kyle | `npm run db:backup` again | A clean baseline, before a single week is played |

### The two flags that are easy to get wrong

**`npm run db:wipe -- --dry-run`, with the `--`.** Without it npm swallows the flag as its
own and the script runs for real.

**Both credentials go on the command line**, so `.env.local` stays pointed at your local
stack:

```bash
SUPABASE_URL=https://YOUR_REF.supabase.co SUPABASE_SECRET_KEY=sb_secret_... npm run db:wipe -- --dry-run
```

### Why coaches before the league, and not after

Editing a coach in `/admin` writes the shared `player_pool` template **and** renames that
team's coach row in every league already playing. Do it before step 6 and there are no
live leagues, so it is one clean write per team and the new league is born correct.

Doing it after step 6 also works - that is exactly what the cross-league write exists for.
It is only noisier.

**Refresh Player Pool cannot undo Scott's coach work.** `planPoolRefresh` sets every Coach
row aside: "not matched, not retired, not counted", and `the feed does not get a say on
coaches`. That rule exists because the free coach data put John Harbaugh with the Giants -
Scott's decision on 2026-09-04, recorded as OQ-4d.

And coach names are cosmetic by design. The Coach card scores its **NFL team's** Win, Tie
or Loss, matched on `nfl_team`. No rule anywhere reads the name. Getting one wrong costs
nothing mechanically; it is worth fixing because Scott will see it.

---

## Part 2 - what week 1 actually looks like

The phases are `pre-deal -> dealt -> schemes-processed -> stats -> finalized`, and the
commissioner drives every transition. Nothing advances on its own.

### pre-deal - the commissioner deals

Each team gets twelve players: six starters - **Coach, QB, WR, RB, TE, FLEX** - and six on
the bench. Dealing also reads that week's kickoff times out of the schedule and stores
them, best effort, so a slow schedule file cannot fail a deal.

Confirm on screen that league week 1 is mapped to **NFL week 1** before dealing. It should
be automatic for a league opening on opening weekend; `setNflWeek` corrects it if not.

### dealt - the managers' window

Each manager may:

- **Set his lineup** - swap starters and bench freely, for any player not yet locked.
- **Submit one scheme**, and only one:

| Scheme | What happens |
|---|---|
| **Block** | Name one of your players. He cannot be stolen this week |
| **Steal** | Drop one of yours and name a position. You take a random *unprotected starter* at that position from another team. The victim gets a random free agent in the same slot |
| **Redraw** | Drop one of yours, take a random free agent at the same position |

Schemes are QB, WR, RB and TE only - **the Coach is never selectable**. A manager who does
nothing keeps what he was dealt, and pays no penalty for it.

> **The gotcha that will bite you.** A scheme can only be submitted while the phase is
> `dealt`, so **pressing Process Schemes closes the window.** Give the managers a stated
> deadline rather than pressing it once four of six are in.

### Process Schemes

Blocks resolve first and apply immediately. Steals and redraws then resolve in a **single
shuffled pass**, so a player freed by one action can flow into another - the order is
random each week, seeded so the week can be replayed. A steal that finds no unprotected
target is skipped and logged; the roster is unchanged.

The phase becomes `schemes-processed` and **the rosters lock automatically**. There is no
separate Lock Rosters step in the normal flow.

### schemes-processed - lineups are still live

Managers can keep swapping any player whose NFL team has not kicked off. This matters more
than it sounds: anyone who was stolen from has a free agent sitting in that slot and will
want to reshuffle.

Then the clock does the rest. Under `gametime` - the default - each player locks at his own
team's kickoff, so Thursday-night players lock on Thursday and everyone else at their own
kickoff. A manual lock always outranks the clock.

### Stats

Enter them by hand, or press Pull Stats. Both need the week mapped to an NFL week and the
rosters locked, and after Process Schemes both are already true.

nflverse publishes after each game window rather than continuously:

| Lands | Roughly (ET) | What arrives |
|---|---|---|
| post-TNF | Fri 12:30 AM | Thursday night |
| post-early | Sun 5:00 PM | the 1pm games |
| post-late | Sun 8:00 PM | the 4pm games |
| post-SNF | Mon 12:30 AM | Sunday night |
| post-MNF | Tue 12:30 AM | Monday night |
| daily | 5:00 AM | catch-up, and the NFL's own stat corrections |

Those are nflverse's documented intent, not a contract. With `auto_pull_stats` on, this
happens every three hours with nobody pressing anything.

### Finalize

Scores every roster, awards standings points, and writes the cumulative totals.

**Only finalize writes `cumulative`.** The projected column on the Scoreboard mid-week is
read-only and recomputed from the same three engine calls, so it can move; nothing is
decided until the week is finalized.

The next period then opens at `pre-deal`, mapped to NFL week 2.

---

## Things to keep an eye on

- **Flex scheduling moves Sunday games** as late as twelve days out, and a game that
  shifts to an earlier slot locks earlier than the league was told. Press Refresh Kickoffs
  when that happens.
- **Refresh Player Pool is `pre-deal` only.** Once a week is dealt the pool is fixed for
  that week - which is deliberate: a player who stops being a starter finishes his week and
  is simply absent from the next deal.
- **If something breaks live**, the fastest fix is Netlify's rollback to the previous
  deploy, not a hurried commit. That does not roll the database back; nothing does except a
  backup.
