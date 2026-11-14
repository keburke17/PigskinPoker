/* THE SEASON / WEEKLY BADGE AND THE WEEK TRACKER (Scott, 2026-11-14).
 *
 * Both came out of the Full Season colour rounds: he wanted a season league and a Weekly
 * table to be told apart at a glance, and on seeing the mockups asked for the badge and
 * the tracker in BOTH games. The colour does most of that job; these two say it in words.
 *
 * - The badge is a flat tag after the league name: SEASON or WEEKLY, in the game's accent.
 * - The tracker is the 18 NFL weeks under the header. A season shows where the playoffs
 *   sit (outlined boxes); a table has no playoffs, so its bar just counts along.
 *
 * DISPLAY ONLY. Nothing here decides anything: the playoff weeks come from
 * `playoffWeekSpan`, the same arithmetic the commissioner's Playoffs panel shows him, and
 * the current week from `_meta.nflWeek`, which the server owns. A league with no NFL week
 * mapped yet gets the words without the bar, rather than a bar that guesses.
 *
 * Last Digit gets neither - it is its own game with its own look, and App.jsx does not
 * draw these there.
 */
import { CP, isTable, periodTitle, playoffWeekSpan } from "../engine/index.js";

const REGULAR_SEASON_WEEKS = 18;
const DOT = " " + CP(0x00b7) + " ";

/** SEASON or WEEKLY, after the league's name. */
export function ModeBadge({ state }) {
  return <span className="pp-mode-badge">{isTable(state) ? "Weekly" : "Season"}</span>;
}

/** Where the year is: which week this is, and - in a season - when the playoffs come. */
export function LeagueTracker({ state }) {
  const table = isTable(state);
  const period = state.currentPeriod || { type: "week", number: 1, phase: "pre-deal" };
  const nfl = Number(state._meta ? state._meta.nflWeek : NaN);
  const hasNfl = Number.isFinite(nfl) && nfl > 0;

  const cfg = state.playoffConfig || {};
  const span = table ? null : playoffWeekSpan(cfg.startNflWeek, cfg.advancement);
  const lastWeek = Math.max(REGULAR_SEASON_WEEKS, span ? span.lastWeek : 0);

  /* "Week 3 of 18" when the league's week and the NFL's agree; when a league joined late
   * its week 3 can be NFL week 5, and both are said rather than one being wrong. */
  const title = periodTitle(state, period);
  let detail = "";
  if (hasNfl) {
    const sameNumber = period.type === "week" && period.number === nfl && !table;
    detail = sameNumber ? " of " + lastWeek : DOT + "NFL Week " + nfl + " of " + lastWeek;
  }

  let right;
  if (table) {
    const played = period.phase === "finalized" ? period.number : period.number - 1;
    right = played === 1 ? "1 hand played" : played + " hands played";
  } else if (cfg.completed) {
    right = "Season over";
  } else if (cfg.started) {
    right = "Playoffs";
  } else if (span) {
    right = "Playoffs start Week " + span.firstWeek;
  } else {
    right = "Playoff week not set";
  }

  const ticks = [];
  if (hasNfl) {
    for (let w = 1; w <= lastWeek; w++) {
      const playoff = !!span && w >= span.firstWeek && w <= span.lastWeek;
      const cls = w < nfl ? "done" : w === nfl ? "now" : playoff ? "po" : "";
      ticks.push(<i key={w} className={"pp-track-tick " + cls + (playoff ? " playoff" : "")} />);
    }
  }

  return (
    <div className="pp-track">
      <div className="pp-track-line">
        <span><b>{title}</b>{detail}</span>
        <span>{right}</span>
      </div>
      {ticks.length ? (
        <div
          className="pp-track-ticks"
          style={{ gridTemplateColumns: "repeat(" + lastWeek + ", 1fr)" }}
          role="img"
          aria-label={"NFL week " + nfl + " of " + lastWeek + (span ? ", playoffs weeks " + span.firstWeek + " to " + span.lastWeek : "")}
        >
          {ticks}
        </div>
      ) : null}
    </div>
  );
}
