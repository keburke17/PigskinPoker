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
 * There is NO automatic roster freeze in this game. No Thursday cutoff, no kickoff
 * timer, no scheme deadline on a clock. Both locks are things the commissioner presses:
 *
 *   - "Lock Rosters for the Weekend" (one switch, whole league) closes SCHEME
 *     submission - src/components/MyTeamTab.jsx reads state.rosterLocked for exactly
 *     that, and src/components/stats.jsx:238 is the button.
 *   - A per-player lock, pressed as each real game kicks off, is what freezes an
 *     individual starter - src/components/lineup.jsx disables the swap for a locked
 *     player only.
 *
 * So lineup swaps outlive the scheme deadline, and both are somebody's decision rather
 * than a time. The Rules tab already says this correctly under "Lineup Lock & Injury
 * Swaps"; this card must not drift from it, and must not invent a weekday.
 */

import { useState } from "react";
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

        {isCommissioner ? <CommissionerBasics /> : <ManagerBasics />}

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
function ManagerBasics() {
  return (
    <ul className="pp-rule-list pp-overlay-list">
      <li><strong>Fresh roster every week.</strong> 12 random players - 6 starters (Coach, QB, WR, RB, TE, FLEX) and 6 bench. Nothing carries over, so a bad week is only a week.</li>
      <li><strong>One scheme per week.</strong> Block protects a starter, Steal takes an unprotected starter off another team, Redraw swaps a player for a random free agent. No Action is a real choice, and it is what you get if you submit nothing.</li>
      <li><strong>Nothing locks on a clock.</strong> Your commissioner closes schemes when they process the week, and freezes each player as their real game kicks off. Until then you can keep changing both.</li>
      <li><strong>Only starters score.</strong> Bench players never score, whatever they do on Sunday.</li>
    </ul>
  );
}

function CommissionerBasics() {
  return (
    <ul className="pp-rule-list pp-overlay-list">
      <li><strong>The week is a cycle you drive.</strong> Deal rosters, let managers submit schemes, process the schemes, lock the rosters, enter stats, finalize. Nothing advances on its own.</li>
      <li><strong>Set up once.</strong> Teams, then invites, then - if you want them - the player pool, the scoring rates and the NFL week. All of it lives under Commissioner.</li>
      <li><strong>Locking is yours to press.</strong> There is no automatic freeze. "Lock Rosters for the Weekend" closes scheme submission; locking a player individually is how you stop lineup changes once their game starts.</li>
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
