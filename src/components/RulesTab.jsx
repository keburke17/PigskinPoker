/* Pigskin Poker UI - the Rules tab.
 *
 * Originally extracted verbatim from LegacyProject/PigskinPokerCode.jsx lines 1716-1815,
 * then grown card by card (2026-08-28 to 2026-10-26) every time a rule moved, until it was
 * eight cards long, repeated itself, and spent a card on how the player pool is refreshed.
 *
 * REBUILT 2026-10-27, Scott's design (mockup round "C - Quick version"): the whole game in
 * a few numbered lines, then five sections that open on a tap - Scoring, Schemes, Roster,
 * Standings & tiebreakers, Playoffs. It is written for someone PLAYING the league, so it
 * says what this league does and leaves out what only the commissioner or the admins need
 * (the pool refresh, the coach list, how ties inside a week are scored). Help carries the
 * how-to; docs/RULES.md is still the long form.
 *
 * Every number and time is read from this league's settings - scoring rates, the clock,
 * the lock rule, the team count, the playoff config - so two leagues read differently.
 * A table (issue #75) has no standings ladder and no playoffs, and says so. */

import { useState } from "react";
import {
  ARROW,
  DEFAULT_SCORING,
  LINEUP_LOCK,
  TOP_OF_CHART_WEIGHT,
  advanceDeadlineWords,
  autoAdvanceWeek,
  autoProcessSchemes,
  currentStandingsPointsArray,
  firstKickoff,
  formatKickoff,
  isTable,
  kickoffsFor,
  lineupLockMode,
  schemeDeadlineWords,
} from "../engine/index.js";

/* Still used by the Help tab. */
export function RuleCard({ title, children }) {
  return (
    <div className="pp-card pp-card-tight" style={{ marginBottom: 10 }}>
      <h3 className="pp-h3">{title}</h3>
      <ul className="pp-rule-list">{children}</ul>
    </div>
  );
}

const TIEBREAKERS = ["standings points", "week wins", "coach wins", "total TDs", "total yards", "best single-player week"];

function oddsWords(weight) {
  return weight === 2 ? "twice as likely" : weight + " times as likely";
}

export function RulesTab({ state }) {
  /* Merged over the defaults so a league whose config predates the 2026-08-28 split
   * still reads out real numbers rather than blanks - the same fallback the engine
   * uses when it scores. */
  const cfg = Object.assign({}, DEFAULT_SCORING, state.scoringConfig);
  const table = isTable(state);
  const word = table ? "hand" : "week";
  const boss = table ? "dealer" : "commissioner";
  const teamCount = state.teams.length || 0;
  const ladder = currentStandingsPointsArray(state, teamCount || 1);
  const pc = state.playoffConfig || {};
  const weekly = lineupLockMode(state) === LINEUP_LOCK.WEEKLY;
  const first = firstKickoff(kickoffsFor(state));
  const schemeClock = autoProcessSchemes(state);
  const dealClock = autoAdvanceWeek(state);
  const [open, setOpen] = useState("scoring");

  const yardsSummary = cfg.rushYardsPerPoint === cfg.recYardsPerPoint
    ? cfg.passYardsPerPoint + " pass yds / " + cfg.rushYardsPerPoint + " rush-rec yds a point"
    : cfg.passYardsPerPoint + " pass / " + cfg.rushYardsPerPoint + " rush / " + cfg.recYardsPerPoint + " rec yds a point";

  let playoffSummary = null;
  let playoffLine = null;
  if (!table) {
    if (pc.started) {
      playoffSummary = "Underway - " + pc.bracketSize + " teams";
      playoffLine = <>The playoffs are underway: <strong>{pc.bracketSize}</strong> teams, {pc.advancement.join(" " + ARROW + " ")}.</>;
    } else if (pc.startNflWeek != null) {
      playoffSummary = "Top " + pc.bracketSize + ", NFL Week " + pc.startNflWeek;
      playoffLine = <>Top <strong>{pc.bracketSize}</strong> make the playoffs in <strong>NFL Week {pc.startNflWeek}</strong>.</>;
    } else {
      playoffSummary = "No start week set yet";
      playoffLine = <>Playoffs: your commissioner has not set a start week yet.</>;
    }
  }

  const quick = [
    dealClock
      ? <>Every <strong>{advanceDeadlineWords(state)}</strong> you&apos;re dealt a new <strong>random</strong> 12-man roster.</>
      : <>Every {word} your {boss} deals you a new <strong>random</strong> 12-man roster.</>,
    schemeClock
      ? <>Pick one scheme - Block, Steal or Redraw. Schemes process <strong>{schemeDeadlineWords(state)}</strong>.</>
      : <>Pick one scheme - Block, Steal or Redraw. Schemes process when your {boss} runs them.</>,
    <>To Steal or Redraw, you <strong>drop a player at the same position</strong> you&apos;re going after. Drop a WR, get a WR.</>,
    <>Who you steal is <strong>random</strong>. Who you redraw is <strong>random</strong>. Blocks go first, then every steal and redraw runs in a <strong>random order</strong>.</>,
    weekly
      ? <>Set your 6 starters. Every lineup locks at <strong>the {word}&apos;s first kickoff</strong>.</>
      : <>Set your 6 starters. Each locks at <strong>his own kickoff</strong>.</>,
    table
      ? <>Top score <strong>wins the hand</strong>. The table keeps a tally of hands won and lost.</>
      : <>Win the week for <strong>{ladder[0]} standings point{ladder[0] === 1 ? "" : "s"}</strong>; last place gets 1.</>,
    playoffLine,
  ].filter(Boolean);

  const sections = [
    {
      id: "scoring",
      title: "Scoring",
      summary: yardsSummary,
      body: [
        "Passing: 1 pt per " + cfg.passYardsPerPoint + " yards, " + cfg.pointsPerPassTD + " per TD",
        "Rushing: 1 pt per " + cfg.rushYardsPerPoint + " yards, " + cfg.pointsPerRushTD + " per TD",
        "Receiving: 1 pt per " + cfg.recYardsPerPoint + " yards, " + cfg.pointsPerRecTD + " per TD",
        "Head coach: Win " + cfg.coachWin + ", Tie " + cfg.coachTie + ", Loss " + cfg.coachLoss + " - his NFL team's result",
        "Partial yards count (58 yds at 1 per 10 = 5.8). Bench never scores.",
        "Return yards, two-point conversions and fumble-recovery TDs score nothing.",
      ],
    },
    {
      id: "schemes",
      title: "Schemes",
      summary: "Block, Steal or Redraw - " + (schemeClock ? "process " + schemeDeadlineWords(state) : "one a " + word),
      body: [
        <><strong>Block</strong> - protect one starter from steals.</>,
        <><strong>Steal</strong> - drop a player, take a random unblocked starter at that same position from another team.</>,
        <><strong>Redraw</strong> - drop a player, get a random free agent at that same position.</>,
        "You always drop the position you're going after - drop an RB, get an RB.",
        "Blocks run first. Then every steal and redraw runs in a random order, so picking early gets you nothing.",
        "Coaches can't be schemed. Nobody sees your pick.",
        schemeClock ? "Nothing in by " + schemeDeadlineWords(state) + " means No Action." : null,
      ],
    },
    {
      id: "roster",
      title: "Roster",
      summary: "6 starters, 6 bench - max 2 QB, TE, HC",
      body: [
        "Starters: HC, QB, WR, RB, TE, FLEX",
        "Bench: one more of each, plus one more WR or RB",
        <>Max <strong>2 QBs, 2 TEs and 2 coaches</strong> per roster.</>,
        <>FLEX is always dealt a WR or RB, but you can <strong>start a TE there</strong> - so you can play both your TEs.</>,
        "Each NFL team's top healthy RB and WR is " + oddsWords(TOP_OF_CHART_WEIGHT) + " to be dealt.",
        "Players on a bye, OUT or IR aren't dealt.",
        "Swaps go through the bench.",
        weekly
          ? "Every lineup locks at the " + word + "'s first kickoff" + (first ? " - " + formatKickoff(first) + "." : ".")
          : "Each player locks when his own game kicks off, so a Sunday-night starter can still come in at 7pm.",
        "Your " + boss + " can also lock a player by hand - for a late scratch, say.",
      ],
    },
    table
      ? {
          id: "standings",
          title: "Winning a hand",
          summary: "Top score takes it",
          body: [
            "The top score wins the hand.",
            "The table keeps a tally of hands won and lost - no standings points, no playoffs.",
          ],
        }
      : {
          id: "standings",
          title: "Standings & tiebreakers",
          summary: ladder[0] + " for a win, down to 1",
          body: [
            "Weekly finish pays " + ladder.join(", ") + ". Ties share the higher number.",
            "Your season is the sum of those points.",
            "Tiebreakers: " + TIEBREAKERS.join(", ") + ".",
          ],
        },
    table
      ? null
      : {
          id: "playoffs",
          title: "Playoffs",
          summary: playoffSummary,
          body: [
            pc.started || pc.startNflWeek == null
              ? null
              : "Top " + pc.bracketSize + " after the regular season. Starts NFL Week " + pc.startNflWeek + ".",
            pc.startNflWeek == null && !pc.started
              ? "Your commissioner sets the start week; until then there are no playoffs."
              : (pc.advancement || []).join(" teams, then ") + (pc.advancement && pc.advancement[pc.advancement.length - 1] === 1 ? " champion." : " teams."),
            "Same weekly cycle, scored round by round.",
            "Miss the cut and your season is over.",
          ],
        },
  ].filter(Boolean);

  return (
    <div>
      <div className="pp-rules-head">
        <h2 className="pp-h2" style={{ marginBottom: 2 }}>The game in 60 seconds</h2>
        {state.leagueName ? <div className="pp-sub">{state.leagueName}</div> : null}
      </div>

      <div className="pp-card pp-card-tight">
        <ol className="pp-rules-quick">
          {quick.map((line, i) => (
            <li key={i}>
              <span className="pp-rules-num">{i + 1}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="pp-eyebrow pp-rules-eyebrow">The details - tap to open</div>

      {sections.map((s) => {
        const isOpen = open === s.id;
        return (
          <div key={s.id} className="pp-card pp-rules-section">
            <button
              type="button"
              className="pp-rules-toggle"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : s.id)}
            >
              <span>
                <span className="pp-rules-title">{s.title}</span>
                <span className="pp-rules-summary">{s.summary}</span>
              </span>
              <span className="pp-rules-mark" aria-hidden="true">{isOpen ? "-" : "+"}</span>
            </button>
            {isOpen ? (
              <ul className="pp-rules-body">
                {s.body.filter(Boolean).map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
