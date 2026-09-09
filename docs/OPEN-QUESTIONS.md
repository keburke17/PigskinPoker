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
>
> **Answered 2026-09-06 by Scott - the standing agenda, cleared.** OQ-A **yes, the sixth
> tiebreaker applies**, built the same day: the first change to how standings are decided
> since the port. OQ-B **confirmed** - Block protects one of your own players from being
> stolen, nobody else's. OQ-C **confirmed** - weekly ties use the same tiebreakers as the
> standings, which is what the code already does. OQ-D **confirmed** - the Coach is part of
> your roster, so he can be your best player. OQ-E **confirmed** - keep the guard. The
> **season archive is tabled**, not declined: he likes it, and wants the smaller cleanups
> done first. Two Phase 4 questions closed, and **one new request opened - the pool should
> refresh itself at the weekly rollover** rather than waiting to be pressed. See
> `docs/PHASE-4-PLAN.md` section 8.
>
> **Answered 2026-09-07 - OQ-14, the weekly cycle on a clock.** Scott asked for rosters
> dealt automatically on Tuesday morning and schemes processed at 3am Thursday "just how
> waivers would process in real fantasy football". Built as **two per-league switches,
> both defaulting to off**, so nothing moves until a commissioner turns it on. This is
> the boundary `CLAUDE.md` protects, so it is recorded as a decision rather than as a
> feature: the two things it changes about playing in the league - a real scheme deadline
> and an unattended finalize - are written out in full below, along with two defaults
> chosen rather than asked for. **The honest gap is that nobody is notified** (OQ-6).
>
> **Answered 2026-09-07 by Scott - two rules changes, both his own.** **OQ-15: scoring
> carries decimals.** A yard now counts for the fraction of a point it is worth, so 58
> rushing yards is 5.8 rather than 5, and the split categories stop throwing away every
> partial ten twice over. **OQ-16: the playoffs start themselves** at an NFL week the
> league nominates, and the Start Playoffs button is gone - it could not survive the
> weekly cycle running on a clock, which would deal week 16 rosters to teams that had
> already missed the cut. Both are recorded in full below. Finished weeks do not move:
> decimals apply to the split scoring path only, and every line recorded before the
> 2026-08-28 split still scores exactly as it did.

> **Answered 2026-09-08 by Kyle - OQ-13, the standings ladder stops being a setting.**
> "Per discussion - should just stick with a simple reverse ladder for reg season scoring;
> if X teams in league, winner gets X points and 2nd place getting one less and so forth."
> That is the third option below, taken part-way: the ladder is now fixed in the engine at
> `teamCount .. 1` and the Standings Cfg tab is gone, but `standingsPointsOverride` stays
> in the state shape and in the database, unread. Nothing about any existing league moves,
> because no league ever changed the default. In its place the Scoring tab opens with a
> plain-English explanation of how a week becomes standings points.

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

**Half delivered, and the other half is no longer a rename (2026-09-08).** The `seasons`
table shipped. The archive did not, and **Reset League was removed on 2026-09-08** - see
OQ-18's follow-up - so there is nothing left to rename. That is deliberate rather than a
loss: Reset was the wrong shape for this job, because the whole point of an archive is that
last year survives and Reset threw it away. `archiveSeasonAndStartNew` is now a new
operation to be designed on its own terms, not an existing button wearing a better label.

**It also now has a date.** Until it exists, a commissioner whose season ends has no way to
start the next one except Delete and recreate - losing every player-pool correction (a new
league takes a fresh `copy_player_pool_into` from a template that is stale by design),
scoring, standings point values, playoff config, the lineup-lock and auto-cycle switches,
and every membership, so all his managers need re-inviting. Nobody is exposed to that yet:
the 2026 season began in September, so the first league to finish one lands around January
2027. That is the deadline.

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

### OQ-4d. Who owns the head coaches, and how are injuries tracked? **[ANSWERED 2026-09-04]**

Raised by Scott after running the first real refreshes against his local league: "the
rosters when refreshed are very much not up to date... many coaches still wrong as well."

**What was actually wrong, checked against his database rather than assumed.** The refresh
was working. It had written 224 correct rows from a depth-chart snapshot stamped that
morning, and retired 30 stale hand-typed ones. Three separate things made it look broken:

1. **The pool screen listed retired players beside live ones**, with the position count
   including them - the WR card read 75 when 64 were dealable - and eight of the retired
   rows were one letter from a correct row sitting next to it ("Derek Henry" beside
   "Derrick Henry", "Kalil Shakir" beside "Khalil Shakir"). Presentation, not data:
   retiring means OUT rather than deletion on purpose, because a deleted player would
   break the rosters and results that reference him. **Fixed** - the pool screen now
   counts and lists only what can be dealt, and the rest are behind a toggle.
2. **Genuine starters outside a 2-deep pool.** Matthew Golden, Ricky Pearsall and Jakobi
   Meyers are all WR3s; Tyler Higbee is a TE2. Correctly excluded by OQ-4b's own depth,
   but they read as missing. **No change** - that is the answered rule working.
3. **The coaches were wrong, and not because of our code.** nflverse's `games.csv` listed,
   for all 17 games of 2026: John Harbaugh with the **Giants**, Jesse Minter at Baltimore,
   Mike McCarthy at Pittsburgh, Todd Monken at Cleveland, Robert Saleh at Tennessee - and
   it spelled Klint Kubiak **"Klint Kubliak"**. Internally consistent, so nothing was
   scrambling on our end; the app was faithfully reporting a badly-maintained file.

> **Scott's answer, 2026-09-04: head coaches are the commissioner's.** The refresh does not
> add, rename, retire or restatus a single Coach row - enforced by position in
> `server/pool.js`, which is deliberately stronger than the `source = 'manual'` rule,
> because the coach rows already in his league were written by an earlier refresh and would
> otherwise count as the feed's own work to revise. `buildPool` produces 192 rows now
> rather than 224; a league still holds 224 players, and the feed is responsible for 192.
> Pool rows gained an **Edit** control in the same change, because a list nobody may edit
> is not a list anybody maintains.
>
> `coachesFromGames` stays exported and tested. The results half of that file is still the
> plan for scoring the Coach slot's Win/Tie/Loss; only its coach columns are distrusted.

**And injuries, which was the question underneath the question.** Scott: "Jayden Higgins
of the Houston Texans is supposed to be their WR2, but he is out for the season... does he
just fall into the IR category? is it pulling that type of live information?"

It was not. The depth-chart extract carries twelve columns and none is injury status - the
"IR" ESPN shows on its own site is dropped before we see it. **Rank was doing the work
by accident**: ESPN demotes an injured player, and it had Higgins at Houston's **WR7**, so
he fell out of a 2-deep pool on his own. Verified at the time: all 192 skill players then
in the pool matched a roster row and **none was on reserve**.

> **Scott's answer, 2026-09-04: pull it properly, and skip the injured man.** Roster status
> is read from nflverse's weekly roster file, where `RES` (reserve/injured) maps to **IR**
> and anything else off the active roster maps to OUT. When a listed starter is hurt, the
> **next healthy player takes the slot** - so every NFL team always contributes a full
> 1 QB / 2 RB / 2 WR / 1 TE and the dealable pool does not thin out every time somebody
> gets hurt. The injured player is still added, carrying IR, because a pool that simply
> omits him cannot explain where he went.
>
> **The injury pull is allowed to fail on its own.** That file is ~940KB per week, reached
> 15.4MB by the end of 2025, is not in week order and does not compress on the wire, so
> there is no prefix to stop after and no tail to range-request. A failure there leaves the
> refresh to finish on depth charts alone and says so on screen - losing it costs a day or
> two of lag, and treating it as fatal would cost the refresh entirely.
>
> It also does not take the highest week in the file: that file runs to week 22, and week
> 22 is the two teams left in the Super Bowl. Taking it would leave thirty teams with no
> roster row and mark every one of their starters OUT.

**Not a rules change.** Dealing has always drawn only from `status === "Active"`, and
`tests/parity.test.js` is green - this changes who is in the pool, not how the game plays.

#### OQ-4d part two: retired is not OUT **[ANSWERED 2026-09-04, same conversation]**

Scott, after the first refresh on the live site: "the players that it took out of the game
for misspellings or whatever reason, it has them listed as OUT... so when a team manager
looks at the free agent pool and clicks on the OUT tab, they will see james cook there.
whilst the real updated roster james cook III could be listed on someones starting roster.
those players that are replaced, probably should just be removed in a pool that only the
commissioner can see."

The first fix that day only cleaned up the COMMISSIONER's pool screen. `FreeAgentsTab` -
what every manager sees - gives OUT, IR and BYE a tab each and listed every player with
that status, so retiring somebody by setting him OUT put him in front of the whole league.

> **Scott's answer: retired players belong to the commissioner alone.** `players.retired`
> is now a column of its own, and the two ideas are kept apart:
>
> - **OUT / IR / BYE** are football statements about a player who is IN the pool. Managers
>   see them, and should - that is what the tabs are for.
> - **retired** means a refresh dropped him: no longer a listed starter, or a misspelling
>   the feed replaced. Hidden from managers entirely; shown to the commissioner under
>   "Retired" on his pool screen, with **Restore** to put one back.
>
> **Still not deleted.** `legacyOf` resolves a missing player to null, so deleting one
> would silently blank a starter slot in a week that has already been played.
>
> **And not derived from `status` + `status_source` either**, though that pair identifies
> exactly these rows today and is what the migration backfills on. The moment the
> commissioner touched a retired player's status dropdown, `decompose.js` would record
> `status_source = 'manual'` and the player would quietly reappear for everybody.

**One loose end, worth checking.** Scott's own example was "James Cook" retired beside an
active "James Cook III" - but `normalizeName` strips suffixes, so those two match and the
feed's spelling simply wins. They should never both be in a pool. The only way they can is
if the pool already held the same man twice; both cases are now asserted in
`tests/pool.test.js`. If he is genuinely seeing both on the live site, that is a second
bug and this fix hides the symptom rather than curing it.

#### OQ-4e: the coaches are wrong in every league at once **[ANSWERED 2026-09-07]**

Three days after OQ-4d, Scott again: the coaches are still off. They were. OQ-4d settled
*who owns* a head coach - not the feed - and stopped there, so nothing ever corrected the
ones already written. Issue #40 lays out the state: `player_pool`, the template every new
league is copied from, still holds the six names Scott rejected (Jesse Minter at Baltimore,
John Harbaugh at the **Giants**, "Klint Kubliak"), `copy_player_pool_into` hands them to
every league created since 2026-08-29, and the only correction path was the commissioner's
Edit button - seven edits, in every league separately, by every commissioner separately.

**Scott's answer, 2026-09-07, and it is two answers.**

> **First: the Coach card is the TEAM.** It scores its NFL team's result - Win, Tie or Loss
> - and the coach's name has never been part of that arithmetic. The name is on the card
> because it is more fun than reading the team twice. So a wrong coach is a cosmetic
> annoyance and cannot cost anybody a point.
>
> This was already how the code worked and is now pinned as a promise rather than left as
> a property: `feedValuesFor` matches the Coach slot by `nfl_team` and never by name
> (`server/stats.js`), `computeStarterPoints` reads only `result`, and
> `tests/coaches.test.js` asserts a rename changes nothing - including against a real
> database, in `tests/server.test.js`. **If a rule ever starts reading a coach's name,
> everything below becomes unsafe.**
>
> **Second: the 32 names are ONE list, kept by the game's admins.** Not the feed, and not
> the commissioner either. A head coach is one fact about the NFL - wrong in every league
> at once - so correcting him should be one edit, not one edit per league.

**What that changed.** A role above the league, which this schema had never had: a
`site_admins` table (Scott and Kyle, by email) and a `/admin` screen listing the 32 teams.
Editing one there writes the template AND renames that team's live coach row in every
league already playing. That crosses a boundary the app otherwise never crosses - one
league's `players` rows are its own, and `tests/server.test.js` asserts it - and the first
answer above is the entire reason it is allowed to: nothing scores off the name.

**What it deliberately will not do.** Add or delete a coach; touch a retired coach row;
or pick between two live coach rows for one team when a league has both. Each is reported
on screen instead. And a commissioner may still rename a coach in his own league - it just
stops being the last word.

**A loose end, unchanged by this.** `player_pool` never got the 09-06 retired-duplicates
backfill, so it still carries both spellings of the Raiders coach where a live league has
one retired. The screen shows the retired count per team and leaves them alone; tidying
them is a separate, smaller decision.

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

### OQ-7. Backup/restore is now a convenience, not a lifeline. **[ANSWERED 2026-09-07: removed]**

The JSON export existed because storage was not trustworthy. With Postgres and real backups
it is no longer load-bearing.

The standing recommendation was to keep it, on two grounds: it was still useful, and it was
how the existing league's history would migrate over in Phase 5.

**ANSWERED 2026-09-07 by Kyle: take it out.** Neither ground survived. Phase 5 never
happened and is not going to - the Artifact league was a worked example, not real history
(see the Backup import row in CLAUDE.md), so there is nothing to carry across. And the
export was never the safety net the tab claimed it was: it serialized the browser's
`state`, which does not contain pending schemes, past weeks' rosters, or past weeks'
stat lines. Restoring one would not have brought them back, because they were never in the
file. That was recorded as finding 4 in `docs/MIGRATION-NOTES.md` and as item 4 in
`docs/FOR-THE-DESIGNER.md`; removing the tab closes both.

**What this means for the league.** The commissioner has no in-app download and no in-app
restore. The remaining backup is `npm run db:backup`, which is Kyle's - it dumps the
hosted schema, every public row and the auth schema, and it is strictly more complete than
the JSON ever was. The cost is that a commissioner can no longer take or restore one
himself, with no tools and nobody's help. **Scott: if you want that back, say so** - the
honest version would be a server-side export that reads the database rather than the
browser's view of it, and it is a different feature from the one that was removed.

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

**Update 2026-09-07: most of this arrived from a different direction, and the question is
still open.** OQ-14 put the SCHEME step on a clock, and `processSchemes` sets
`rosterLocked = true` as it always has (matching the artifact, legacy line 2305). So in a
league that has switched that on, the stats window opens at 3am Thursday without anyone
pressing Lock Rosters, and the scheduled pull becomes eligible on its own - the "set it
and forget it" gap this question describes is closed in practice for those leagues.

What is still genuinely open is the narrower question as asked: whether the LINEUP lock
firing should be enough on its own, for a league that has automated nothing else. Nothing
was built for that, and a commissioner who leaves both OQ-14 switches off is in exactly
the position described above.

It only bites a league playing `weekly`. Under `gametime` - the default - the two locks
are answering different questions anyway.

### OQ-13. Is "Standings Point Values by Rank" a rule anyone wants? **[ANSWERED 2026-09-08: no - the reverse ladder is fixed]**

Raised 2026-09-07 by Kyle, who opened the panel, could not work out what it was for, and
still could not once it was explained. Nothing is broken. The question is whether a knob
you built in the artifact is one you actually want on the board.

**What it does.** It sets what each finishing position is paid in standings points. First
number to whoever wins the week, second to the runner-up, and so on down. Left alone it is
team count down to 1 - in a six-team league, `6, 5, 4, 3, 2, 1`.

It is read in exactly one place, `currentStandingsPointsArray` (`src/engine/scoring.js:93`),
and used by two: `finalizeCurrentPeriod`, which adds the number to a team's season total,
and `projectCurrentPeriod`, which shows the same number mid-week on the Scoreboard. The
Rules tab prints the ladder as a quick-reference tile.

**Why it is not nothing.** Standings points are the first thing the standings sort on, and
the playoff bracket is seeded off them, so this ladder decides how much a big week is
worth. `6, 5, 4, 3, 2, 1` is nearly flat: winning a week by 80 points earns one more point
than finishing second by two. Something top-heavy like `100, 50, 20, 5, 2, 1` makes a
single dominant week close to decisive, and makes a bad week survivable in a way the flat
ladder does not. That is a genuine feel decision about the season - it is just one nobody
has ever made, because the default has never been changed.

**The question:** is that a lever you want a commissioner to have, or was it something you
put in because it was easy to put in?

- **Keep it.** It costs nothing while unused - `null` means "derive from team count" - and
  it is the only way to change the shape of a season without touching per-play scoring.
- **Hide it.** Take the button out of the commissioner nav and leave the engine field
  where it is. The nav is eleven buttons wrapping onto two rows inside a sticky header
  that already eats 217px of an 812px phone (**OQ-8**), and this is the least-used of the
  eleven, sitting next to Enter Stats. Nothing about the game changes; the ladder stays at
  the default it has always been at.
- **Remove it properly.** Every league is permanently on `teamCount .. 1`. This is the
  expensive one: the field is part of the artifact's state shape, so `tests/parity.test.js`
  compares it field by field, `tests/roundtrip.test.js` asserts it survives a save, and
  `seasons.standings_points_override` would need a forward-only migration to drop. Worth
  doing only if the answer is a firm no.

**My recommendation: hide it.** It keeps the option in the engine for the day you want a
top-heavy season, and it takes a button off a crowded phone nav today.

**One thing to fix if it stays**, and it argues for hiding rather than keeping. **A saved
ladder silently stops applying if it is shorter than the team count.** The override is
honoured only when it has at least as many entries as there are teams
(`src/engine/scoring.js:94`), and is discarded whole otherwise - back to `teamCount .. 1`,
with nothing on any screen saying so. That bites twice:

- Save `6, 5, 4, 3, 2, 1` for six teams, add a seventh, and the league quietly returns to
  the default ladder mid-season.
- In a league with no teams yet the panel shows `1`, because it falls back to
  `state.teams.length || 1`. Pressing Save there stores `[1]`, which is then ignored
  forever - harmless, but it is a setting that accepts a value and does nothing with it.
  Kyle's screenshot is this case.

The guard is doing something sensible - a ladder with no entry for last place would leave
somebody unpaid - it just does it silently, and it is the only setting in the app that can
be saved and then disregarded.

**Nothing has been changed.** This is the boundary `CLAUDE.md` protects - the panel is
yours, it came over from the artifact working exactly as it does now, and taking a rule off
the board is still a rules change. Tracked as issue #48.

**ANSWERED 2026-09-08 by Kyle, on issue #48, after discussing it with Scott:** *"should
just stick with a simple reverse ladder for reg season scoring; if X teams in league,
winner gets X points and 2nd place getting one less and so forth."*

So the answer is the third option, done the cheap half of the way:

- **The ladder is fixed in the engine.** `currentStandingsPointsArray` returns
  `standingsPointsArray(teamCount)` and nothing else. Six teams pay `6, 5, 4, 3, 2, 1`;
  add a seventh and it pays `7, 6, 5, 4, 3, 2, 1` from that week on. The silent-discard
  bug above is gone with it - there is no longer anything that can be saved and then
  disregarded.
- **`standingsPointsOverride` stays.** It is still in `createInitialState`, still in
  `decompose`/`hydrate`, still in `seasons.standings_points_override`. Removing it means a
  parity edit, a roundtrip edit and a forward-only migration for a column that costs
  nothing, and leaving it means the day a top-heavy season sounds fun the reinstatement is
  one line. `tests/finalize.test.js` and `tests/live.test.js` now assert it is IGNORED,
  which is the guard against it quietly coming back to life.
- **The Standings Cfg tab is gone**, and the Scoring tab opens with "How Scoring Works" -
  what scores, at what rate, and then the ladder, stated rather than typed. That is the
  half of the recommendation about the crowded phone nav (**OQ-8**): the commissioner nav
  is nine buttons now rather than ten.

**No league's rules moved.** The default was never changed anywhere, so every league was
already on the reverse ladder; a league that had saved an override would come back to it
silently, which is why the tests pin that case rather than deleting it.

**Still Scott's if he wants it back.** Taking a lever off the board is reversible - the
engine field survived exactly so that it is.

---

### OQ-14. Should the weekly cycle run on a clock? **[ANSWERED 2026-09-07: yes, per league, off by default]**

Raised as issue #52, from Scott's own description of the league he wants:

> Rosters are dealt automatically Tuesday morning. Schemes are processed Thursday morning
> at like 3am (just how waivers would process in real fantasy football), and then you have
> until players' games to adjust lineups until each player individually locks once their
> game starts. The weekend is played. Monday night game is over. Stats are all compiled in
> real time. Tuesday morning rosters are dealt automatically for the next week. Standings
> are updated.

**This needed recording as a decision before anything was built**, because `CLAUDE.md`
says plainly: *"The commissioner-driven weekly flow: pre-deal -> dealt ->
schemes-processed -> stats -> finalized. Do not automate away the commissioner's
control."* That line exists to stop a session doing this unasked. It is not a veto on
Scott asking for it - he is the person it defers to - but it does mean the answer belongs
here, dated, with what it costs written down beside it.

**Answer: build it, per league, both switches defaulting to OFF.** So no league's rules
move until a commissioner turns it on, and the commissioner keeps every button he has -
the clock presses the same ones, it does not replace them.

#### What it does to the league, in Scott's own terms

Two things are worth him seeing spelled out, because they are changes in FEEL rather than
in plumbing:

- **3am Thursday becomes a real deadline.** `processSchemes` skips a team with no scheme
  on file - it is not an error, nothing happens for them. Today the commissioner waits
  until everyone is in. On a clock, "forgot to pick" costs you your scheme for the week,
  with no appeal. That is the waivers analogy working exactly as intended, and it is
  still a change: a manager who has never had a deadline now has one.
- **An unattended finalize is the one step with no undo.** `finalizePeriod` is legal from
  `schemes-processed` as well as `stats`, and it will happily finalize a week whose stat
  boxes are blank, writing a week of zeros into `cumulative` for everybody. **The guard
  built for this asks whether the FOOTBALL is over, not whether the boxes are full** -
  every team with a kickoff this week must have a result in the schedule. A postponed
  game makes the job wait and try again an hour later. That distinction matters because
  "a missing stat line" is also exactly what a healthy starter who was inactive looks
  like, and OQ-4c says he scores 0.

Because the finalize is the riskier half, the two are **separate switches**: a
commissioner can let the Thursday deadline run itself and still finalize by hand.

#### What was built, 2026-09-07

- `leagues.auto_process_schemes` and `leagues.auto_advance_week`, both default false, plus
  `leagues.tz`. Migration `20260907010000_auto_weekly_cycle.sql`.
- One scheduled Netlify function, `run-cycle-scheduled.mjs`, **hourly**. Not because it
  acts hourly - it acts twice a week - but because cron is UTC and both deadlines are
  local: 3am Eastern is 07:00Z under EDT and 08:00Z under EST, and **the season crosses
  the change on 1 November 2026**. Each league answers for its own timezone instead.
- The rules are `server/autoCycle.js` - pure, testable without a database, and every
  guard is a reason to SKIP rather than to fail. The steps themselves are the same
  `applyDeal` / `applyProcessSchemes` / `applyFinalize` the commissioner's buttons run;
  there is no second implementation of dealing a week.
- The commissioner's switches live on Commissioner -> Weeks -> "Run the week on a clock".

#### Two defaults I chose rather than ones you asked for

1. **Tuesday morning means 6am**, league local time. You named 3am Thursday exactly and
   left "Tuesday morning" loose. 6am leaves the longest gap after Monday night football
   for the numbers to be published, and still has the roster there before anyone is up.
2. **Both hours are constants in code**, not settings. Changing either is a one-line edit;
   making them settings would put two more knobs on a commissioner nav that OQ-8 already
   calls too crowded. Say if you want a different hour.

#### Three things the clock deliberately will not do

- **Deal the first week of a season.** There is no finished week behind it to follow, and
  week 1 should wait until the teams are in and the invites sent.
- **Deal past the end of the regular season.** Nothing in the engine knows how long a
  regular season is - left alone the job would deal week 19, 20 and 21 into January. It
  finalizes week 18, writes a line in the activity log saying the season is over, and
  stops.
- **Start the playoffs.** That takes a bracket size and an advancement ladder. No clock
  can choose those, and it stays a human act.

#### The sharp edge of the second switch, found while checking it

**Finalizing a week deletes its per-slot stat lines.** Measured, not inferred - finalizing
week 2 of the demo league takes it from 18 `stat_lines` rows to 0, leaving only the six
`period_results` aggregates: rank, raw score, standings points, tds, yards, best player.

So "a finalize cannot be undone" is stronger than it sounds. It is not only that the
standings are committed - it is that **the detail needed to work out whether they are
right has been deleted in the same write.** A commissioner who spots a wrong number on
Tuesday afternoon has nothing left to compare against.

**This is not new and this feature did not cause it.** It is `persistBlob`'s delete pass
(`server/league.js`), already recorded as item 1 of "things waiting to be fixed" in
`docs/FOR-THE-DESIGNER.md` - though that write-up blames the commissioner admin tools, and
it turns out an ordinary finalize does it too. Raised properly as **issue #56**.

What it means for OQ-14 is a recommendation rather than a blocker: **turn on the Thursday
switch first and leave the Tuesday one off** until #56 is fixed. The scheme deadline is
the half Scott actually described as the point ("just how waivers would process"), it is
reversible in the sense that matters - a wrong scheme costs one week, not the season - and
it does not commit anything.

#### What is NOT built, and is the honest gap

**Nobody is told anything.** If the roster lands at 6am Tuesday and schemes lock at 3am
Thursday, a manager finds out by remembering to open the app. That is survivable today
because a human deals and posts in the group chat; it is much less survivable when
nothing human is involved. **OQ-6 (notifications) is the real prerequisite** and Resend is
already wired up for magic links. Raised as **issue #57**.

What this pass does instead is make the clock visible: every screen that describes the
week now names the deadline in the league's own timezone, there is a "What happens on its
own" card in Help, and everything the clock does is written into the activity log with its
own icon. That is not a substitute for an email.

---

## Part 2 - Code that disagrees with the rules

I have not changed any of these.

### OQ-A. The sixth tiebreaker never applied, and ties were broken by team creation order instead. **[ANSWERED 2026-09-06: it applies]**

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

**ANSWERED 2026-09-06. Scott: "yes that should be a 6th tiebreaker if at all necessary.
it does already keep track of that if i am not mistaken? so it should matter as a 6th
tiebreaker if needed."** It does keep track of it - every team carries a season-long
`cumulative.bestPlayer` record: name, position, points, and the week it happened. It was
recorded and displayed all along, and simply never consulted.

**Built the same day.** `rankTeamsWithTiebreak` now loops `i < 6`, so the comparator and the
rank-grouping check agree. Three consequences worth writing down:

- **Weekly ties are fixed by the same change.** There is one ranking function and one
  tiebreaker list; the weekly result and the season standings both run through it. See OQ-C.
- **Two identical teams now genuinely share a rank.** Under the old bound they might not: if
  a third team sorted between them on input order, the grouping check broke the run and
  handed two teams level on all six different ranks, and different standings points. That is
  the case `tests/parity.test.js` now asserts as a deliberate difference from the artifact.
- **Both full simulated seasons still match the artifact object-for-object.** The tie never
  fires in either, which is a fair measure of how rare it is - and of why nobody in the
  league would have noticed until the week it decided something.

The original decision is kept below, because it explains the shape of the tests.

Deferring a known defect needed a plan, or the next person silently "fixes" it. So through
Phases 1-4 the engine kept the artifact behaviour verbatim, one test asserted that behaviour
so a reflex "fix" would fail loudly and land the reader here, and a second skipped test
encoded the documented six-tiebreaker rule ready to be unskipped.

That is exactly how the change was made on 2026-09-06: one character, unskip one, delete the
other. **Both of those tests are now gone**, replaced by tests of the real rule. The plan
worked; it does not need preserving.

**Two findings from 2026-09-04 that the fix has now overtaken, kept because they change what
the defect actually did while it was live:**

- **"The team created first" was not even true.** Input order is `state.teams` order, and the
  teams query carried no `ORDER BY` (`src/storage/supabase.js`), so it was whatever PostgREST
  happened to return - not promised to be stable between two reads of the same league. Two
  screenshots on issue #29 showed different teams first. So an OQ-A tie was being awarded to
  an *arbitrary* team, not to the earliest one. The query now orders by `created_at`, then
  `id`, which is worth keeping on its own account: it makes team order deterministic
  everywhere, not only here. **If a tie of this kind ever fired before 2026-09-06, the winner
  may not have been the team the old text said it was.**

  **Half of that sentence was untrue until 2026-09-08 (issue #60).** The `ORDER BY` went
  into the CLIENT's read. `server/league.js` read teams unordered - and finalize runs
  server-side, on those rows, so the read that actually decides an OQ-A tie was still
  handing the engine Postgres heap order. What is left to decide, now that two teams level
  on all six share a rank and share standings points, is where equal ranks are sliced by
  array order: the champion of a dead-tied final (`standings.js:259`) and the last playoff
  slot (`standings.js:276`). Both were going to an arbitrary team; both now go to the one
  that joined first, which is what this page has said all along. **Nothing here was
  decided, and no rule moved** - a sentence that was aspirational became true. Scott is
  told because it makes a documented rule real, not because it changes one. The visible
  half was worse: the team cards traded places on every save while he entered stats.
- **It was visible mid-week, not only at finalize.** The live scoreboard added for issues #29
  and #30 ranks the week in progress through `rankTeamsWithTiebreak`, which was the point of
  routing the projection through the same function finalize uses. So the sixth tiebreaker now
  applies to the running scoreboard too, and the mid-week order matches the one the week will
  actually award.

### OQ-B. Blocks are not validated engine-side. **[ANSWERED 2026-09-06: confirmed]**
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

**ANSWERED 2026-09-06. Scott: "when you choose to protect/block when selecting a play
scheme, that means you can protect one player from your roster so they are not stolen from
you. It does not protect someone else's player, that would not make sense. It only protects
one player from your roster, whatever one you select, can not be stolen by another
managers team."**

**No code change.** The server already enforces exactly that, and the wording gap between
his "one player from your roster" and the validator's "one of your own starters" turns out
to be no gap at all: `processSchemes` only ever considers `roster.starters` when picking a
steal target, so a bench player cannot be stolen in the first place. Blocking one would
protect a man who was never at risk. Starters are the only players the rule can mean.

If bench players are ever made stealable, this answer has to be re-read before that ships -
at that point "one player from your roster" and "one of your own starters" stop agreeing.

### OQ-C. Weekly ties are broken by season-to-date standing. **[ANSWERED 2026-09-06: confirmed]**

In `finalizeCurrentPeriod` (line 740) the `tb` array is the team's **cumulative** totals
*before* this week is added. So when two teams tie on raw score in a given week, the tie goes
to whoever is already ahead in the season - the rich get richer.

This one is consistent with how `RulesTab` describes it, so I think it is deliberate. Noting
it because it is a design choice worth being sure about rather than an accident.
**Recommendation: leave as-is.** Confirm.

**ANSWERED 2026-09-06. Scott: "weekly ties should follow the same tiebreaker rules as the
standings."** That is what the code does, so nothing changed here directly - there is one
ranking function and one tiebreaker list, and both the weekly result and the season
standings go through it. Worth being explicit about what that means in play: the tiebreakers
are *season-to-date* totals as they stood before this week was added, so a weekly tie goes
to whoever is already ahead in the season.

**OQ-A changed this indirectly and he should know it did**: because they share the function,
best single-player score is now the sixth tiebreaker for a *weekly* tie too, not only for
the standings. That follows from his answer rather than cutting against it.

### OQ-D. The Coach can be your "best player." **[ANSWERED 2026-09-06: leave as-is]**

`bestThisPeriod` (line 735) considers all six starters including the Coach, so a Coach win
(2 pts by default) can be recorded as your best single-player performance - and given
default scoring, in a low-scoring week it sometimes will be. Elsewhere the rules treat the
Coach as a special case ("Coaches can never be stolen, redrawn, or blocked").
**Recommendation: leave as-is unless you meant best *player*, excluding the Coach.**

**ANSWERED 2026-09-06. Scott: "A coach can technically be your best player I guess.
technically the coach is a part of your roster, so we can just leave it as 'best player' if
somehow that ever happens that your coach got you the most points by a position on your
roster."** Left as-is. Note this now has slightly more weight than when it was written:
since OQ-A, best single-player score actually breaks ties, so a Coach can decide one.

### OQ-E. Stats stay with the slot, not the player.

`statsEntry` is keyed `[teamId][slot]` (line 415). If a lineup swap happened after stats were
entered, the numbers would stay attached to the slot and silently apply to whoever now
occupies it. In practice `rosterLocked` is set during the stats phase, so this is nearly
unreachable today.

My schema keys `stat_lines` the same way for behavioural fidelity, but also records
`player_id` at entry time so per-player history works. **Recommendation: keep slot-keyed,
and additionally have the server reject stat writes while the roster is unlocked**, which
closes the gap without changing anything you would notice.

**[IMPLEMENTED IN PHASE 3a; CONFIRMED 2026-09-06 - Scott asked for it in plainer terms, and once it was described as "stats are filed against the slot, not the man, so the server refuses stat entry whenever rosters are not frozen", kept the guard.]** `setStatLine` now
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

### OQ-J. The roster row is a playing card now. **[BUILT 2026-09-07 - two calls left for Scott]**

Issue #33 asked for a denser player row - position chip left, points hard right, three
tight lines - and Scott's screenshot on 2026-09-07 marked up the same row with two
specific notes: make the position the loud thing, and put the game's date and time where
the repetition was.

Built, and presentation only. **No engine behaviour changed and `parity.test.js` is
untouched.** What a row says now:

- **The slot label and the suit badge are one miniature playing card**, rank in the
  corner and the position's pip under it. It was two objects saying nearly the same word
  next to a meta line that said it a third time.
- **The position is said once.** Beside the NFL team it is gone - except on FLEX and the
  bench, where the slot and the position are different facts (a running back in the FLEX)
  and dropping one would lose information rather than remove a duplicate.
- **This player's own kickoff, day and time**, in the reader's timezone. It is
  `periods.kickoffs` - the same schedule the lineup lock reads - so the card cannot name
  a time the lock disagrees with, and it says nothing at all for a bye week or a week
  whose times have not been read yet. **This answers question 3 on the issue: yes to the
  kickoff, no to the opponent** - the kickoff map is keyed by team, and two teams sharing
  a 1:00 PM slot are not thereby playing each other, so an opponent would be a guess.
- **Status (OUT, IR, BYE) is a pill on the name line**, beside LOCKED, instead of buried
  after a pipe in the middle of a sentence.
- **"Locks Sun 1:00 PM (Detroit Lions)" under every gametime row is gone.** The row now
  carries that time itself, and the note above the lineup already says what the league
  locks on. Three sayings of one fact.

**The two questions the issue left open, and what was assumed:**

1. **The bench got the same treatment** - same card, same kickoff line - because deciding
   a swap is exactly when a bench player's game time matters. It does not get points or a
   stat line, because a bench player has neither. **Send back if you want the bench thin.**
2. **A row is 70px tall where it was about 44** (64px on the bench), carrying two more
   facts. That is the trade the issue asked for - more per player - but it is the opposite
   of "shorter", so it is worth seeing on your own phone before it is settled. It does at
   least move every roster row past the 44px touch target **OQ-8** measured everything
   under.

## What is still open

Nothing blocks Phase 1. Remaining, in the order they are needed:

| Question | Needed before | Why it can wait |
|---|---|---|
| **OQ-B** blocks validated server-side | **Done and confirmed 2026-09-06** | Enforced in `submitScheme`. Block protects one of your own players from being stolen - and since only starters are stealable, "your own starters" is the same rule. |
| **OQ-E** reject stat writes while unlocked | **Done (Phase 3a)** | Enforced in `setStatLine`, and in `pullStats` since 2026-08-29 for the same reason - a pull is stat entry done quickly, and a lineup change after one would move the numbers to a different player. Confirmed 2026-09-06. |
| **OQ-6** notifications | Phase 3c | Now nearly free: magic-link sign-in needs the same SMTP provider notifications would. |
| **league visibility** (new, from OQ-10) | Phase 3d | Members-only or link-public, per league. Recommended: a setting, defaulting to members-only, with the existing league set public so nothing changes for it. |
| **OQ-4c** what counts as "yards"? | **Done - answered 2026-08-28** | Split into passing / rushing / receiving, each customizable. A rules change; built in `docs/PHASE-4-PLAN.md` stage 1. |
| **OQ-4b** is `TEAM_ROWS` curated or typed? | **Done - answered 2026-08-28** | Typed out of necessity. The pool is rebuilt from live starters; `teamRows.js` becomes a test fixture. |
| **OQ-4d** who owns the coaches, and are injuries tracked? | **Done - answered 2026-09-04** | Coaches are the commissioner's - the refresh never touches one. Injuries come from roster status; a hurt starter is marked IR and the next healthy man takes his place. |
| **OQ-3** history depth | Phase 2 | Schema already preserves it; this is about what we surface. |
| **OQ-C / OQ-D / OQ-E** rules quirks | **All confirmed 2026-09-06** | Weekly ties use the standings tiebreakers (unchanged); the Coach can be your best player (unchanged); the roster-lock guard on stat writes stays. |
| **OQ-F** per-slot vs. per-player locks | Anytime | Behaviour-preserving; noted so it is not discovered later. |
| **OQ-H** first-run guidance | **Built 2026-09-04** | Presentation only. Four reversible calls for Scott, and one finding: nothing in the app freezes on a clock. |
| **OQ-I** you cannot see your own scheme | **Soon** | A real bug, not a preference. Needs a migration (Kyle) and a nod on OQ-9's intent (Scott). |
| **OQ-13** is the standings-points ladder a rule anyone wants? | Anytime | Nothing depends on it - the default has never been changed. Raised because the panel is a button on a crowded phone nav for a lever nobody has pulled. |
| **OQ-14** should the weekly cycle run on a clock? | **Done - answered 2026-09-07** | Yes, per league, both switches off by default. Built the same day (issue #52). Makes 3am Thursday a real deadline and lets a week finalize unattended once its football is over. |

**The standing agenda is cleared.** OQ-A, OQ-B, OQ-C, OQ-D and OQ-E were all answered by
Scott on 2026-09-06 and are recorded in full above. OQ-A was the only one that changed the
game; the rest confirmed what the code already did.

**OQ-10 is answered: many.** What that changed is recorded in `docs/PHASE-3-PLAN.md` -
accounts, an `invites` table replacing `team_secrets`, league-scoped read policies, and a
landing page with three doors (sign in / redeem a code / create a league).

**What is left for the designer**, now that OQ-A, OQ-B, OQ-C, OQ-D and OQ-E are all
answered:

- **OQ-G**, the scoreboard-first layout - built 2026-09-04, three parts to confirm or send
  back rather than a decision to make.
- **OQ-J**, the roster row as a playing card - built 2026-09-07 from issue #33 and your
  own screenshot. Two calls left: whether the bench gets the same row, and whether the
  taller row is the trade you wanted.
- **OQ-12**, whether the clock should be allowed to open the stats window. Raised while
  building the scheduled pull; it is a rules decision, not a tidy-up. **Mostly overtaken
  by OQ-14** - automating the scheme step opens the window anyway - but still open for a
  league that automates nothing.
- **OQ-14 is answered and built, and two things in it are yours to look at**: the
  Tuesday hour (6am was chosen, not asked for), and whether to actually switch either
  one on in your league. Nothing is on until you say so.
- **OQ-19**, the Save Now button - removed 2026-09-08 from issue #69, because against the
  write queue it did nothing in the state the bar is in almost all of the time. Nothing
  replaced it: a failed write retries itself, and the banner says so. Putting it back is
  two lines if you want it back.
- **OQ-13**, whether "Standings Point Values by Rank" earns its place. Keep it, hide the
  button and leave the engine field, or take the rule off the board. Recommendation: hide.
- **The season archive**, held rather than built. **Tabled 2026-09-06, not declined** - "i do
  kind of like that? but maybe we table that one for now until we hash out all the other
  small issues we need to clean up first." Raise it again when the Phase 4 stage list is
  empty.
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


---

### OQ-15. Should a yard be worth a fraction of a point? **[ANSWERED 2026-09-07: yes, to one decimal]**

**The complaint.** Scott: "right now as it reads (if i am reading this correctly), a
player with 55 yards total is 5 points and a player with 58 yards total is 5 points. it
should be 5.5 and 5.8 since technically the 58 yards is more than 55 and it would help to
clear up point totals overall at the end of the week so they are very easily read."

He read it right, and the split categories made it worse than he thought. Since the
2026-08-28 split each category floored on its own, so the yards were thrown away twice:

- **1 point per 10 rushing and receiving yards, a player with 5 rushing and 5 receiving.**
  Rushing floored to 0. Receiving floored to 0. **He scored nothing at all.**
- Scott's own expectation: 0.5 + 0.5 = **1 point**. And 5 rushing with 6 receiving = **1.1**.

**ANSWERED 2026-09-07. Scott: "the scoring should include decimal points. this makes the
game easier to follow ... that way the team gets credit for the yard rather than a player
having to reach another 9 yards to make it a full 2 points."**

Asked how precise, he chose **one decimal place**.

**What it does to the league.** Every score from here on is finer-grained, and two things
follow that are worth saying out loud:

1. **Ties get rarer.** Two teams landing on the same total was common with whole numbers;
   at one decimal it is unusual. The six tiebreakers still work, they will just be needed
   less. Nothing about them changed.
2. **The season has a seam in it.** Weeks already finalized keep the whole numbers everyone
   saw - see below - so a season that switches mid-way reads as whole-number weeks
   followed by decimal ones. That was the deliberate choice, not an oversight.

**Finished weeks do not move.** Asked what should happen to weeks already played, Scott
chose to leave them alone. In code that is exact rather than approximate: decimals were
added to the SPLIT scoring path only, and the legacy path - every stat line recorded
before 2026-08-28, which is what `tests/parity.test.js` replays - still floors exactly as
the artifact did. A full simulated season still comes out identical to the artifact's,
number for number, which is the proof that no finished week moved.

Where it lives: `computeStarterPoints` and `roundPoints` in `src/engine/scoring.js`;
rounded once on the player's total, and again on the team's, because twelve exact tenths
still sum to 40.99999999999999 in binary floating point. Covered by `tests/scoring.test.js`,
including both of Scott's own examples.

---

### OQ-16. Should the playoffs wait for a button? **[ANSWERED 2026-09-07: no - they start on a set week]**

**The bug Scott found, in his words.** "if the league was to start playoffs in week 16 ...
the comish would not be able to click that button in time to start playoffs after week 15
ends. week 15 would end, new rosters would automatically be dealt out at 6 am tuesday
morning for week 16 to all teams in the league. then if the commish hit 'start playoffs'
the rosters are already dealt, and multiple teams that are not in playoff contention would
have rosters. which shouldnt happen."

He is right, and it is worse than one week. `server/autoCycle.js` stopped dealing at
**week 18** and left the playoffs to the commissioner, so a league starting its playoffs at
week 16 would have had **16, 17 and 18** dealt to every team before anyone could intervene.
The Start Playoffs button and the automatic weekly cycle (OQ-14, shipped the day before)
could not both exist.

**ANSWERED 2026-09-07. Scott: "the playoff settings tab should have a week set for playoffs
to start in and it should have an additional setting to select the number of teams who make
the playoffs, as well as the format for how teams advance ... it should save and be set that
way for the season rather than having to click a button to 'start playoffs'. that button to
start playoffs should just be erased from the game entirely as it would serve no purpose."**

**The week is an NFL week**, not the league's own counter. Scott: "if the league selects to
have playoff start in week 16, that would be week 16 of the nfl season." A league that
joined in NFL week 3 calls that its week 3, so the two differ and the football calendar
decides.

**What it does to the league.**

1. **The decision moved to finalize, not to the scheduler.** The bracket is seeded the
   moment the previous week is scored, whichever hand scored it - the clock at 6am Tuesday
   or the commissioner on Monday night. Putting it in the scheduler instead would have left
   every league with automation switched off unable to reach the playoffs at all once the
   button was gone.
2. **Teams that miss the cut are never dealt a roster.** That is the whole point, and
   `tests/playoffs.test.js` asserts it directly.
3. **An unset week means the playoffs never start.** There is no button to fall back on.
   This is a real trap, so it is guarded in two places rather than left to memory: the
   league setup checklist carries it as a step that will not tick, and the Playoffs panel
   says so in as many words. Every league created before this change has a null week and
   will need one set.
4. **The settings lock once the bracket is live**, so a size or a ladder cannot be re-cut
   around teams already playing in it.

**A bracket has to fit.** Scott raised it himself: "if there are 8 teams making playoffs
and the format is 8, 4, 2, 1 you would need at least 3 weeks of playoffs to be played, that
could mean playoffs start in week 14 or 15 or 16." A ladder of 8, 4, 2, 1 is three weeks of
football, not four - nobody plays a round to stay champion. The panel does that arithmetic
on screen and warns when a bracket would run past week 18.

Where it lives: `playoffsDueToStart` and `seedPlayoffBracket` in `src/engine/standings.js`,
`savePlayoffSettings` and `playoffWeekSpan` in `src/engine/playoffs.js`,
`seasons.playoff_start_nfl_week` from `supabase/migrations/20260908000000_playoff_start_week.sql`.
The `startPlayoffs` server route and its storage plumbing are gone; the engine function of
that name survives only as the seam `tests/parity.test.js` replays the artifact through.


---

### OQ-17. A failed write leaves the league half-changed. **[FOUND 2026-09-08 - one for Kyle]**

**How it surfaced.** Scott played test weeks locally the day after OQ-15 shipped and hit:

> couldn't save that change. upsert period_results: invalid input syntax for type integer: "26.2"

The immediate cause was a column that had been missed - `period_results.raw_score` was still
an `integer` after scoring gained decimals, fixed by
`supabase/migrations/20260908010000_raw_score_decimal.sql`. That part is closed.

**The part that is still open is what the failure DID.** `persistBlob` in `server/league.js`
walks the tables in order and upserts each one on its own:

```js
for (const table of WRITABLE) {
  ...
  const { error } = await db.from(table).upsert(rows, { onConflict: "id" });
  if (error) throw new Error("upsert " + table + ": " + error.message);
}
```

There is no transaction around the loop. `periods` is written before `period_results`, so
when the second one threw, the first had already committed. Scott's league advanced three
weeks with **no results rows behind them** - the Scoreboard showed nothing for weeks 3, 4
and 5 while the app cheerfully offered to deal week 6. Two facts that must always agree -
"this week is finalized" and "this week has results" - had silently come apart, and the only
sign was an error banner about a different thing.

**Why it has not bitten before.** Every previous failure in that loop was an authorization
or version conflict, and those are refused by `guard()` before any table is touched. A
mid-loop failure needs a write that is legal, passes every check, and is then rejected by
the database itself - which, until a column type went stale, essentially could not happen.

**Recommendation, and it is Kyle's call because it is his layer.** Wrap the whole decompose
write in one Postgres function and call it over RPC, so the loop either lands completely or
not at all. supabase-js cannot open a transaction across separate `.upsert()` calls, so this
is a schema change rather than a client one. The alternative - ordering the tables so the
most fragile writes go first - only narrows the window and would have to be re-reasoned
every time a table is added.

**Until then**, a write that dies mid-loop needs the league restored from the previous state
rather than retried, and the retry banner ("Save failed - retrying automatically") is
actively misleading in that case: it retries a write whose earlier half already succeeded.

Not urgent for a league that is not yet live on this branch, and squarely in the way of one
that is.

---

### OQ-18. A league you are finished with. **[ANSWERED 2026-09-08: the commissioner deletes it]**

**Asked and answered by Scott on 2026-09-08**, in one breath:

> i would like a league delete button. i have run a few test leagues on the live site and
> would like to delete a few of them when i start a real one for a season. I need the
> ability to delete leagues once they are over or for whatever reason. commissioner should
> have that ability.

Nothing in the product could remove a league. The only way was a database console, which is
Kyle's - so a season that ended, or a league made while learning the app, stayed on the
front door forever. **Built the same day.**

**What it does.** Commissioner -> **Reset / Delete** -> Delete League. It removes the league
row, and every league-scoped table cascades from it: teams, players, rosters, schemes, stat
lines, weekly results, standings, invitations, memberships and the activity log. The screen
says how many teams and finished weeks are about to go, and the commissioner types the
league's **own name** - not a stock phrase - to confirm. The server checks the name again
before it deletes anything. Afterwards the app returns to the front door, because there is
no longer a league to be looking at.

**Three calls made in the building of it. Scott confirmed all three on 2026-09-08**, so
they are settled rather than provisional:

1. **The commissioner's, not the site admin's.** It sits beside Reset League, which is
   already his, and it is authorized the same way - a `league_members` row saying
   commissioner. The alternative was to put it on `/admin` beside the head coaches, which
   would have made deleting somebody else's league a thing two people can do.
2. **Reset stayed.** They are different answers to different questions: Reset empties a
   league and leaves it standing for another season; Delete takes it away. The panel says
   so, and points at Reset for anyone who only wanted to start over.
3. **One league at a time, from inside it.** There is no "delete" beside each league on the
   front door. That list is where somebody taps quickly, and it is the one place where
   deleting the wrong one is easiest - so removing a league means opening it first. Three
   test leagues is three deliberate trips, which for a thing with no undo seemed the right
   trade. **Confirmed by Scott on 2026-09-08**: "i like the delete league within the league
   itself. not on the main league list page. so we will keep it within the league commish
   tools." So the front-door list stays a list of doors and nothing else - if a delete ever
   does appear there, it is a decision to reopen, not a gap to fill.

**What a commissioner loses, and it is worth knowing before pressing it.** There is no bin
and no undo. `npm run db:backup` is the only copy of a league that exists, it is Kyle's to
run, and it is not on a schedule - so a league deleted between backups is gone for good, and
so is it for every manager who was in it. They are not told; they simply find the league
missing. Notifying them is OQ-6's problem, unbuilt.

**The other half of the same ask: the header.** Scott, the same day - "the name of the
league itself should be displayed somewhere on the page where the league is being played.
at the very top it says PIGSKIN POKER, which is fine, but maybe it says the league name and
then pigskin poker is displayed somewhere else." Built as an eyebrow: PIGSKIN POKER in 11px
gold caps, the league's name in the h1 below it with the suits, the role badge under that.
**Confirmed by him on 2026-09-08 - "header looks good."** Nothing further is open here.

#### Follow-up, the same day: Reset League was removed after all

**Decision 2 above lasted a day.** It said Reset stayed - "different answers to different
questions" - and that is now reversed. Recording the provenance honestly, because the two
entries are hours apart: **Scott's agreement was relayed by Kyle rather than given here
directly, and it was soft** - "he seems fine with it." If Scott reads this and disagrees,
the decision is his and this is the entry to reopen; putting Reset back is a small change.

**What prompted it.** Kyle's reading, which the code bears out, is that the remaining case
for Reset was a scenario nobody actually has: resetting a *real* league. Sorted by who
serves each job once Delete exists:

- **A test league** - Delete serves it better, and it is the reason Scott asked for Delete
  (*"i have run a few test leagues on the live site and would like to delete a few of
  them"*). Locally it is `npm run db:reset`.
- **"I set this league up wrong"** - Delete and recreate. The cost is re-inviting managers,
  which only bites once managers have joined - and that is precisely the case where Reset
  failed anyway (see below). It covered this job only in the situation where nobody needed
  it.
- **"Start next season"** - Reset was structurally wrong for it, and always had been. See
  OQ-2.

Redundant on two, wrong on the third.

**It was also broken, and had been since accounts shipped.** Reset set `teams = []` and went
through `replaceLeague` -> `persistBlob`, whose delete pass removed the team rows;
`league_members.team_id` is `on delete set null` and the same table carries
`check (role = 'commissioner' or team_id is not null)`, so the cascade violated the check.
The commissioner typed RESET LEAGUE, watched five retries over ~15 seconds, and got a raw
Postgres message in the save bar. It worked only in a league nobody had joined. Issues #47
and #49 carry the detail; both close with this change. Nobody had reported hitting it,
which is its own evidence about how wanted the button was.

**One thing it did that Delete does not, and it is worth knowing.** Reset kept the league's
id, its settings and its corrected player pool. That gap is real, it is the archive's job,
and OQ-2 now carries it along with the January 2027 date by which it matters.

**A related sentence went with it.** The Playoff Settings card, once a bracket has started,
used to end "Use Reset League to start over." Scott's instruction was to drop it entirely
rather than repoint it at Delete, and that is the honest answer: those settings are locked
for the season precisely so a bracket cannot be re-cut around teams already playing in it,
and Reset was never a good escape from that.

### OQ-19. The Save Now button did nothing. **[BUILT 2026-09-08 - one call for Scott]**

**Raised as issue #69 by Kyle, built the same day, and the decision is still Scott's** - it
takes a control off the header, which is a look-and-feel call rather than a port cleanup.
If the answer is "put it back", putting it back is a two-line change.

**What it was.** The header save bar carried a **Save Now** button, straight out of the
artifact (`LegacyProject/PigskinPokerCode.jsx:942`). There it called `doSave(state)` - a
full write of the whole league blob - and it was a genuine escape hatch, because a failed
write left the league stale and there was nothing else to press.

**What it had become.** In the port it called `queue.flush()`. That opens with "if nothing
is pending, re-emit the same status and return". The bar reads **Saved** almost all of the
time, and in that state pressing the button wrote nothing, retried nothing, and changed
nothing on the screen. A control that claims to save and does not is worse than no control,
because somebody presses it and believes something happened.

The other theory - that it flushes a debounced write early - does not survive the numbers:
the debounce is 400ms and fires on its own regardless. No finger gets there first.

**What it could still do, and why nothing replaced it.** One case was real. After a failed
write the entry goes back on the queue behind a backoff of `3s x attempts`, up to 15
seconds, and a flush skips that wait. Issue #69 recommended re-homing that as a **Retry
now** button inside the save-failure banner, and it was built that way first.

**Kyle sent it back on 2026-09-08 - "drop it" - and he was right.** The banner already
appears under the bar and already says the retry is automatic, so the button would have been
a new control invented on the way out of removing one, for a wait of at most 15 seconds, in
a state almost nobody ever sees. Nothing was lost by not building it: the write still
retries, five times, on its own. **So the manual flush has no button anywhere in the app
now.** `queue.flush` is still called by `visibilitychange` and `beforeunload`; nothing
presses it by hand.

**Why it is worth the change at all.** OQ-8 measured the sticky header at 217px of an 812px
phone and every control under the 44px touch target - the header buttons at 28px, this one
among them. Removing it does not fix the header, but it is the easiest row to give back,
because nothing is lost with it.

**Nothing about the save guarantee moved.** Coalescing, the debounce, the retries, the
backoff and the promise that nothing is lost are all exactly as they were. What went is a
button, not a behaviour.
`docs/DATA-MODEL.md` says so in the "save guarantee" section, which used to list the button
among what was kept.

**The question for Scott:** the bar now reads "Saved at 3:42" with no button beside it. Is
that the header you want, or would you rather have the button back?

### OQ-23. The setup checklist's Open buttons. **[ANSWERED 2026-09-08: they are gone - one page, top to bottom]**

Scott, on the create-a-league screen: **"the open button once you click on it opens the page
you need to edit, but it is waaaay at the bottom of that list. i think the open buttons are
irrelevant... essentially im looking for all of the intital settings in one screen like it is
that needs to be filled out and completed. basically just remove the open buttons and just
allow the commish to scroll the page filling out the settings."**

**What was wrong with them.** Each of the five steps carried an **Open** button that set the
Commissioner tab's sub-tab - and the sub-tab renders BELOW the sub-nav, which renders below
the checklist. So pressing Open on step 1 scrolled nothing: it changed a panel most of a
screen further down, and following the list in order meant five trips down the page and back
up to find the next line. The checklist read like navigation and behaved like a remote
control for something off-screen.

**What it is now.** Every panel a new league needs is rendered on the setup screen itself, in
the checklist's own order:

| | |
|---|---|
| 1 | Add a Team |
| 2 | Invite Someone |
| 3 | NFL Week |
| 4 | Playoff Settings, then Scoring |
| | Lineup Lock, then Run the week on a clock |
| 5 | Deal Week 1 |

The checklist stays exactly as it was otherwise - same five steps, same ticks, same
disappearing act the moment the first week is dealt - but it is now a map of what is below it
rather than a set of links. Nothing on it can be pressed.

**Three consequences worth knowing, all reversible:**

- **The sub-nav shrinks while a league is being set up**, to Player Pool and Delete League -
  the only two panels the setup screen does not hold. Listing Teams, Invite, Weeks, Scoring
  and Playoffs there as well would render each of them on the page twice. The full nine tabs
  come back the moment Week 1 is dealt. **Reverse:** one line in `CommissionerTab` - the
  `subs` ternary.
- **The Deal button is the last thing on the page**, which is deliberate: it is step 5, it is
  the one action there that cannot be taken back, and reaching it means having scrolled past
  everything else. It arrives via a new `CommWeekActionsPanel`, split out of `CommWeeksPanel`
  so the Weeks tab and the setup screen render the SAME card rather than two copies of it.
- **Two lines of copy stopped naming tabs.** "Add them under the Teams tab first" and "deal
  Week 1 from Weeks" were both true from the Weeks tab and wrong from a page that has Teams
  a few inches up. Neither names a tab now.

**No rule moved and no engine file was touched.** This is `src/components/commissioner.jsx`
only - the same panels, in a different order, on one screen.

*Numbered OQ-23 rather than OQ-20: written on 2026-09-08 against a main that ended at Kyle's
OQ-19, while OQ-20, OQ-21 (the week screen) and OQ-22 (the repeat-block ruling) were open on
other branches the same afternoon. Keep all four when they merge.*
