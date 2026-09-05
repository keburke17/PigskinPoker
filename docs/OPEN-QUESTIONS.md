# Open Questions

Decisions that are **yours**, not mine. Two kinds:

- **OQ-1 .. OQ-9** - things the artifact sandbox forced, which are now genuinely open for
  the first time. The code cannot tell us whether these were choices or workarounds.
- **OQ-A .. OQ-G** - places where the code and the written rules disagree, or where the
  behaviour is surprising. Per the ground rules I have **changed none of these**. They are
  written down and waiting on you.

Each has a recommendation so you have something to say yes or no to.

> **Answered 2026-08-17:** OQ-1 **yes, decompose** (with standard web conventions) /
> OQ-2 **yes, seasons** / OQ-4 **manual entry was the only option - treat it as a stopgap** /
> OQ-9 **yes, public once resolved** / OQ-A **deferred to the original designer**.
> OQ-B **provisionally yes, confirm with him**. OQ-8 **checked in Phase 1 - see below**.
> **OQ-10 (one league or many?) is newly open** and shapes Phase 3.
> The rest are still open and cost nothing to change.
>
> **Answered 2026-08-19, scoping Phase 3:** OQ-10 **yes, multi-league** - and league
> ownership lands *with* accounts, not after them. OQ-5 **both**: real accounts become the
> credential, and invite codes stay as *invitations* rather than logins. The commissioner
> code is confirmed a testing artefact and retires with league creation.
> **The season archive (OQ-2's other half) is held for the original designer**, not built
> this phase. See `docs/PHASE-3-PLAN.md`.
>
> **Answered 2026-08-28, scoping Phase 4 with Scott:** OQ-4c **yards and touchdowns split
> into passing / rushing / receiving**, each with its own customizable rate - and OQ-4b
> **the pool was typed out of necessity; rebuild it from live NFL starters**. Both are
> recorded in full below and planned in `docs/PHASE-4-PLAN.md`. **OQ-4c is a real rules
> change**, the first in the port; nothing already on the board moves.

---

## Part 1 - Constraints that are gone

### OQ-1. What are the entities, now that one blob is no longer forced? **[ANSWERED: decompose]**

A single JSON blob under one key was the only shape a key-value store allowed. It was never
a data-modeling decision.

**Recommendation: decompose into real tables.** Not for tidiness - because a whole-league
write is *what causes* the silent-clobbering bug (P1). Two people editing different things
should not be able to conflict at all, and under one blob they always do. Full reasoning in
`DATA-MODEL.md` section 1. This is the hardest decision to reverse later, which is why it
is the one I most want you to actually read.

### OQ-2. Should past seasons exist? **[ANSWERED: yes]**

Today `CommResetPanel` (line 2028) is the only way to start a new year and it destroys the
league: standings, results, activity log, all of it. Nothing archives. That is invisible in
the current design only because it was impossible.

**Recommendation: add a `seasons` table now**, and turn "Reset League" into "Archive this
season and start a new one." Last year's champion stays on the wall, and season-over-season
records become possible. Nearly free today; effectively unrecoverable once a second year has
been played on a season-less schema, because the first year is already gone by then.

### OQ-3. Should history be queryable rather than prose? **[assumed: yes]**

`activityLog` is strings and `weeklyResults` is a flat array. Also, `finalizeCurrentPeriod`
(line 792) **deletes every roster** at the end of each week - so there is currently no record
of who was on whose team in Week 4.

**Recommendation: keep rosters and schemes as historical rows, and give every event a
structured `payload` alongside its existing prose.** The prose is preserved verbatim so the
activity feed looks identical. What it buys: head-to-head records, best week ever, how a
player did across a season, who gets stolen from most. None of these are askable today.

### OQ-4. Is commissioner-typed stat entry a preference, or was it the only option? **[ANSWERED: it was the only option]**

There was no network, so typing stats in was the only possibility. The code cannot tell us
which it is.

**Answer: it was the only option, and should not continue except where it is needed or
convenient for testing before a feed exists.**

What this changed, immediately rather than in Phase 4: `stat_lines` now carries provenance
(`source`, plus `feed_*` columns holding what the feed last reported even after a manual
override). That is five nullable columns today versus a migration and a backfill over live
season data later. The commissioner still overrides anything, and manual entry remains the
only working path until a provider is wired - it just stops being the design centre.

Still open, and it drives Phase 4's shape: the hardcoded `TEAM_ROWS` pool (242-275). Was it
hand-typed because a roster could not be fetched, or because you want to curate exactly
which players are in the game? "Curated on purpose" and "typed out of necessity" imply very
different Phase 4s - the first keeps a hand-maintained list that a feed only enriches, the
second replaces it wholesale.

**OQ-4b answered 2026-08-28: typed out of necessity - rebuild it.** Scott wants the pool to
be the league's current starters and to track injuries and depth-chart moves: "I need this
game to have the current and most up to date rosters to combat injuries and depth chart
changes, however for roster dealing purposes, I only want relevant starters in the game."

Per NFL team that means **1 QB, 2 RB, 2 WR, 1 TE, 1 head coach** - 224 rows, against 223 in
the hand-typed pool today, so dealing is unaffected. Two backs because of 1A/1B backfields;
deliberately no WR3s and no second tight ends. The commissioner keeps every manual override
he has now, and a refresh never overwrites one. Refreshes are commissioner-pressed and never
mid-week: a player who stops being a starter finishes the week and is simply absent from the
next deal.

`src/data/teamRows.js` **does not move** - `tests/parity.test.js` replays dealing against it,
so it becomes a test fixture rather than the live pool. Full plan in `docs/PHASE-4-PLAN.md`.

### OQ-4c. What counts as "yards"? **[ANSWERED 2026-08-28: split into three categories]**

> **Scott's answer, 2026-08-28.** One yards box becomes three, and one touchdown value
> becomes three, each customizable exactly as `yardsPerPoint` is today:
>
> | | Rate | Touchdown |
> |---|---|---|
> | Passing | 1 point per **25** yards | **4** |
> | Rushing | 1 point per **10** yards | **6** |
> | Receiving | 1 point per **10** yards | **6** |
>
> - **Return yards, two-point conversions and fumble-recovery touchdowns do not count** -
>   neither the yards nor the scores.
> - **A starter who does not play scores zero**, not a blank. Same bad break as starting
>   any inactive player.
> - **It takes effect next week, mid-season.** Weeks already finalized keep the scores they
>   were given, so the rest of this season's standings are part old-scoring, part new.
>
> Why he chose it, in his words: under one rate for every position a quarterback "would
> make the position dominant and protected or stolen almost every time." A 300-yard, 3-TD
> passing day drops from 45 points to 24; a 120-yard, 1-TD receiver goes from 17 to 18.
>
> **This is a genuine rules change** - the first deliberate one since the port - and the
> whole build plan is `docs/PHASE-4-PLAN.md`. It does not renumber anything already played:
> old stat lines hold one combined yards figure that cannot be split after the fact, so they
> keep being scored the way they were entered, which is also what keeps
> `tests/parity.test.js` green.

The original question, kept for the reasoning:


Nowhere in the app - not in the rules screen, not in the code, not in the original
artifact - does anything say *which* yards go in the Yards box. The rules say "1 point per
10 yards" and stop. The engine takes one number and does not care where it came from.

That has never mattered, because you have been typing the numbers in, so whatever you type
*is* the rule. It stops working the moment a stats feed types them instead, because the
feed has to be told exactly what to look up.

Here is why it is not a small detail. One rate applies to every position:

```
Josh Allen    300 passing yards + 3 TDs  ->  30 + 15 = 45 points
Puka Nacua     90 receiving yards + 1 TD ->   9 +  5 = 14 points
```

If a quarterback's passing yards go in at face value, the QB slot decides almost every
week and the other five slots barely move the score. That might be exactly what you want -
you built a game where you are dealt a quarterback and it matters. Or you might have been
entering something smaller for quarterbacks all along. **We cannot tell from the code, and
guessing would silently change everybody's scores.**

**No recommendation on this one, because there is no right answer to recommend.** The
question is not "what should the rule be", it is "what have you been putting in the box
for a quarterback?" Whatever that is, that is the rule, and we write it down.

The same gap repeats a few times, and a feed needs all of it settled:

- Do passing touchdowns count the same as rushing and receiving ones?
- Does a quarterback's rushing yardage get added on top of his passing yardage?
- Do a running back's receiving yards count? A receiver's rushing yards?
- Kick and punt return yards - in or out?
- A starter who does not play at all: zero, or left blank?

Nothing changes until you answer, and answering changes nothing on its own - the numbers
already in the league stay exactly as they are. Full context, and everything the feed needs
besides this, is in `docs/LIVE-DATA.md`.

### OQ-5. Join codes, or real accounts? **[ANSWERED: both - accounts authenticate, codes invite]**

No auth primitives existed in the sandbox, so join codes were the only option.

**Answer: real accounts, with the codes kept for what they are actually good at.** Multi-
league forces this: today the code *is* the identity, which cannot express "commissioner of
one league, manager in another".

So the code stops being a credential and becomes an invitation - you sign in as yourself,
redeem a code once, and a `league_members` row is minted. Sharing a code then stops being
account sharing, and rotating one stops locking anybody out. The social flow you liked -
paste a code into the group chat - is unchanged.

Nothing moves for the existing league until each person chooses: both credentials are
accepted, and code-as-login is switched off only at a season boundary. Full model in
`docs/PHASE-3-PLAN.md`.

> **Update, 2026-08-20 - the gradual half did not happen, and did not need to.** Every
> deployed league is test data due to be wiped, so there was no population of
> code-holders to migrate and no season boundary to wait for. Join codes are **deleted**,
> along with the `sessions` table and the login rate limiter. The answer above stands
> exactly as written - accounts authenticate, a code invites - it just arrived directly
> rather than through a cutover. See `docs/AUTH.md`.

### OQ-6. Do you want to be able to notify people? *(out of scope this pass)*

There was no email, no push, nothing. So "rosters are dealt - submit your scheme before
Sunday" could not exist. For a commissioner chasing 12 managers, this is plausibly the
single biggest quality-of-life feature in the app.

**Recommendation: out of scope now, but say if you want it**, because it slightly affects
whether Phase 3 collects email addresses. Collecting them later is a chore; collecting them
while building the members table is free.

### OQ-7. Backup/restore is now a convenience, not a lifeline. **[assumed: keep]**

The JSON export existed because storage was not trustworthy. With Postgres and real backups
it is no longer load-bearing.

**Recommendation: keep it** - it is still useful, and it is how your league's existing
history migrates over in Phase 5. But it should stop constraining the design of anything
else, and restore will validate its input properly (P9) rather than trusting the file.

### OQ-8. Phone check. **[DONE in Phase 1 - one finding for you]**

Measured at 375x812 with the demo league loaded, not assumed:

- **No horizontal page overflow** - `scrollWidth` equals the viewport exactly.
- **Stat entry wraps properly** - the yards/TDs boxes drop to their own line instead of
  squeezing, and the nav row scrolls sideways as intended.
- **Every interactive control is below the 44px minimum touch target** - all 114 of them,
  from 28px (header buttons) through 33px (nav) to 37px (stat inputs).

The layout holds up. The touch targets are the finding: usable, but fiddly for people
checking scores one-thumbed on a Sunday. It is a CSS-only fix (padding plus `min-height`)
but it changes the proportions of every screen, so it is a design call rather than a port
call. **Want me to raise the touch targets, or leave the look exactly as he designed it?**

### OQ-9. Should resolved schemes become public? **[ANSWERED: yes, once resolved]**

You asked for more detail before deciding, so here is what I checked in the code.

The rule is *"Schemes are never shown to other managers - only the resulting roster"*
(line 1770), and the artifact enforces it by **deleting** schemes after processing
(line 655). The question was whether keeping them, readable once resolved, leaks anything.

**It does not - because the activity log already publishes all of it, in prose.** Every
scheme type writes an event naming the acting team:

| Scheme | Already public today? | Activity-log text |
|---|---|---|
| Block | **Yes** | "Team A blocked Josh Allen (QB) from being stolen this week." |
| Steal (success) | **Yes** | "Team B stole QB X from Team C (dropped Y). Team C received Z..." |
| Steal (no target) | **Yes** | "Team B tried to steal a QB but no eligible target was found..." |
| Redraw | **Yes** | "Team D redrew Player X (WR) for Player Y (free agent)." |
| No Action | No event | - |

So only `noaction` is unlogged, and it is **already inferable by elimination**: every team
that acted is named in the log, so the teams absent from a week's scheme events are exactly
the ones that did nothing.

Two genuine wrinkles, which is why this was worth checking rather than assuming:

1. **A silently skipped scheme looks identical to No Action.** If a scheme's player has
   moved by resolution time, `processSchemes` skips it and logs nothing (line 590). So
   today's inference is *slightly* ambiguous, and publishing schemes would remove that
   ambiguity - a small but real new disclosure. I have added a `schemes.outcome` column
   recording `applied / skipped / no-victim / no-replacement`, which makes the history
   honest instead of merely more exposed.
2. **`submitted_at` is genuinely new.** It is stored on every scheme (line 1337) but
   **never displayed anywhere in the app** - I checked every use. Publishing it would newly
   reveal who submitted early and who submitted late, which is the one thing here with any
   social charge.

**Decision, and what I built: schemes are readable once `resolved_at` is set, but
`submitted_at` is withheld** via a column-level grant alongside the row policy. Secrecy
during the week is untouched - an unresolved scheme is invisible to everyone, so nobody can
counter-scheme. Afterwards you get the OQ-3 history features (head-to-head, who gets stolen
from most, block success rates) while disclosing nothing the league cannot already read off
the activity feed.

If you would rather have the simpler story, option (c) - delete on resolve, exactly as today
- is still available at the cost of those history features. Say so and I will change it;
it is one policy and one column.

#### The mid-week half, answered 2026-08-26

OQ-9 settled what happens to a scheme *after* it resolves. It never asked what the
**commissioner** may see *before* that, and the answer had been decided by accident: the
`resolved_at` gate hides an unresolved scheme from every browser read, his included, so his
Weeks panel counted only the schemes he submitted himself and reported 0 for everyone
else's. He could still process them - that runs server-side - so the screen and the button
disagreed all week.

**Scott's decision: the commissioner may see WHO has submitted, and not WHAT they chose.**
The count and the pending-teams list are his to see; the type, the position and the player
stay secret until the schemes resolve, exactly as they do for everyone else. He is the
referee, not a player, and knowing the moves in advance is not part of the job.

Built as `schemeStatus` in `server/operations.js` - commissioner-only, returns a list of
team ids and nothing else. Deliberately NOT a widening of the RLS policy: no migration, and
the browser's read of `schemes` is exactly as narrow as it was.

**Still open, and found while building it:** every write response returns a server-built
view assembled with the secret key, so a manager who submits a scheme currently receives
*every other team's pending scheme* - type, player and `submitted_at`, the one column the
schema deliberately withholds from browsers - in the reply. The UI never draws it, but it
is in the payload. Confirmed against the running app on 2026-08-26. That contradicts the
rule this whole question is about and wants fixing in `server/`; it is not a schema change.

---

### OQ-10. One league, or many? **[ANSWERED: many - and ownership lands with accounts]**

The Artifact stored everything under a single `window.storage` key, so "one league" was
never a decision - it was the only thing a key-value store could express. That constraint
is gone, and it is worth deciding deliberately rather than by default.

**The database is already multi-league.** `leagues` is an ordinary table with a UUID key
and nothing limiting it to one row; `league_secrets.league_id` is the *primary key*, so a
commissioner code is per-league rather than global; and 11 foreign keys already scope
teams, players, seasons and sessions to a league. Ten leagues could exist tomorrow with
no migration.

What is single-league is the **application**:

*(The table below describes the state BEFORE Phase 3d. All four gaps are closed:
`/l/<id>` selects a league, the app creates them, the creator is the commissioner, and
every read policy is league-scoped. `scripts/bootstrap-league.mjs` no longer exists.)*

| Gap | Where |
|---|---|
| No league selection | The adapter loads "the only league", or matches `VITE_LEAGUE_NAME` |
| No league creation | `scripts/bootstrap-league.mjs` is a CLI script an operator runs |
| No commissioner claim | The code is set out-of-band by whoever runs that script |
| **Reads are not league-scoped** | Every read policy is `using (true)` |

That last row is the one that matters. With one league it is correct and intentional -
league data is public to anyone holding the link. With several leagues sharing a
database, League A's members could read League B's rosters and standings straight off the
API, and the app-level picker would make it *look* separated while the policies were not.
Multi-league therefore requires a real RLS change (`using (league_id = ...)`), not just a
dropdown.

**Recommendation: stay single-league for now, and if you want many, build it WITH Phase
3's real accounts rather than before them.**

Today "commissioner" means *whoever knows a code* - a league has no owner. That is
exactly why `bootstrap-league.mjs` sets the code up front instead of letting the first
visitor claim it: with no identity, an unclaimed league on a public URL is a land-grab.

With accounts, that inverts cleanly - **whoever creates a league becomes its
commissioner** - and one change delivers the signup flow, the creation flow, and the fix
for the land-grab together. Building self-serve league creation first means solving "who
owns this league" twice, and throwing the first answer away.

**The decision needed now is only this:** is multi-league on the roadmap at all? If yes,
league ownership should land *with* accounts in Phase 3 rather than be retrofitted
afterwards. If it is a "one league forever" project, Phase 3 gets simpler and
`VITE_LEAGUE_NAME` can go away entirely.

Worth noting the current arrangement costs nothing either way: one Netlify site plus one
Supabase project plus one league is the simplest and safest setup for your friend's
league, and nothing in it blocks the multi-league path later.

---

### OQ-11. When do lineups lock? **[ANSWERED 2026-09-05: it is a league option, defaulting to today's behaviour]**

Another constraint that has just stopped existing. The artifact had no schedule and no
clock it could trust, so "locked once his game starts" could only ever mean *the
commissioner presses Lock on that player*. The rules screen has described the rule since
day one (legacy line 1786: "right up until that player's game begins"); nothing has ever
enforced it except somebody sitting with the app open on a Sunday afternoon.

Now that the feed carries the NFL schedule, the honest question is which rule the league
wants - and the two answers are genuinely different games:

| | What it feels like to play |
|---|---|
| **`gametime`** | Keep tinkering all Sunday, using anyone who has not kicked off. Rewards watching the inactives at 11:30. |
| **`weekly`** | Thursday night is the deadline. What you have then is what plays, injuries included. |

**Answer: build both, per league, defaulting to `gametime`.** So no existing league's
rules move - `gametime` IS what they are already playing, only now enforced by the clock
instead of by hand - and a commissioner who wants the Thursday deadline chooses it on
the Weeks screen.

What that changed, 2026-09-05:

- `seasons.lineup_lock` holds the choice; `periods.kickoffs` holds this week's times,
  read from nflverse's `games.csv` (`gameday` + `gametime`, Eastern, converted properly -
  a hardcoded offset would lock a December league an hour late and a September one four
  hours early).
- The rule is `src/engine/lineupLock.js`, and the server enforces it in `swapLineupSlot`
  rather than only greying out a select box.
- **The commissioner's manual Lock still wins**, and is still there for late scratches.
  Nothing about the weekly flow is automated away: he deals, he processes, he finalizes.
- The times are read when a week is dealt and re-readable on demand, because flex
  scheduling moves Sunday games.

**Still his to decide, and deliberately not decided here: which one his own league
plays.** It is a per-league setting a commissioner changes in two clicks, and switching
mid-season is legitimate - it just wants saying out loud in the group chat first, because
a manager who thinks he has until Sunday finds out otherwise by losing a week.

---

### OQ-12. Should the clock be allowed to open the stats window? **[FOR SCOTT]**

Raised 2026-09-05 while building the scheduled stats pull. Nothing is broken; two
features simply do not meet yet, and joining them is a rules decision rather than a
tidy-up.

There are **two different locks** in the league and they have confusingly similar names:

| | What it stops | Who fires it |
|---|---|---|
| the lineup lock | a manager changing his lineup | the clock, per the league's policy (OQ-11) |
| `roster_locked` | anyone writing stats into the week | the commissioner, pressing "Lock Rosters" |

The second is what a stats pull - by hand or scheduled - refuses without, and for a good
reason: stats are keyed by SLOT, so numbers that arrive while a lineup can still move
would land on whoever occupies that slot afterwards, with nothing on screen to say so.

**Where they fail to meet.** In a league playing the `weekly` lineup lock, every lineup
freezes automatically at Thursday's kickoff - and then the automatic stats pull still
does nothing all weekend, because nobody pressed Lock Rosters. "Set it and forget it" is
only half true. The commissioner still has one button to remember, and it is the one
that is easiest to forget precisely because everything else stopped needing him.

**The question:** when a league's own lineup lock has already fired - every lineup frozen
by the clock, nothing left that can move - should that be enough to let stats be written,
or should pressing Lock Rosters stay a deliberate act?

- **Keep it deliberate.** One human decision before numbers enter a week that ends in
  standings. The cost is a button on a Thursday.
- **Let the clock do it** when the league plays `weekly` and the first kickoff has
  passed. The safety reason for the guard is genuinely satisfied - under `weekly` no
  lineup can move once it fires - and the commissioner keeps the manual lock for
  everything else.

**Not decided here, and deliberately not built either way.** This is the boundary
`CLAUDE.md` protects: the commissioner-driven weekly flow is his, and a clock that starts
writing stats into a week without him is a change to it, however reasonable the argument.
The scheduler shipped respecting `roster_locked` exactly as it stands, and moving to the
second option later is a small change.

It only bites a league playing `weekly`. Under `gametime` - the default - the two locks
are answering different questions anyway.

---

## Part 2 - Code that disagrees with the rules

I have not changed any of these.

### OQ-A. The sixth tiebreaker never applies, and ties are broken by team creation order instead. **[DEFERRED - for the original designer]**

The most concrete thing I found. `RulesTab` (line 1784) documents six tiebreakers:

> Standings Points -> Week Wins -> Coach Wins -> Total TDs -> Total Yards -> Best single-player score in a week

`rankTeamsWithTiebreak` builds a six-element `tb` array (line 740) but the comparator loops
`for (let i = 0; i < 5; i++)` (line 687) - it compares indices 0 through 4 only. **Best
single-player score is never used to break a tie.**

It gets worse than "the rule is ignored," which is why I am flagging it rather than just
noting it. The *rank grouping* three lines later compares all six:

```js
const same = prev.rawScore === cur.rawScore && prev.tb.every((v, idx) => v === cur.tb[idx]);
```

So two teams level on the first five tiebreakers but differing on best-player points are
**sorted arbitrarily** (the comparator returns 0, so the stable sort keeps input order) and
then **given different ranks** - and therefore different standings points. Input order is
team-creation order. So in that situation the team that was added to the league first wins
the tiebreak, permanently and invisibly.

Rare - it needs an exact tie across score plus five cumulative stats - but it is a real
standings-points difference when it happens, and it is the kind of thing that surfaces as an
argument in Week 15.

**Decision: held for a future change made with the original designer.** It is his rule set
and it is a live league, so it is his call, not ours - and it is a one-character fix plus a
test whenever he wants it.

Deferring a known defect needs a plan or the next person silently "fixes" it, so:

- The engine keeps the current behaviour, moved verbatim.
- A Phase 1 test **asserts the current behaviour**, named
  `documents current behaviour: 6th tiebreaker is not applied (see OQ-A)`. A test that just
  passed quietly would read as endorsement; this one reads as a flag.
- A second, `skip`ped test encodes the documented six-tiebreaker behaviour. When he decides:
  change one character, unskip one test, delete the other.
- `CLAUDE.md` lists it under known deviations, so his Claude does not correct it by reflex.

Worth raising with him directly rather than letting him find it here: it is rare, but when
it fires it silently moves standings points, and the beneficiary is whichever team was
created first.

**Addendum, 2026-09-04 - "created first" is now actually true.** That last sentence was
describing an intent, not a guarantee. Input order is `state.teams` order, and the teams
query carried no `ORDER BY` (`src/storage/supabase.js`), so it was whatever PostgREST
happened to return and was not promised to be stable between two reads of the same league.
Two screenshots on issue #29 showed different teams first. An OQ-A tie was therefore being
awarded to an *arbitrary* team, not to the earliest one.

The query now orders by `created_at`, then `id`. **This does not touch OQ-A** - the loop
bound is unchanged and the skipped test is still skipped - it only makes the documented
tiebreak deterministic instead of database-dependent. If a tie of this kind ever fired
before now, the winner may not have been the team this section says it was.

**Also 2026-09-04:** the live scoreboard added for issues #29 and #30 ranks the week in
progress with `rankTeamsWithTiebreak`, so OQ-A is now visible on a screen people look at
mid-week rather than only in the finalized table. That was the point of routing the
projection through the same function finalize uses - a dashboard that ranked its own way
could show an order the week would not actually award. **The loop bound does not get
"fixed" to make the scoreboard look right.**

### OQ-B. Blocks are not validated engine-side. **[PROVISIONAL: yes - confirm with the original designer]**

`SchemeForm` (line 1295) only offers your own **starters** when the scheme type is `block`.
`processSchemes` (line 565) does not re-check: it adds whatever `playerId` it is given to
`protectedIds`. In the artifact that is harmless, since the only way to submit is the form.

It stops being harmless when writes move server-side, because a crafted request could block
*another team's* player, or a bench player. The server has to enforce what the form
currently enforces.

**Provisional answer: yes - Block protects one of your own starters.** The server will
validate exactly that, which preserves today's real behaviour (the form already allows
nothing else). Flagged as a **final confirmation item for the original designer**, since it
is his rule: the code has never enforced it, so the only evidence of intent is the form.

Nothing depends on this before Phase 3, and if he says otherwise it is a one-line change to
the validator - not a schema change.

### OQ-C. Weekly ties are broken by season-to-date standing.

In `finalizeCurrentPeriod` (line 740) the `tb` array is the team's **cumulative** totals
*before* this week is added. So when two teams tie on raw score in a given week, the tie goes
to whoever is already ahead in the season - the rich get richer.

This one is consistent with how `RulesTab` describes it, so I think it is deliberate. Noting
it because it is a design choice worth being sure about rather than an accident.
**Recommendation: leave as-is.** Confirm.

### OQ-D. The Coach can be your "best player."

`bestThisPeriod` (line 735) considers all six starters including the Coach, so a Coach win
(2 pts by default) can be recorded as your best single-player performance - and given
default scoring, in a low-scoring week it sometimes will be. Elsewhere the rules treat the
Coach as a special case ("Coaches can never be stolen, redrawn, or blocked").
**Recommendation: leave as-is unless you meant best *player*, excluding the Coach.**

### OQ-E. Stats stay with the slot, not the player.

`statsEntry` is keyed `[teamId][slot]` (line 415). If a lineup swap happened after stats were
entered, the numbers would stay attached to the slot and silently apply to whoever now
occupies it. In practice `rosterLocked` is set during the stats phase, so this is nearly
unreachable today.

My schema keys `stat_lines` the same way for behavioural fidelity, but also records
`player_id` at entry time so per-player history works. **Recommendation: keep slot-keyed,
and additionally have the server reject stat writes while the roster is unlocked**, which
closes the gap without changing anything you would notice.

**[IMPLEMENTED PROVISIONALLY IN PHASE 3a - still yours to confirm.]** `setStatLine` now
returns 409 if the roster is unlocked. The slot-keyed rule itself is untouched; only the
window in which it can misattribute points is closed. The rosters are already locked
throughout the stats phase in normal play, so this rejects only requests the weekly flow
cannot produce - nobody following it will ever see the message. Same footing as OQ-B: if
you want it the other way, it is a few lines in `server/operations.js`, not a schema
change.

### OQ-F. Locks are per-player today, per-slot in my schema.

`lockedPlayerIds` (line 414) is keyed by player id for the whole period; I put `locked` on
the roster slot. Equivalent in practice, since a player occupies exactly one slot at a time,
and simpler to enforce. Flagging it as a deliberate, behaviour-preserving change rather than
letting you discover it later. **Recommendation: proceed.** No action needed unless you see
a case I have missed.

> **Since 2026-09-05 (OQ-11), that column is only half the answer.** `roster_slots.locked`
> is now specifically the MANUAL lock - the one the commissioner presses. The other half
> is computed from the league's lineup-lock policy and this week's kickoff times, and is
> never stored, because a lock that fires at one o'clock is a fact about the clock rather
> than something to write down. Anything asking "can this player be moved?" asks
> `isPlayerLocked()`; the manual lock still wins over the schedule.

### OQ-G. The scoreboard-first layout. **[BUILT 2026-09-04 - three parts to confirm or send back]**

Issues #29 and #30 said the same thing from two ends: through the whole week the app is
actually being played, nothing on League Home, My Team or Weekly Results answered "how is
the league doing", and the running scoreboard that already existed was the third sub-tab of
Rosters, underneath the commissioner's stat-entry wall.

That is presentation, not rules - no engine behaviour changed and `parity.test.js` is
untouched - so it was built rather than deferred. But three of the calls inside it are
Scott's to redirect, and each is deliberately cheap to reverse:

1. **A bare league link now opens the Scoreboard, not the standings.** `/l/<id>` used to
   mean League Home. It means the week in progress now, and the standings are
   `/l/<id>/home`. Nothing breaks - every deep link that names its tab is unaffected - but
   an existing bookmark to a bare league URL opens somewhere different. **Reverse:** set
   `DEFAULT_TAB` back to `"home"` in `src/routing/index.js`. One line, one test.

2. **The live table shows a projected Std Pts column.** It says what the week would award
   if it finalized right now, and it is computed by the same three engine calls finalize
   makes, so it cannot disagree with the real thing. Two consequences worth saying out
   loud: it is a projection and moves as stats arrive, and because it ranks through
   `rankTeamsWithTiebreak` it puts **OQ-A** on a screen people read mid-week. **Reverse:**
   pass `showProjection={false}` in `src/components/scoreboard.jsx`.

3. **Rosters collapsed.** Each team is one line - name and total - and opens on a tap; your
   own opens by itself. It was six full cards of twelve players each, which is the
   scrolling both issues complained about. **Reverse:** default `open` to `true` in
   `TeamRosterCard`.

Also moved: the commissioner's stat entry left the Rosters hub for the Commissioner tab,
where it sits with Deal and Process Schemes and opens by default while a week is live. Lock
Rosters, Pull Stats and Finalize Week went with it and are one tap in, not two.

### OQ-H. First-run guidance. **[BUILT 2026-09-04 - four calls to confirm or send back]**

Issues #24, #25, #26 and #27 are one complaint from four angles: the app never says what
to do next. A new commissioner lands on an empty standings table with ten flat sub-tabs; a
new manager lands on everybody else's zeroes; nothing states the weekly cycle; and pressing
Submit Scheme appears to do nothing because the confirmation is several screens above the
button.

All of it is presentation - nothing touched `src/engine/`, and `parity.test.js` is
untouched - so it was built rather than deferred. Four of the calls inside it are Scott's:

1. **There is a seventh nav pill.** Help sits beside Rules rather than merging into it,
   because Rules reads out the league's live scoring config and is reference, while Help is
   a walkthrough. The cost is real and was warned about in the NAV comment in `src/App.jsx`:
   the nav wraps rather than clips, and a commissioner at 375px can now reach a third row of
   pills - the point at which that comment says it should be a menu. **Reverse:** drop
   `help` from `NAV` in `src/App.jsx` and render `HelpTab` as a sub-tab of Rules; the route
   can stay, so links keep working.

2. **A welcome card interrupts on first entry.** Once per person per league, dismissible,
   with a 44px close button and a tap-anywhere backdrop. "Seen it" is in `localStorage`
   (`src/storage/firstRun.js`), which means it re-shows on a new device. The alternative is
   a column on `league_members`, which is a migration against a live season - the trade is
   written up in that file. **Reverse:** stop rendering `WelcomeOverlay` in `src/App.jsx`;
   the persistent `NextStepNote` underneath it stands on its own.

3. **Redeeming an invite now lands a manager on My Team, not League Home.** Standings for a
   league you joined ten seconds ago are not your business; your roster is. **Reverse:** one
   line in `onRedeemInvite`.

4. **The submitted scheme is rendered twice on My Team** - once where the artifact put it,
   at the top, and once immediately above the submit button, which is what issue #27 asked
   for. The button also has a busy state and a short "Scheme submitted" acknowledgement.
   **Reverse:** drop the second `SchemeSummary` in `src/components/scheme.jsx`.

**One thing worth Scott's eye more than the four above.** Writing the help text surfaced
that the app has **no automatic roster freeze at all** - no Thursday cutoff, no kickoff
timer, no scheme deadline on a clock. Both locks are buttons the commissioner presses:
"Lock Rosters for the Weekend" closes scheme submission, and a per-player lock (pressed as
each real game kicks off) is what freezes an individual starter. The Rules tab already
describes this correctly under "Lineup Lock & Injury Swaps", and every new sentence was
written to match it - `tests/guidance.test.js` carries a regression guard that fails if any
of the copy starts promising a weekday or a kickoff deadline.

That is a description of the app, not a complaint about it. But it means **the real scheme
deadline is whenever the commissioner happens to press Process Schemes**, which is a social
arrangement rather than a rule, and a league that grows past its founders will probably want
it to be a stated time. If Scott wants a deadline to actually exist in the product, that is
a rules change and a new question - it is not one of these four.

### OQ-I. A manager cannot see the scheme they submitted. **[FOUND 2026-09-04 - not fixed]**

Found while building the guidance for #27, and it makes that issue worse than it was
filed. #27 assumed the confirmation existed and was merely several screens above the
button. It does not exist at all: **`state.schemes` is always empty in a browser.**

Two conditions that cannot both be true:

- `read_resolved_schemes` (`supabase/migrations/20260818050000_invites_and_league_scoping.sql:160`)
  lets a browser select a scheme only where **`resolved_at is not null`**.
- `hydrate.js:203` builds `state.schemes` from exactly the rows where
  **`resolved_at == null`**.

So the intersection is empty, every time. Verified on the local stack: an unresolved
scheme inserted directly for a team's current period is invisible to that team's own
signed-in browser after a reload.

What that costs, all of it pre-existing:

- `SchemeSummary` never renders - the "Your submitted scheme for Week N" line is dead code
  in practice, on both of the places it is mounted.
- The submit button never becomes "Update Scheme", and the form never re-populates from
  what was submitted (`src/components/scheme.jsx`, the `useEffect`).
- A manager has no way at all to check what they picked, which is the actual complaint
  underneath #27.
- The new guidance inherits it: the next-step line goes on saying "submit a scheme" to
  somebody who already did.

**Not fixed here, deliberately.** The fix is a migration - let a member read their OWN
unresolved scheme while still hiding everyone else's - and that is `db:push` against a
live season, which is Kyle's to run. It also brushes against **OQ-9**, whose comment in
that migration says an unresolved scheme "must not leak mid-week even to the league it
belongs to". Reading the intent, that is aimed at other managers, and your own scheme is
not a leak to you - but it is the designer's information-visibility call to confirm, not
a drive-by change to an RLS policy.

The alternative, no migration: have the server return the submitting team's own scheme
from `submitScheme` and hold it in local state. Cheaper, and it survives a reload not at
all, which is most of the value.

---

## What is still open

Nothing blocks Phase 1. Remaining, in the order they are needed:

| Question | Needed before | Why it can wait |
|---|---|---|
| **OQ-B** blocks validated server-side | **Done (Phase 2c)** | Enforced in `submitScheme`. Provisionally yes; still awaiting the designer's final confirmation. |
| **OQ-E** reject stat writes while unlocked | **Done (Phase 3a)** | Enforced in `setStatLine`, and in `pullStats` since 2026-08-29 for the same reason - a pull is stat entry done quickly, and a lineup change after one would move the numbers to a different player. Same conversation as OQ-B; it is his rule to confirm. |
| **OQ-6** notifications | Phase 3c | Now nearly free: magic-link sign-in needs the same SMTP provider notifications would. |
| **league visibility** (new, from OQ-10) | Phase 3d | Members-only or link-public, per league. Recommended: a setting, defaulting to members-only, with the existing league set public so nothing changes for it. |
| **OQ-4c** what counts as "yards"? | **Done - answered 2026-08-28** | Split into passing / rushing / receiving, each customizable. A rules change; built in `docs/PHASE-4-PLAN.md` stage 1. |
| **OQ-4b** is `TEAM_ROWS` curated or typed? | **Done - answered 2026-08-28** | Typed out of necessity. The pool is rebuilt from live starters; `teamRows.js` becomes a test fixture. |
| **OQ-3** history depth | Phase 2 | Schema already preserves it; this is about what we surface. |
| **OQ-C / OQ-D / OQ-E** rules quirks | Anytime | All preserved as-is; each is a small, reversible behaviour question. |
| **OQ-F** per-slot vs. per-player locks | Anytime | Behaviour-preserving; noted so it is not discovered later. |
| **OQ-H** first-run guidance | **Built 2026-09-04** | Presentation only. Four reversible calls for Scott, and one finding: nothing in the app freezes on a clock. |
| **OQ-I** you cannot see your own scheme | **Soon** | A real bug, not a preference. Needs a migration (Kyle) and a nod on OQ-9's intent (Scott). |

**OQ-B is provisionally answered** (yes, Block protects your own starters) and is on the
list to confirm with the original designer, alongside **OQ-A**. Those two are the standing
agenda for that conversation.

**OQ-10 is answered: many.** What that changed is recorded in `docs/PHASE-3-PLAN.md` -
accounts, an `invites` table replacing `team_secrets`, league-scoped read policies, and a
landing page with three doors (sign in / redeem a code / create a league).

**The standing agenda for the designer is now OQ-A, OQ-B and OQ-E**, plus the season
archive, which is held for him rather than built - and **OQ-G**, which is built and needs
confirming rather than deciding.

**OQ-4c and OQ-4b were answered on 2026-08-28 and no longer block anything.** Yards and
touchdowns split into passing / rushing / receiving at customizable rates, and the player
pool is rebuilt from current NFL starters. Both are recorded above and planned in
`docs/PHASE-4-PLAN.md`, which supersedes `docs/LIVE-DATA.md` as the thing to build from;
`LIVE-DATA.md` remains the provider survey and the reasoning behind the choice.

Five smaller questions came out of answering those two, and are listed in
`PHASE-4-PLAN.md` section 8 - the biggest is how the "top 150-200" filter should rank
players.

**OQ-11 was answered on 2026-09-05: lineup lock timing is a league option**, `gametime`
(each player at his own kickoff) or `weekly` (everyone at the week's first one), and it
defaults to `gametime` so no league's rules moved. What is left for the designer is not a
question about the code - it is choosing which one his own league plays.

**OQ-12 was raised on 2026-09-05 and is still open.** The stats pull now runs on a
schedule, and a league playing the `weekly` lineup lock freezes every lineup on the clock
- but writing stats still waits on the commissioner pressing Lock Rosters, which is a
separate, manual lock. Whether the clock should be allowed to open the stats window is
his call, and nothing was built either way.
