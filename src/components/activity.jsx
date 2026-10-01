/* The week's action.
 *
 * WHY THIS EXISTS. Picking a scheme and then finding out what it did to you is the best
 * moment in the game, and seeing what it did to everyone else is half the fun of the
 * week. That was filed three taps down - open the app on the Week screen, tap League,
 * tap Activity, third sub-tab behind a table nobody came for - and it arrived as grey
 * 13px prose with every week ever stacked in one list. Scott's call on 2026-09-08
 * (OQ-20): it belongs on the week screen, under your own card, ahead of the league
 * table.
 *
 * ONE ROW, TWO SCREENS. `ActivityEvent` is the single row implementation; the week card
 * here and the full log on League -> Activity both draw it, so the two cannot drift.
 * The full log keeps its own job - every week, oldest at the bottom - and is where the
 * "All weeks" link goes.
 *
 * WHAT THE LOG ACTUALLY CARRIES, and why this file works the way it does. An entry is
 * { id, period, periodLabel, ts, type, text } and nothing else - no acting team, no
 * player ids, no structured fields at all. The prose is written by the engine, and it
 * cannot be enriched from here for two separate reasons:
 *
 *   1. `tests/parity.test.js` compares whole states field for field against the
 *      artifact after processSchemes. Adding a key to an entry IS an engine change and
 *      would fail it.
 *   2. `decompose.js` persists only `type` and `text` (payload is written empty), so a
 *      new field would not survive a save and reload even if the engine wrote one.
 *
 * So the chip comes from `type`, which is real and reliable, and the sentence is the
 * engine's own words, verbatim. The one soft edge is marking the rows that are YOURS:
 * with no team id on an entry, this matches your team's name inside the text. A miss
 * leaves a row untinted and a false positive tints one that only mentions you - neither
 * is worse than the flat grey list this replaces. Giving the log real fields is worth
 * doing one day; it is an engine change and an OQ, not a thing to sneak in here.
 */

import { ICON } from "../engine/index.js";

/* The chip is the whole point of the redesign: colour tells you which scheme fired
 * before you have read a word. Types that are not a manager's action - a finalized
 * week, the clock, a warning - get a quieter chip rather than none, so every row keeps
 * the same shape and the list reads as one column. */
const CHIP = {
  block: { label: "Block", cls: "pp-chip-block" },
  steal: { label: "Steal", cls: "pp-chip-steal" },
  "steal-failed": { label: "No target", cls: "pp-chip-quiet" },
  redraw: { label: "Redraw", cls: "pp-chip-redraw" },
  result: { label: "Final", cls: "pp-chip-result" },
  warning: { label: "Heads up", cls: "pp-chip-quiet" },
  "playoffs-start": { label: "Playoffs", cls: "pp-chip-result" },
  advance: { label: "Advance", cls: "pp-chip-result" },
  champion: { label: "Champion", cls: "pp-chip-result" },
  auto: { label: "Clock", cls: "pp-chip-quiet" },
};

export function chipFor(type) {
  return CHIP[type] || null;
}

/* Unchanged from the version that lived in standings.jsx - the same glyph for the same
 * type, so the full log looks like it always did apart from the chip beside it. */
export function iconFor(type) {
  return (
    {
      steal: ICON.football,
      "steal-failed": ICON.warn,
      redraw: ICON.redraw,
      block: ICON.shield,
      result: ICON.flag,
      warning: ICON.warn,
      "playoffs-start": ICON.trophy,
      advance: ICON.forward,
      champion: ICON.trophy,
      auto: ICON.clock,
    }[type] || "*"
  );
}

/** Does this entry mention the given team? See the note at the top of the file: the log
 *  has no team id, so a name match is the only signal available. Exported so the
 *  heuristic is testable on its own rather than only through a rendered row. */
export function mentionsTeam(entry, teamName) {
  if (!entry || !teamName) return false;
  return String(entry.text || "").indexOf(teamName) !== -1;
}

/** The events belonging to one period, newest first. Compared on type AND number
 *  because a regular Week 3 and Playoff Round 3 are different periods with the same
 *  number. */
export function eventsForPeriod(activityLog, period) {
  if (!period) return [];
  return (activityLog || [])
    .filter((e) => e.period && e.period.type === period.type && e.period.number === period.number)
    .slice()
    .reverse();
}

export function ActivityEvent({ entry, myTeamName }) {
  const chip = chipFor(entry.type);
  const mine = mentionsTeam(entry, myTeamName);
  return (
    <div className={"pp-ev" + (mine ? " pp-ev-mine" : "")}>
      <span className="pp-ev-glyph">{iconFor(entry.type)}</span>
      <p className="pp-ev-line">
        {chip ? <span className={"pp-chip " + chip.cls}>{chip.label}</span> : null}
        {entry.text}
      </p>
    </div>
  );
}

/** The card on the Week screen: this period only, newest first.
 *
 *  It draws nothing before the deal because WeekScoreboard returns early there, and it
 *  says so plainly rather than hiding once the week is dealt but no schemes have
 *  resolved - "nothing yet" is the answer to "did I miss anything", and hiding the card
 *  would leave that question unanswered. */
export function WeekActivityCard({ state, myTeam, onSeeAll }) {
  const entries = eventsForPeriod(state.activityLog, state.currentPeriod);
  const roundWord = state.currentPeriod.type === "playoff" ? "round" : "week";
  return (
    <div className="pp-card">
      <div className="pp-card-head">
        <h3 className="pp-h3" style={{ marginBottom: 0 }}>This {roundWord}&apos;s action</h3>
        {onSeeAll ? (
          <button type="button" className="pp-linkbtn" onClick={onSeeAll}>All weeks {ICON.caretRight}</button>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="pp-sub" style={{ margin: 0 }}>
          Nothing yet this {roundWord}. Blocks, steals and redraws appear here the moment
          schemes are processed.
        </p>
      ) : (
        entries.map((entry) => (
          <ActivityEvent key={entry.id} entry={entry} myTeamName={myTeam ? myTeam.name : null} />
        ))
      )}
    </div>
  );
}
