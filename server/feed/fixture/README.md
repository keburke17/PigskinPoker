# The recorded feed

A snapshot of the live nflverse feed, committed so local development and the tests do
not depend on the network - or on what the depth charts happen to say this morning.

**Regenerate with `npm run feed:record`.** Nothing here is hand-edited.

| File | What it is |
|---|---|
| `depth-charts.csv` | The newest snapshot out of `depth_charts_<season>.csv`, verbatim - every position, not just the six the pool wants |
| `games.csv` | One season of `games.csv`, cut to the six columns `coachesFromGames` reads |
| `stats-week.csv` | One real week of player stats, filtered to players in the pool |
| `manifest.json` | What was recorded, when, and where the stat lines really come from |

## Two things to know before trusting a number here

**The stat lines are last season's, wearing this season's label.** They are real numbers
from a real regular-season week, relabelled to the season the fixture stands in for. That
is not a shortcut - `stats_player_week_<this season>.csv` is a 404 until games are played,
so a recorded past week is the only stat data that exists while the stats pull is being
built. `manifest.json` records exactly which season and week they came from. **Nothing
here is a prediction, and no number here belongs in a real league.**

**The depth chart is a moment, and it ages.** It is a starting point for development, not
a source of truth about who is starting. Re-record it when it matters.

## Why it cannot reach production

`server/feed/index.js` will not serve this to anything but a local Supabase URL, whatever
`PIGSKIN_FEED` says - a fixture served in production would freeze a league's pool at
whatever is recorded here and report success while doing it. `tests/feed.test.js` asserts
the refusal with the variable set.
