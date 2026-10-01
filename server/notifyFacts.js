/* What an email knows about one team's week.
 *
 * Issue #57, PR 2. PURE: a hydrated view in, a plain object out, no database and no
 * network - so every sentence a league receives is asserted in tests/notifyFacts.test.js
 * without a stack running, and Scott can be shown a rendered email without one being
 * sent.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FACTS ARE BUILT FROM THE VIEW RATHER THAN FROM THE ROWS.
 *
 * `hydrate()` is what the whole app reads - every screen, every engine call - so a fact
 * read here is the same fact the manager will see when he opens the app a minute later.
 * Building from the raw rows instead would be a second interpretation of the same data,
 * and the way that fails is an email saying something the screen contradicts.
 *
 * TIMES ARE FORMATTED IN THE LEAGUE'S TIMEZONE, NOT THE SERVER'S. `formatKickoff` in
 * src/engine/lineupLock.js formats in the runtime's local zone, which is right on a
 * manager's phone and wrong in a Netlify function, where it is UTC. An email telling a
 * league in Chicago that its lineup locks at "Thu 1:15 AM" is worse than one that says
 * nothing, so this file formats against `_meta.tz` and names the zone every time.
 * ---------------------------------------------------------------------------
 *
 * NOTHING HERE DECIDES WHETHER TO SEND. That is server/notify.js, and the league's own
 * switch. This only answers "what would it say".
 */

import { STARTER_SLOTS } from "../src/engine/constants.js";
import { gameFor, firstKickoff, lineupLockMode } from "../src/engine/lineupLock.js";
import {
  autoProcessSchemes,
  leagueTimeZone,
  schemeDeadlineWords,
  zoneLabel,
} from "../src/engine/weeklyClock.js";

/** "Week 7" / "Playoff Round 2", exactly as every screen labels a period. */
export function periodLabel(period) {
  if (!period) return "";
  return (period.type === "playoff" ? "Playoff Round " : "Week ") + period.number;
}

/** "Thu 8:15pm EST" - a kickoff in the league's own time, with the zone named. */
export function kickoffWords(iso, tz, now = Date.now()) {
  if (!iso) return "";
  try {
    const at = new Date(iso);
    if (!Number.isFinite(at.getTime())) return "";
    const day = at.toLocaleDateString("en-US", { timeZone: tz, weekday: "short" });
    const time = at
      .toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })
      .replace(" AM", "am")
      .replace(" PM", "pm");
    return day + " " + time + " " + zoneLabel(tz, now);
  } catch {
    return "";
  }
}

const teamOf = (view, teamId) => (view.teams || []).find((t) => t.id === teamId) || null;
const playerOf = (view, playerId) =>
  playerId ? (view.playerPool || []).find((p) => p.id === playerId) || null : null;

/**
 * One roster line: "QB - Jalen Hurts (PHI) at NYG".
 *
 * The opponent comes from the same `periods.kickoffs` entry the roster row on screen
 * reads (issue #24), so the email and the app name the same matchup. A player whose
 * team has no game we can put a time on gets no fixture rather than an invented one -
 * the week's schedule may simply not have been read yet.
 */
function rosterLine(view, slot, playerId) {
  const player = playerOf(view, playerId);
  if (!player) return slot + " - empty";
  const game = gameFor(view._meta?.kickoffs, player.team);
  const fixture = game?.opp ? (game.home ? " vs " : " at ") + game.opp : "";
  return slot + " - " + player.name + " (" + player.team + ")" + fixture;
}

/**
 * Where this team finished in the week that just ended, or null when there isn't one.
 *
 * THE MOST RECENTLY FINALIZED PERIOD, which is not simply the last element of
 * `weeklyResults`: that array sorts on period NUMBER, and a playoff round 1 sorts ahead
 * of week 17. Weeks come before playoffs in a season, so the ordering is (type, number)
 * - and getting it wrong would recap the wrong week in January, which is the one month
 * anybody is paying attention.
 *
 * Null in week 1, and in any league whose previous week nobody finalized. The template
 * says nothing at all in that case rather than "you finished nowhere".
 */
export function recapFor(view, teamId) {
  const results = view.weeklyResults || [];
  if (!results.length) return null;

  const rank = (r) => (r.period?.type === "playoff" ? 1 : 0) * 1000 + (r.period?.number ?? 0);
  const latest = results.reduce((best, r) => (rank(r) > rank(best) ? r : best), results[0]);
  const current = view.currentPeriod;
  /* The week being dealt is never its own recap. */
  if (current && latest.period?.type === current.type && latest.period?.number === current.number) {
    return null;
  }

  const inWeek = results.filter(
    (r) => r.period?.type === latest.period?.type && r.period?.number === latest.period?.number
  );
  const mine = inWeek.find((r) => r.teamId === teamId);
  if (!mine) return null;

  const best = mine.bestPlayer;
  return {
    periodLabel: mine.periodLabel,
    rank: mine.rank,
    teamCount: inWeek.length,
    rawScore: mine.rawScore,
    standingsPoints: mine.standingsPoints,
    best: best?.name ? { name: best.name, points: String(best.points ?? best.score ?? "") } : null,
  };
}

/**
 * When schemes close, in this league's own terms.
 *
 * NEVER PROMISES A CLOCK THE LEAGUE HAS NOT SWITCHED ON. A league whose commissioner
 * processes schemes by hand has no deadline at all, and telling those managers that
 * 3am Thursday is one would be inventing a rule. Same source the Help tab and the
 * welcome card read, so the email cannot drift from the screens.
 */
export function deadlineWords(view, now = Date.now()) {
  return autoProcessSchemes(view)
    ? "Schemes close " + schemeDeadlineWords(view, now) +
        " - anything not in by then plays the week exactly as it was dealt."
    : "Your commissioner processes schemes once everyone is in, so get yours in before he does.";
}

/**
 * When the lineup stops being editable, under this league's policy.
 *
 * The two policies are genuinely different messages: `gametime` gives every player his
 * own deadline, so there is no single time to name; `weekly` has one, and it is the
 * week's first kickoff. Where the schedule has not been read, both say the honest
 * thing - the shape of the rule, with no time attached.
 */
export function lockWords(view, now = Date.now()) {
  const mode = lineupLockMode(view);
  const tz = leagueTimeZone(view);
  const first = kickoffWords(firstKickoff(view._meta?.kickoffs), tz, now);

  if (mode === "weekly") {
    return first
      ? "Every lineup locks at the week's first kickoff, " + first + "."
      : "Every lineup locks at the week's first kickoff.";
  }
  return first
    ? "Each player locks when his own team kicks off. The first game this week is " + first + "."
    : "Each player locks when his own team kicks off.";
}

/**
 * What the schemes did to this team, in the league's own words.
 *
 * LIFTED FROM THE ACTIVITY LOG RATHER THAN REWRITTEN. The engine already words every
 * block, steal, failed steal and redraw (src/engine/schemes.js), that wording is what
 * the Activity screen shows, and a second set of sentences here would eventually
 * disagree with it about what happened in somebody's week. Third person reads slightly
 * oddly in an email addressed to you; a contradiction would read far worse.
 *
 * MATCHED ON THE TEAM'S NAME, because activity entries carry no team id - the shape is
 * the artifact's and parity pins it. Two teams whose names contain one another ("Team
 * A" and "Team A2") can therefore pull in a line about the other, which is a stray
 * sentence rather than a wrong one. Worth knowing; not worth changing the state shape
 * for.
 */
export function schemeEventsFor(view, teamId) {
  const team = teamOf(view, teamId);
  if (!team) return [];
  const current = view.currentPeriod;
  const KINDS = ["block", "steal", "steal-failed", "redraw", "warning"];

  return (view.activityLog || [])
    .filter(
      (e) =>
        KINDS.includes(e.type) &&
        e.period?.type === current?.type &&
        e.period?.number === current?.number &&
        typeof e.text === "string" &&
        e.text.includes(team.name)
    )
    .map((e) => e.text);
}

/**
 * Everything one message needs, or null when this team has nothing to be told.
 *
 * NULL IS A REAL ANSWER AND THE CALLER MUST RESPECT IT. A team with no roster for this
 * period was not dealt into it - in the playoffs that means knocked out, and issue #57
 * records the decision that a knocked-out team hears nothing further rather than
 * receiving an email about a week it is not playing.
 */
export function factsFor(kind, view, teamId, now = Date.now(), extra = {}) {
  const team = teamOf(view, teamId);
  if (!team) return null;
  const label = periodLabel(view.currentPeriod);

  if (kind === "week_dealt") {
    if (!team.roster) return null;
    return {
      teamName: team.name,
      periodLabel: label,
      recap: recapFor(view, teamId),
      roster: STARTER_SLOTS.map((slot) => rosterLine(view, slot, team.roster.starters[slot])),
      deadline: deadlineWords(view, now),
    };
  }

  if (kind === "schemes_processed") {
    if (!team.roster) return null;
    return {
      teamName: team.name,
      periodLabel: label,
      events: schemeEventsFor(view, teamId),
      lock: lockWords(view, now),
    };
  }

  if (kind === "scheme_reminder") {
    /* Same view and the SAME deadline sentence the dealt email carried, lower-cased to
     * sit mid-sentence. Two wordings of one deadline is how a league ends up with two
     * beliefs about when its week closes.
     *
     * `hoursLeft` is measured by the caller against the real deadline rather than
     * assumed to be twelve: the hourly job may fire at any point inside the window, and
     * an email that says twelve hours when there are four is worse than one that says
     * four. */
    if (!team.roster) return null;
    return {
      teamName: team.name,
      periodLabel: label,
      hoursLeft: extra.hoursLeft ?? 12,
      deadline: deadlineWords(view, now).replace(/^Schemes close /, "schemes close "),
    };
  }

  throw new Error("unknown notification kind: " + kind);
}
