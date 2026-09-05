/* Pigskin Poker UI - your own team.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 1419-1473. Changed since: your
 * score sits beside your team name and your starters carry their points, which this
 * screen showed nowhere at all before issue #29.
 */

import { useState } from "react";
import { getPlayer, teamPeriodScore } from "../engine/index.js";
import { PeriodBanner } from "./atoms.jsx";
import { LineupEditor } from "./lineup.jsx";
import { RosterSlotRow } from "./roster.jsx";
import { SchemeForm, SchemeSummary } from "./scheme.jsx";

export function MyTeamTab({ state, team, onSwap, onSubmitScheme, onRename }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(team.name);
  const dealt = state.currentPeriod.phase !== "pre-deal";
  const schemeDisabled = !team.roster || state.rosterLocked;
  const disabledReason = !team.roster
    ? "No roster dealt yet."
    : state.rosterLocked
    ? "Rosters are locked for this " + (state.currentPeriod.type === "playoff" ? "round" : "week") + " - scheme submission is closed."
    : null;

  return (
    <div>
      <PeriodBanner state={state} extra={state.rosterLocked ? "Rosters locked for the weekend" : null} />
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
        <SchemeSummary state={state} team={team} />
        <h3 className="pp-h3">Starting Lineup</h3>
        <p className="pp-sub" style={{ marginBottom: 10 }}>Swap a starter with an eligible bench player. Direct starter-for-starter swaps aren't allowed - route every change through the bench.</p>
        <LineupEditor state={state} team={team} onSwap={onSwap} showStats={dealt} />
        <h3 className="pp-h3" style={{ marginTop: 16 }}>Bench</h3>
        <p className="pp-sub" style={{ marginBottom: 10 }}>Not tied to any slot - swap any of these into a matching starting spot above.</p>
        {team.roster ? (
          team.roster.bench.map((pid, i) => {
            const player = getPlayer(state, pid);
            const locked = pid && (state.lockedPlayerIds || {})[pid];
            return <RosterSlotRow key={i} slot="BN" player={player} state={state} statLine={null} locked={locked} showStats={false} />;
          })
        ) : (
          [0, 1, 2, 3, 4, 5].map((i) => <RosterSlotRow key={i} slot="BN" player={null} state={state} statLine={null} locked={false} showStats={false} />)
        )}
      </div>

      <div className="pp-card">
        <h3 className="pp-h3">Play Scheme</h3>
        <SchemeForm state={state} team={team} onSubmit={(sc) => onSubmitScheme(team.id, sc)} disabled={schemeDisabled} disabledReason={disabledReason} />
      </div>
    </div>
  );
}

/* ============================== All Rosters =============================== */

