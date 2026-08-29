# The recorded feed

A snapshot of the live nflverse feed, committed so local development and the tests do
not depend on the network - or on what the depth charts happen to say this morning.

**Regenerate with `npm run feed:record`.** Nothing here is hand-edited.

| File | What it is |
|---|---|
| `depth-charts.csv` | The newest snapshot out of `depth_charts_<season>.csv`, verbatim - every position, not just the six the pool wants |
| `games.csv` | THIS season's `games.csv`, cut to the six columns `coachesFromGames` reads - the head coaches |
| `results-week.csv` | A few real weeks of FINISHED games, for the Coach slot's Win/Tie/Loss |
| `stats-week.csv` | A few real weeks of player stats, filtered to players in the pool |
| `manifest.json` | What was recorded, when, which weeks are real, and where the numbers came from |

## Three things to know before trusting a number here

**The stat lines and the results are last season's, wearing this season's label.** They
are real numbers from real regular-season weeks, relabelled to the season the fixture
stands in for. That is not a shortcut - `stats_player_week_<this season>.csv` is a 404
until games are played, and this season's `games.csv` carries a schedule with no scores
in it, so recorded past weeks are the only stat data that exists while the stats pull is
being built. `manifest.json` records exactly which season and weeks they came from.
**Nothing here is a prediction, and no number here belongs in a real league.**

Two files rather than one, because they answer different questions: `games.csv` is THIS
season's schedule, which is where the head coaches come from, and `results-week.csv` is
past weeks that actually finished. A result is matched to a pool coach BY TEAM, so a team
that has changed coach since still resolves.

**Only the weeks in `manifest.json` are real, and asking for another one gets nothing.**
That is deliberate: it is what the live feed does before a game is played, so the "the
feed has nothing for this week yet" path can be tried locally instead of existing only in
production. Serving whichever week happens to be recorded would answer a different
question than the one asked.

**The depth chart is a moment, and it ages.** It is a starting point for development, not
a source of truth about who is starting. Re-record it when it matters.

## Why it cannot reach production

`server/feed/index.js` will not serve this to anything but a local Supabase URL, whatever
`PIGSKIN_FEED` says - a fixture served in production would freeze a league's pool at
whatever is recorded here and report success while doing it. `tests/feed.test.js` asserts
the refusal with the variable set.
