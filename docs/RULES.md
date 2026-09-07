# Pigskin Poker - the rules

The complete statement of how the game is played. Written 2026-09-06, at Scott's
instruction, because until now the only full account of the rules was the code itself.

**This document describes the game. `src/engine/` implements it.** Where the two disagree,
one of them is a bug - say so rather than quietly picking a winner. Every section names the
file that enforces it, so that check is possible.

Numbers marked `[configurable]` are commissioner settings, not fixed rules; the defaults are
given. Everything else is the game.

---

## 1. The shape of it

A league of teams plays a season of weeks. **Every week, every team is dealt a brand new
random 12-player roster.** Nothing carries over - not your stars, not your sleepers, not
last week's lucky pick. All you keep from week to week is your standings points.

Between the deal and kickoff each manager plays **one scheme** - a single move to improve
the hand he was dealt, or to protect it. Then the real NFL weekend happens, the stats come
in, the week is finalized into standings, and everyone is dealt a fresh 12.

The commissioner drives the week: he deals it, resolves the schemes and finalizes it, and
**no week ever advances itself**. Two things do run on the clock inside a week - lineups
lock at real kickoff times (section 10), and a league can opt in to having its stats pulled
on a schedule (section 2) - but neither moves the week on.

---

## 2. The weekly cycle

Five phases, in order, each moved along by the commissioner:

| Phase | What happens |
|---|---|
| **pre-deal** | The week exists but no rosters do. The player pool can be refreshed or edited here, and only here. |
| **dealt** | Every team has 12 players. Managers submit schemes. |
| **schemes-processed** | Schemes have resolved. Rosters can be locked for the weekend. |
| **stats** | The games are played; stat lines are entered or pulled. |
| **finalized** | Scores, ranks and standings points are recorded. Rosters clear, and the next week begins at pre-deal. |

Enforced by `PHASE_RULES` in `server/operations.js`. A step out of order is refused, not
guessed at.

**Where the stat lines come from.** The commissioner can type them, or press *Pull Stats* to
fill every starter's boxes from the real NFL week. **A pull never overwrites a number he
typed** - his line stands and the feed's opinion is recorded beside it. A league can also
opt in to having that pull run on a schedule, which is the one thing in the game that
happens with nobody pressing anything; it still cannot finalize the week.

---

## 3. The roster

**12 players: 6 starters and 6 bench.**

Starters, one of each:

- **Coach**
- **QB**
- **WR**
- **RB**
- **TE**
- **FLEX** - a WR or an RB. **Never a TE.**

Bench: one more Coach, QB, WR, RB and TE, plus one more FLEX-eligible player (again a WR or
an RB). The bench is not slotted - it is simply six players, each shown at his real position.

**Because FLEX excludes tight ends, every team is capped at 2 TEs**, the same cap as QB and
Coach. That is a consequence of the FLEX rule, not a separate rule.

**Only starters score.** A bench player can put up 200 yards and it is worth nothing.

Defined in `src/engine/constants.js`; dealt by `src/engine/deal.js`.

---

## 4. The deal

Rosters are dealt at random from the league's player pool, and **only Active players are
dealt** - anyone marked OUT, IR or BYE is skipped.

If the pool cannot fill every team - too few Coaches, say - the deal is refused with a
message saying so, rather than dealing partial rosters.

The deal is per-league. Two leagues dealing the same week get different rosters.

Implemented in `src/engine/deal.js`.

---

## 5. Play schemes

Each week every manager picks exactly one of four actions. **Schemes are private** - other
managers see the resulting rosters, never the moves.

- **Block** - protect one of your own players from being stolen this week.
- **Steal** - drop a player at a position of your choosing, and take a random *unprotected*
  player at that same position from another team's starters.
- **Redraw** - drop a player at a position of your choosing, and get a random free agent at
  that exact position.
- **No Action.**

Rules that apply throughout:

- **The Coach can never be selected for a scheme** - not stolen, not redrawn, not blocked.
- **Replacements always match the position dropped.** Never flexible.
- **Only starters can be stolen.** A bench player is not a valid target, which is why Block
  is about your starters: blocking a bench player would protect someone never at risk.
- **Dropped players return to the free-agent pool immediately**, and can be picked up within
  the same round of processing.
- **A steal with no legal target is skipped**, with a note in the activity log, and the
  roster is left unchanged rather than half-executed.

### Resolution order, which is load-bearing

1. **All blocks resolve first**, and apply immediately.
2. **Steals and redraws then resolve together in a single randomly shuffled pass**, so a
   player freed by one manager's move can be picked up by another's in the same pass.

The shuffle means **there is no advantage to submitting early or late**.

Implemented in `src/engine/schemes.js`.

---

## 6. Scoring

Only three things score: **passing, rushing and receiving.** Return yards, two-point
conversions and fumble-recovery touchdowns are worth nothing. A starter who does not play
scores zero, the same as one who plays and does nothing.

**Yards count by type, each at its own rate** `[configurable]`:

| | Default |
|---|---|
| Passing yards per point | 25 |
| Rushing yards per point | 10 |
| Receiving yards per point | 10 |

**Each type converts on its own.** 15 rushing yards and 15 receiving yards is 1 point plus
1 point - not 3. Leftovers do not pool across categories.

**Touchdowns** `[configurable]`: passing 4, rushing 6, receiving 6.

**The Coach** scores on his real team's result `[configurable]`: 2 for a Win, 1 for a Tie,
0 for a Loss.

> **Why yards split three ways.** Until 2026-08-28 all yards counted at one rate, which made
> a quarterback worth several times any other slot - a 300-yard, 3-TD passing day scored 45
> against a good receiver's 17. The same day now scores 24 against 18. This was the first
> deliberate rules change since the game left the Artifact (OQ-4c).

Implemented in `src/engine/scoring.js`.

---

## 7. Standings and tiebreakers

Each week teams are **ranked by that week's raw score**, and earn **standings points by
finish** `[configurable]` - more for first, fewer for last, scaled to the number of teams.

**The season standings are the sum of weekly standings points, not raw scores.** A team that
wins three weeks narrowly beats a team that wins one week enormously.

Teams that finish level share the higher rank and the next rank is skipped - so two teams
tied for 2nd are both 2nd, and the next team is 4th.

### The six tiebreakers, in order

1. Standings Points
2. Week Wins
3. Coach Wins
4. Total TDs
5. Total Yards
6. **Best single-player score in a week**

Two teams level on **all six** genuinely share a rank.

The sixth tracks the best single-week performance by any one player on your roster, and
records his name, position, points and the week - it updates whenever a later week beats it.
**The Coach counts** for this: he is part of your roster, so if he is somehow your highest
scorer in a week, that is your best player (OQ-D).

**Weekly ties use the same six tiebreakers as the season standings** (OQ-C), applied as
*season-to-date* totals as they stood before this week was added. So a weekly tie goes to
whoever is already ahead in the season.

> **The sixth tiebreaker did not work until 2026-09-06.** The comparator checked only the
> first five, so teams level through Total Yards were ranked by whichever joined the league
> first - and, worse, two teams identical on all six could be handed *different* ranks and
> different standings points. Both are fixed; see OQ-A in `docs/OPEN-QUESTIONS.md`. It is
> rare enough that it never once fired in two full simulated seasons.

Implemented in `src/engine/standings.js`.

---

## 8. Playoffs

The commissioner sets a **bracket size** - the top N teams by season standings - and an
**advancement list** saying how many survive each round.

- **Once the playoffs start, regular-season standings freeze.**
- Playoff rounds run the identical cycle: deal, schemes, stats, finalize. You are dealt a
  fresh 12 in the playoffs exactly as in the regular season.
- The same six tiebreakers apply, but **scoped to that round only**.
- Playoff periods are called **Round N**; the regular season uses **Week N**.

Implemented in `src/engine/playoffs.js`.

---

## 9. The player pool

**Each league has its own pool**, copied from a shared template when the league is created.
A commissioner marking someone OUT is a statement about *his* league and never reaches
anyone else's.

### Where the players come from

The pool is built from **the live NFL depth charts** - each NFL team's current 1 QB, 2 RB,
2 WR and 1 TE, plus its head coach, and it is refreshed **only in pre-deal**, when there are
no rosters to disturb.

**Dealing the week refreshes the pool first**, so every deal comes off live rosters. If the
feed cannot be reached the deal still goes ahead on the pool as it stands, and says so. The
commissioner also has a standalone refresh button, for looking at the pool and correcting it
before he deals. Either way the activity log records what the refresh changed.

A refresh may:

- add players who have become starters;
- retire players who are no longer on a roster - **marked OUT, never deleted**, because a
  deleted player would break the rosters, stat lines and results that already reference him;
- update injury status from the weekly roster file - **RES becomes IR**, and anything else
  off the active roster becomes OUT.

**An injured starter is skipped and the next healthy man takes the slot**, so every NFL team
still contributes a full 1 QB / 2 RB / 2 WR / 1 TE. The injured player is still added to the
pool carrying IR - a pool that simply omitted him could not explain where he went.

### What a refresh may never do

- **It never touches a Coach.** Head coaches belong to the commissioner (OQ-4d): the only
  free source for them is not maintained to the standard of the depth charts, so coaches are
  added, edited and removed by hand. Worth revisiting if a maintained source appears.
- **It never overwrites a decision a person made.** A player the commissioner added himself,
  or a status he set himself, is left alone - the feed records what it thinks separately and
  reports the disagreement rather than acting on it.

### Player statuses

`Active`, `OUT`, `IR`, `BYE`. **Only Active players are dealt.**

A player dealt to a team **stays there for the week**, whatever happens in real life. If his
coach is fired on Tuesday or he lands on IR on Wednesday, he finishes your week; the change
shows up at the next deal.

Implemented in `server/pool.js` and `src/engine/pool.js`.

---

## 10. Lineup lock and injury swaps

After schemes are processed the commissioner can **lock rosters** for the weekend, which
closes scheme submission.

**When lineups stop being changeable is a league option** `[configurable]`, set once by the
commissioner and then fired by the real NFL kickoff times rather than by anyone pressing a
button (OQ-11):

| Setting | The rule |
|---|---|
| **Each player at his own kickoff** (default) | A player freezes when *his* game starts. You can keep changing your lineup all day using players who have not kicked off yet - a 1pm starter is frozen at 1pm, a Sunday-night receiver can still come in at 7. |
| **Every lineup at the week's first kickoff** | The whole lineup freezes at the earliest game of the week. What you have in then is what plays, and injuries announced afterwards are your bad luck. |

The default is what the rules have always described and what every existing league is
already playing, so choosing it changes nothing - it only means the clock enforces it
instead of the commissioner.

Either way:

- **The commissioner can lock any individual player by hand at any time** - a late scratch,
  say - and that lock always holds, outranking the schedule.
- Managers can **freely move any non-locked player** between the starting lineup and the
  bench.
- **A lineup swap always routes a starter through the bench.** You can never directly swap
  two starters.
- A team whose kickoff time is not known - a bye, or a week whose schedule was never read -
  **never locks on the clock**, and only the commissioner's own locks apply.

Kickoff times are read when the week is dealt, from the same NFL schedule the Coach results
come from, and can be re-read on demand because flex scheduling moves Sunday games.

Stats are filed against the **slot**, not the player, so the server refuses stat entry while
rosters are unlocked - which stops a late lineup change from silently moving one player's
numbers onto another (OQ-E). Nothing in normal play can trigger it.

---

## 11. Who does what

**The commissioner** advances every phase, deals the week, refreshes and edits the player
pool, enters or pulls the stats, locks rosters, sets the scoring rates and standings points,
chooses when lineups lock, and configures the playoff bracket. **Every phase change is his**
- nothing moves the week along on its own.

**A manager** submits one scheme a week, and manages his starting lineup.

---

## 12. What these rules do not yet cover

- **Stats disagreements.** The stats pull never overwrites a line the commissioner typed,
  but there is no view showing where his number and the feed's differ - stage 6 in
  `docs/PHASE-4-PLAN.md`.
- **Unattended pool updates.** Stats can be pulled on a schedule, but the *pool* refreshes
  only when the commissioner deals - so if a starter changes on Wednesday, the pool learns
  about it at the next deal, which is also the only moment it could safely act on it.
- **Whether the clock may open the stats window.** Under the weekly lock, lineups freeze on
  the clock but the stats phase still waits on the commissioner pressing a button, so a
  scheduled pull can sit idle. Recorded as OQ-12; it is a rules decision, not a bug.
- **Season archive.** Past seasons are preserved in the schema but there is no way to browse
  them. Tabled 2026-09-06.

---

## Where the rules came from

Pigskin Poker was designed and built by Scott as a single-file Claude Artifact, preserved
untouched in `LegacyProject/`. This repository is that game ported to a real website, and
the game itself is deliberately unchanged except where he has said otherwise.

**Exactly two rules have changed since the Artifact**, both at his instruction, and both
recorded in `tests/parity.test.js`:

| Date | Change | Question |
|---|---|---|
| 2026-08-28 | Yards and touchdowns split into passing / rushing / receiving, each at its own rate | OQ-4c |
| 2026-09-06 | The sixth tiebreaker (best single-player score) actually applies | OQ-A |

Everything else in `docs/OPEN-QUESTIONS.md` was answered by confirming what the code already
did. If you are about to change a rule, read that file first, along with "the rule that
matters most" in `CLAUDE.md`.
