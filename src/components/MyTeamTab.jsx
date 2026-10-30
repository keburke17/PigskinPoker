/* Pigskin Poker UI - your own team.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 1419-1473. Changed twice since:
 * your score sits beside your team name and your starters carry their points, which this
 * screen showed nowhere at all before issue #29; and a bench row is LOCKED under the
 * league's lineup-lock policy as well as the commissioner's own lock, with the screen
 * ticking so that happens at kickoff rather than at the next reload.
 */

import { useState } from "react";
import { LINEUP_LOCK, lineupLockMode, teamPeriodScore } from "../engine/index.js";
import { PeriodBanner } from "./atoms.jsx";
import { LineupEditor } from "./lineup.jsx";
import { SchemeForm } from "./scheme.jsx";
import { NextStepNote } from "./WelcomeOverlay.jsx";

export function MyTeamTab({ state, team, onSwap, onMoveStarter, onSubmitScheme, onRename, onGoTo }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(team.name);
  const dealt = state.currentPeriod.phase !== "pre-deal";
  const schemeDisabled = !team.roster || state.rosterLocked;
  /* Both of these used to stop at the fact and leave the person to guess what it meant
   * (issue #26): "No roster dealt yet." never said a roster was coming or who deals it,
   * and the locked message never said that LINEUP swaps are a separate thing that stays
   * open. Nothing here changes when the form is disabled - only what it says.
   *
   * WHAT IT SAYS ABOUT SWAPS DEPENDS ON THE LEAGUE now. "You can still swap any player
   * whose game has not started" is true under `gametime` and simply wrong under
   * `weekly`, where the whole lineup closed at the week's first kickoff - and a manager
   * who believes the wrong one of those loses a week finding out. */
  const swapNote =
    lineupLockMode(state) === LINEUP_LOCK.WEEKLY
      ? " Lineup changes close at this week's first kickoff, so check the lineup above while you are here."
      : " You can still swap any player whose real game has not started.";
  const disabledReason = !team.roster
    ? "No roster dealt yet. Your commissioner deals every team a fresh 12-player roster - once they do, you set your lineup and pick a scheme here."
    : state.rosterLocked
    ? "Rosters are locked for this " + (state.currentPeriod.type === "playoff" ? "round" : "week") + " - scheme submission is closed." + swapNote
    : null;

  return (
    <div>
      <PeriodBanner state={state} extra={state.rosterLocked ? "Rosters locked for the weekend" : null} />
      {/* The permanent half of the welcome card (issue #26) - for the person who
        * dismissed it, or who joined three months ago and is back on a Thursday. */}
      {onGoTo ? <NextStepNote state={state} role="manager" team={team} onGoTo={onGoTo} /> : null}
      <div className="pp-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          {renaming ? (
            <div style={{ display: "flex", gap: 6, flex: 1 }}>
              <input className="pp-input" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="pp-btn pp-btn-sm pp-btn-gold" onClick={() => { onRename(name); setRenaming(false); }}>Save</button>
              <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => { setRenaming(false); setName(team.name); }}>Cancel</button>
            </div>
          ) : (
            <>
              <h2 className="pp-h2" style={{ marginBottom: 0 }}>{team.name}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {dealt && team.roster ? (
                  <span className="pp-score-mid" title="Your score this period">{teamPeriodScore(state, team)}</span>
                ) : null}
                <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => setRenaming(true)}>Rename</button>
              </div>
            </>
          )}
        </div>
        {/* The scheme sentence that sat here is now the Ticket at the top of every tab
          * (schemeTicket.jsx). The one beside the Submit button stays - issue #27. */}
        <h3 className="pp-h3">Starting Lineup</h3>
        <p className="pp-sub" style={{ marginBottom: 10 }}>Tap a player's card to move him. Every place he can go lights up HERE - tap one to make the move, or tap his card again to cancel.</p>
        <LineupEditor state={state} team={team} onSwap={onSwap} onMoveStarter={onMoveStarter} showStats={dealt} />
      </div>

      <div className="pp-card">
        <h3 className="pp-h3">Play Scheme</h3>
        <SchemeForm state={state} team={team} onSubmit={(sc) => onSubmitScheme(team.id, sc)} disabled={schemeDisabled} disabledReason={disabledReason} />
      </div>
    </div>
  );
}

/* ============================== All Rosters =============================== */

