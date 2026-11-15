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
 *
 * AND SINCE ISSUE #52, THE SCHEME DEADLINE CAN BE A CLOCK AFTER ALL. A league may opt
 * into having schemes processed at a fixed hour each week and the next week dealt and
 * finalized on a Tuesday morning (OQ-14; both off by default). So the sentence above -
 * "this half must never promise a weekday" - now holds only for a league that has NOT
 * switched that on, and the words below branch on it. The named deadline comes from
 * schemeDeadlineWords()/advanceDeadlineWords() so that this card, the Help tab and the
 * server's own guard cannot disagree about when it is.
 */

import { useState } from "react";
import {
  LINEUP_LOCK,
  advanceDeadlineWords,
  autoAdvanceWeek,
  autoProcessSchemes,
  hostTitle,
  isTable,
  lineupLockMode,
  schemeDeadlineWords,
} from "../engine/index.js";
import { ICON, SUIT_CH } from "../engine/constants.js";
import { nextStep } from "./guidance.js";

export function WelcomeOverlay({ state, role, team, leagueName, alreadyMember, onDismiss, onGoTo }) {
  const [closing, setClosing] = useState(false);
  const step = nextStep(state, role, team);
  const isCommissioner = role === "commissioner";
  const table = isTable(state);

  const close = () => {
    setClosing(true);
    onDismiss();
  };
  if (closing) return null;

  /* A season commissioner gets a welcome rather than a chore list (Scott, 2026-11-14):
   * what the game is, in four lines, then "set up your league". App.jsx shows it only in
   * a league that has never been played. Deliberately says nothing about who deals,
   * processes or enters stats - those jobs are moving to the admins, and a card that
   * names them goes stale the day they do. */
  if (isCommissioner && !table) {
    return (
      <div className="pp-overlay" onClick={close}>
        <div className="pp-overlay-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Welcome">
          <button className="pp-overlay-x" onClick={close} aria-label="Close">x</button>
          <h2 className="pp-h2" style={{ marginBottom: 4 }}>Welcome to Pigskin Poker</h2>
          <p className="pp-sub" style={{ marginBottom: 12 }}>{leagueName} - you&apos;re the commissioner.</p>

          <div className="pp-welcome-label">How it plays</div>
          <ul className="pp-welcome-plays">
            <li><span className="pp-welcome-pip">12</span><span><strong>A new hand every week.</strong> Every team is dealt 12 random NFL players - 6 starters, 6 on the bench.</span></li>
            <li><span className="pp-welcome-pip">1</span><span><strong>Play one scheme.</strong> Block one of your players, Steal one from another team, or Redraw for a free agent.</span></li>
            <li><span className="pp-welcome-pip">{SUIT_CH.star}</span><span><strong>Your starters score.</strong> Real NFL games, real points. Win the week, climb the standings.</span></li>
            <li><span className="pp-welcome-pip">{ICON.trophy}</span><span><strong>Playoffs crown a champion.</strong></span></li>
          </ul>

          <div className="pp-welcome-setup">
            <div className="pp-welcome-setup-head">First, set up your league.</div>
            <p className="pp-sub" style={{ marginBottom: 0 }}>Pick your league settings, then send your invite link. That&apos;s it.</p>
          </div>

          <div className="pp-overlay-actions">
            <button className="pp-btn pp-btn-gold" onClick={() => { onGoTo("comm"); close(); }}>Set up my league</button>
            <button className="pp-btn" onClick={() => { onGoTo("rules"); close(); }}>Read the rules</button>
          </div>
        </div>
      </div>
    );
  }

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
          {isCommissioner ? (table ? "Your table is open" : "Your league is live") : alreadyMember ? "You are already in" : table ? "You have a seat" : "You are in"}
        </h2>
        <p className="pp-sub" style={{ marginBottom: 12 }}>
          {leagueName}
          {table && isCommissioner
            ? " - you deal" + (team ? ", and you play as " + team.name : "")
            : team ? " - you are " + team.name : isCommissioner ? " - you are the commissioner" : ""}.
        </p>

        <div className="pp-overlay-step">
          <div className="pp-overlay-step-head">{step.headline}</div>
          <p className="pp-sub" style={{ marginBottom: 0 }}>{step.detail}</p>
        </div>

        {isCommissioner ? <DealerBasics state={state} /> : <ManagerBasics state={state} />}

        <div className="pp-overlay-actions">
          {step.tab ? (
            <button className="pp-btn pp-btn-gold" onClick={() => { onGoTo(step.tab); close(); }}>
              {step.tab === "myteam" ? "Go to My Team" : "Go to " + hostTitle(state)}
            </button>
          ) : null}
          <button className="pp-btn" onClick={() => { onGoTo("rules"); close(); }}>How this works</button>
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
  const table = isTable(state);
  return (
    <ul className="pp-rule-list pp-overlay-list">
      {table ? (
        <li><strong>Play the hands you want.</strong> You are dealt into every hand while you are seated. Sit out from My Team to skip one and keep your seat, or leave the table and give it up - your record stays yours either way.</li>
      ) : null}
      <li><strong>Fresh roster every week.</strong> 12 random players - 6 starters (Coach, QB, WR, RB, TE, FLEX) and 6 bench. Nothing carries over, so a bad week is only a week.</li>
      <li><strong>One scheme per week.</strong> Block protects one of your players, Steal takes an unprotected player off another team's roster (bench too), Redraw swaps a player for a random free agent. No Action is a real choice, and it is what you get if you submit nothing.</li>
      {autoProcessSchemes(state) ? (
        <li><strong>Schemes close at {schemeDeadlineWords(state)}.</strong> On the clock, like waivers - not when somebody gets round to it. Miss it and you get No Action for the week.</li>
      ) : null}
      {weekly ? (
        <li><strong>Your lineup closes at the week&apos;s first kickoff.</strong> Usually Thursday night. Schemes close earlier{autoProcessSchemes(state) ? "" : ", when your " + (table ? "dealer" : "commissioner") + " processes the week"} - so do both while you are thinking about it.</li>
      ) : (
        <li><strong>Each player locks when his own game starts.</strong> So you can keep changing your lineup all Sunday, using anyone who has not kicked off yet. Schemes close separately{autoProcessSchemes(state) ? "" : ", when your " + (table ? "dealer" : "commissioner") + " processes the week"}.</li>
      )}
      <li><strong>Only starters score.</strong> Bench players never score, whatever they do on Sunday.</li>
    </ul>
  );
}

/* The dealer's version (issue #75). Same cycle as a season - it is the same engine - but
 * a table's setup is an invite rather than a team list, and a finalize records a winner
 * rather than awarding standings points. */
function DealerBasics({ state }) {
  return (
    <ul className="pp-rule-list pp-overlay-list">
      <li><strong>Each hand is a week you drive.</strong> Deal, let players submit schemes, process the schemes, lock the rosters, enter stats, finalize. {anyClock(state) ? clockSentence(state).replace(/the week is/g, "the hand is").replace(/the next one dealt/g, "the next hand dealt") : "Nothing advances on its own."}</li>
      <li><strong>A lobby, not a team list.</strong> Send one invite; everyone who redeems it joins the lobby with a team of their own. Up to your hand size is dealt in each hand, and the rest wait in line. Dealer -&gt; Lobby shows who is in, the line, who is sitting out, and who has left.</li>
      <li><strong>The door closes at the deal.</strong> Whoever is seated when you deal plays the hand. Anyone who sits down or gets up after that changes the next hand, not this one.</li>
      <li><strong>Finalize ends the hand.</strong> It scores everyone, records who won, and opens the next hand. The table keeps a tally of hands won and lost - no standings, no playoffs.</li>
    </ul>
  );
}

/* Whether anything at all in this league moves without somebody pressing a button, and
 * the one sentence that says which parts. Kept together so the overlay and the Help
 * tab's "What happens on its own" card describe the same two switches. */
function anyClock(state) {
  return autoProcessSchemes(state) || autoAdvanceWeek(state);
}

function clockSentence(state) {
  const schemes = autoProcessSchemes(state);
  const week = autoAdvanceWeek(state);
  if (schemes && week) {
    return "Schemes process at " + schemeDeadlineWords(state) + ", and the week is finalized and the next one dealt at " + advanceDeadlineWords(state) + ".";
  }
  if (schemes) return "Schemes process at " + schemeDeadlineWords(state) + "; the rest waits for you.";
  return "The week is finalized and the next one dealt at " + advanceDeadlineWords(state) + "; schemes still wait for you to process them.";
}

/* The quieter, permanent version of the same sentence. #26 asked for this specifically:
 * someone who dismissed the card, or joined months ago, should not be back to guessing.
 * It renders on My Team and on the Week screen, and it is one line plus a link. */
export function NextStepNote({ state, role, team, onGoTo }) {
  const step = nextStep(state, role, team);
  return (
    <div className="pp-nextstep">
      <span className="pp-nextstep-label">Next</span>
      <span className="pp-nextstep-text">{step.headline}</span>
      <button className="pp-nextstep-link" onClick={() => onGoTo("rules")}>Rules</button>
    </div>
  );
}
