/* Pigskin Poker - the 32 NFL teams, and how to write one short.
 *
 * The pool spells a team out in full ("San Francisco 49ers") because that is how the
 * artifact's TEAM_ROWS spelled it, and that is the name every player row carries. On a
 * roster row there is no space for it: "Amon-Ra St. Brown" and "Philadelphia Eagles" on
 * one line is most of a phone's width spent on two facts, one of which is a logo you
 * already know. So the row shows the abbreviation instead - DET, PHI - and this is the
 * one place that decides which three letters those are (Scott's call, 2026-09-08).
 *
 * WHY IT IS HERE AND NOT IN server/feed/nflverse.js, which had a team table first. That
 * one maps the FEED's abbreviations to our names, and it is deliberately many-to-one:
 * nflverse writes Jacksonville as JAX in one file and JAC in another, the Rams as LA or
 * LAR, so it has 34 keys for 32 teams. Asking it "how do I write this team short?" has no
 * single answer. This map is the other direction and is one-to-one, which is what a
 * display needs - and `nflverse.js` now derives its table from this one, so a rename
 * cannot leave the feed and the screens disagreeing.
 *
 * ONE-TO-ONE IS THE INVARIANT, and tests/nflTeams.test.js pins it: 32 names, 32 distinct
 * abbreviations. Two teams sharing one would make a matchup line lie about who is playing.
 */

/** Full name, as the player pool spells it -> the abbreviation a roster row shows. */
export const NFL_TEAM_ABBR = {
  "Arizona Cardinals": "ARI",
  "Atlanta Falcons": "ATL",
  "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR",
  "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN",
  "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN",
  "Detroit Lions": "DET",
  "Green Bay Packers": "GB",
  "Houston Texans": "HOU",
  "Indianapolis Colts": "IND",
  "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV",
  "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LAR",
  "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN",
  "New England Patriots": "NE",
  "New Orleans Saints": "NO",
  "New York Giants": "NYG",
  "New York Jets": "NYJ",
  "Philadelphia Eagles": "PHI",
  "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA",
  "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN",
  "Washington Commanders": "WAS",
};

/**
 * How to write this team short, or the name itself when it is not one of the 32.
 *
 * A COMMISSIONER CAN TYPE ANYTHING INTO THE TEAM FIELD. The player pool screen lets him
 * add a player by hand with a free-text team (`onAddPlayer`, `onRenamePlayer`), which is
 * how a rookie nobody's depth chart has yet gets into the league. Falling back to what he
 * typed is the only honest answer: an empty chip would hide a player's team, and a guessed
 * abbreviation would put him on the wrong one.
 *
 * @param {string|null|undefined} team  a full team name, or whatever was typed
 * @returns {string} the abbreviation, the original string, or "" for nothing at all
 */
export function abbrFor(team) {
  if (!team || typeof team !== "string") return "";
  return NFL_TEAM_ABBR[team] || team;
}
