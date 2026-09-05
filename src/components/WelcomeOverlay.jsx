/* Pigskin Poker - the first thing you see in a league you have just joined or made.
 *
 * Issues #24 and #26 are the same dead end from the two ends of the league: a new
 * commissioner lands on an empty standings table, a new manager lands on everybody's
 * zeroes, and neither screen says what happens next or who does it. #26 asked for these
 * to look like ONE mechanism rather than two if both shipped, so they are one component
 * with two sets of words.
 *
 * Deliberately short. The long-form version is the Help tab and this links to it rather
 * than restating it - the overlay's whole job is the single next move, plus the two
 * things people get wrong about the lock (see LOCK COPY below).
 *
 * ---------------------------------------------------------------------------
 * LOCK COPY - read before editing those two sentences.
 * ---------------------------------------------------------------------------
 * There are two locks here and they are NOT the same thing:
 *
 *   - THE SCHEME DEADLINE is somebody's decision, not a time. "Lock Rosters for the
 *     Weekend" (one switch, whole league) closes SCHEME submission - MyTeamTab.jsx reads
 *     state.rosterLocked for exactly that, and stats.jsx is the button. Nothing in the
 *     app closes schemes on a clock, so this half must never promise a weekday.
 *   - THE LINEUP LOCK does fire on a clock, since 2026-09-05, and WHICH clock is a
 *     league option (OQ-11, src/engine/lineupLock.js): `gametime` freezes each player at
 *     his own kickoff, `weekly` freezes every lineup at the week's first one. The
 *     commissioner can still freeze a player by hand, and that always wins.
 *
 * So lineup swaps outlive the scheme deadline, and the words below have to say which
 * lineup rule THIS league plays rather than picking one. The Rules tab does the same
 * thing under "Lineup Lock & Injury Swaps"; this card must not drift from it, and must
 * not invent a weekday of its own - `weekly` names the week's first kickoff, whatever
 * day that turns out to be.
 */

import { useState } from "react";
import { LINEUP_LOCK, lineupLockMode } from "../engine/index.js";
import { nextStep } from "./guidance.js";

export function WelcomeOverlay({ state, role, team, leagueName, alreadyMember, onDismiss, onGoTo }) {
  const [closing, setClosing] = useState(false);
  const step = nextStep(state, role, team);
  const isCommissioner = role === "commissioner";

  const close = () => {
    setClosing(true);
    onDismiss();
  };
  if (closing) return null;

  return (
    <div
      className="pp-overlay"
      /* #26 asked for a real close affordance AND a background tap, because an overlay
       * that can trap someone on a phone is worse than no overlay. */
      onClick={close}
    >
      <div className="pp-overlay-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Welcome">
        <button className="pp-overlay-x" onClick={close} aria-label="Close">x</button>

        <h2 className="pp-h2" style={{ marginBottom: 4 }}>
          {isCommissioner ? "Your league is live" : alreadyMember ? "You are already in" : "You are in"}
        </h2>
        <p className="pp-sub" style={{ marginBottom: 12 }}>
          {leagueName}
          {team ? " - you are " + team.name : isCommissioner ? " - you are the commissioner" : ""}.
        </p>

        <div className="pp-overlay-step">
          <div className="pp-overlay-step-head">{step.headline}</div>
          <p className="pp-sub" style={{ marginBottom: 0 }}>{step.detail}</p>
        </div>

        {isCommissioner ? <CommissionerBasics state={state} /> : <ManagerBasics state={state} />}

        <div className="pp-overlay-actions">
          {step.tab ? (
            <button className="pp-btn pp-btn-gold" onClick={() => { onGoTo(step.tab); close(); }}>
              {step.tab === "myteam" ? "Go to My Team" : "Go to Commissioner"}
            </button>
          ) : null}
          <button className="pp-btn" onClick={() => { onGoTo("help"); close(); }}>How this works</button>
          <button className="pp-btn pp-btn-ghost" onClick={close}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

/* Three bullets, not thirty. Each one is something people get wrong on their first week
 * and cannot discover from the screen they are looking at. */
function ManagerBasics({ state }) {
  const weekly = lineupLockMode(state) === LINEUP_LOCK.WEEKLY;
  return (
    <ul className="pp-rule-list pp-overlay-list">
      <li><strong>Fresh roster every week.</strong> 12 random players - 6 starters (Coach, QB, WR, RB, TE, FLEX) and 6 bench. Nothing carries over, so a bad week is only a week.</li>
      <li><strong>One scheme per week.</strong> Block protects a starter, Steal takes an unprotected starter off another team, Redraw swaps a player for a random free agent. No Action is a real choice, and it is what you get if you submit nothing.</li>
      {weekly ? (
        <li><strong>Your lineup closes at the week's first kickoff.</strong> Usually Thursday night. Schemes close earlier, when your commissioner processes the week - so do both while you are thinking about it.</li>
      ) : (
        <li><strong>Each player locks when his own game starts.</strong> So you can keep changing your lineup all Sunday, using anyone who has not kicked off yet. Schemes close separately, when your commissioner processes the week.</li>
      )}
      <li><strong>Only starters score.</strong> Bench players never score, whatever they do on Sunday.</li>
    </ul>
  );
}

function CommissionerBasics({ state }) {
  const weekly = lineupLockMode(state) === LINEUP_LOCK.WEEKLY;
  return (
    <ul className="pp-rule-list pp-overlay-list">
      <li><strong>The week is a cycle you drive.</strong> Deal rosters, let managers submit schemes, process the schemes, lock the rosters, enter stats, finalize. Nothing advances on its own.</li>
      <li><strong>Set up once.</strong> Teams, then invites, then - if you want them - the player pool, the scoring rates and the NFL week. All of it lives under Commissioner.</li>
      <li><strong>The scheme deadline is yours to press.</strong> "Lock Rosters for the Weekend" closes scheme submission, and nothing does that on a clock. {weekly ? "Lineups close on their own at the week's first kickoff, because that is the rule your league is set to." : "Lineups close on their own too - each player when his own game starts."} You can freeze any player by hand as well, and that always wins.</li>
      <li><strong>Finalize ends the week.</strong> It scores everyone, awards standings points and opens the next week. Do it once the stats are right.</li>
    </ul>
  );
}

/* The quieter, permanent version of the same sentence. #26 asked for this specifically:
 * someone who dismissed the card, or joined months ago, should not be back to guessing.
 * It renders on My Team and on the Scoreboard, and it is one line plus a link. */
export function NextStepNote({ state, role, team, onGoTo }) {
  const step = nextStep(state, role, team);
  return (
    <div className="pp-nextstep">
      <span className="pp-nextstep-label">Next</span>
      <span className="pp-nextstep-text">{step.headline}</span>
      <button className="pp-nextstep-link" onClick={() => onGoTo("help")}>Help</button>
    </div>
  );
}
