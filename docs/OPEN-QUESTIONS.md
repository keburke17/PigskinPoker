# Open Questions

Decisions that are **yours**, not mine. Two kinds:

- **OQ-1 .. OQ-9** - things the artifact sandbox forced, which are now genuinely open for
  the first time. The code cannot tell us whether these were choices or workarounds.
- **OQ-A .. OQ-F** - places where the code and the written rules disagree, or where the
  behaviour is surprising. Per the ground rules I have **changed none of these**. They are
  written down and waiting on you.

Each has a recommendation so you have something to say yes or no to.

> **Answered 2026-08-17:** OQ-1 **yes, decompose** (with standard web conventions) /
> OQ-2 **yes, seasons** / OQ-4 **manual entry was the only option - treat it as a stopgap** /
> OQ-9 **yes, public once resolved** / OQ-A **deferred to the original designer**.
> OQ-B **provisionally yes, confirm with him**. OQ-8 **checked in Phase 1 - see below**.
> **OQ-10 (one league or many?) is newly open** and shapes Phase 3.
> The rest are still open and cost nothing to change.

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

### OQ-5. Join codes, or real accounts?

No auth primitives existed in the sandbox, so join codes were the only option.

**Recommendation: keep the join-code experience for now** and fix only the security
underneath (Phase 3), because it is what your league already knows and there is nothing to
sign up for. But you may prefer real logins, or want both. Phase 3 makes email/Google
additive rather than a migration, so this is reversible - unlike OQ-1 and OQ-2.

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

---

### OQ-10. One league, or many? **[OPEN - shapes Phase 3, raised during deployment]**

The Artifact stored everything under a single `window.storage` key, so "one league" was
never a decision - it was the only thing a key-value store could express. That constraint
is gone, and it is worth deciding deliberately rather than by default.

**The database is already multi-league.** `leagues` is an ordinary table with a UUID key
and nothing limiting it to one row; `league_secrets.league_id` is the *primary key*, so a
commissioner code is per-league rather than global; and 11 foreign keys already scope
teams, players, seasons and sessions to a league. Ten leagues could exist tomorrow with
no migration.

What is single-league is the **application**:

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

### OQ-F. Locks are per-player today, per-slot in my schema.

`lockedPlayerIds` (line 414) is keyed by player id for the whole period; I put `locked` on
the roster slot. Equivalent in practice, since a player occupies exactly one slot at a time,
and simpler to enforce. Flagging it as a deliberate, behaviour-preserving change rather than
letting you discover it later. **Recommendation: proceed.** No action needed unless you see
a case I have missed.

---

## What is still open

Nothing blocks Phase 1. Remaining, in the order they are needed:

| Question | Needed before | Why it can wait |
|---|---|---|
| **OQ-10** one league or many? | **Phase 3** | If many, league ownership must land with accounts, not after. |
| **OQ-B** blocks validated server-side | **Phase 3** | Provisionally yes; awaiting the designer's final confirmation. |
| **OQ-5** join codes vs. real accounts | Phase 3 | Phase 3 makes accounts additive either way. |
| **OQ-6** notifications | Phase 3 | Only affects whether we collect emails while building the members table. |
| **OQ-4b** is `TEAM_ROWS` curated or typed? | Phase 4 | Decides whether a feed enriches the pool or replaces it. |
| **OQ-3** history depth | Phase 2 | Schema already preserves it; this is about what we surface. |
| **OQ-C / OQ-D / OQ-E** rules quirks | Anytime | All preserved as-is; each is a small, reversible behaviour question. |
| **OQ-F** per-slot vs. per-player locks | Anytime | Behaviour-preserving; noted so it is not discovered later. |

**OQ-B is provisionally answered** (yes, Block protects your own starters) and is on the
list to confirm with the original designer, alongside **OQ-A**. Those two are the standing
agenda for that conversation.

**OQ-10 is the one to decide before Phase 3 starts**, because it changes what Phase 3
builds rather than what comes after it.
