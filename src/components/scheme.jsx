/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1273-1357.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { useEffect, useState } from "react";
import {
  POSITIONS,
  SCHEME_POSITIONS,
  getPlayer,
  nowStamp,
  periodLabel,
  playerLabel,
  teamRosterPlayerIds,
} from "../engine/index.js";
import { EmptyState } from "./atoms.jsx";

export function eligibleBenchForSlot(state, team, slot) {
  return team.roster.bench
    .map((pid, idx) => ({ pid, idx, player: getPlayer(state, pid) }))
    .filter((b) => b.player && (slot === "FLEX" ? (b.player.position === "WR" || b.player.position === "RB") : b.player.position === slot));
}

export function SchemeForm({ state, team, onSubmit, disabled, disabledReason }) {
  const existing = state.schemes[team.id];
  const [type, setType] = useState(existing ? existing.type : "noaction");
  const [position, setPosition] = useState(existing ? existing.position : "");
  const [playerId, setPlayerId] = useState(existing ? existing.playerId : "");

  useEffect(() => {
    setType(existing ? existing.type : "noaction");
    setPosition(existing ? existing.position : "");
    setPlayerId(existing ? existing.playerId : "");
    // eslint-disable-next-line
  }, [existing && existing.type, existing && existing.playerId, team.id, state.currentPeriod.number, state.currentPeriod.type]);

  if (!team.roster) return <EmptyState>No roster dealt yet this period - nothing to schedule.</EmptyState>;

  const rosterIds = teamRosterPlayerIds(team);
  const candidatePlayers = (type === "block" ? POSITIONS.concat(["FLEX"]).map((s) => team.roster.starters[s]).filter(Boolean) : rosterIds)
    .map((pid) => getPlayer(state, pid))
    .filter((p) => p && position && p.position === position);

  const canSubmit = type === "noaction" || (position && playerId);

  return (
    <div>
      {disabled ? <p className="pp-sub" style={{ color: "#ff9a90" }}>{disabledReason}</p> : null}
      <div className="pp-field">
        <label className="pp-label">Play Scheme</label>
        <select className="pp-select" value={type} disabled={disabled} onChange={(e) => { setType(e.target.value); setPosition(""); setPlayerId(""); }}>
          <option value="noaction">No Action</option>
          <option value="block">Block - protect a starter</option>
          <option value="steal">Steal - take from another team</option>
          <option value="redraw">Redraw - drop for a random replacement</option>
        </select>
      </div>
      {type !== "noaction" && (
        <>
          <div className="pp-field">
            <label className="pp-label">Position</label>
            <select className="pp-select" value={position} disabled={disabled} onChange={(e) => { setPosition(e.target.value); setPlayerId(""); }}>
              <option value="">Choose a position...</option>
              {SCHEME_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {position && (
            <div className="pp-field">
              <label className="pp-label">{type === "block" ? "Starter to protect" : "Player to drop"}</label>
              <select className="pp-select" value={playerId || ""} disabled={disabled} onChange={(e) => setPlayerId(e.target.value)}>
                <option value="">Choose a player...</option>
                {candidatePlayers.map((p) => <option key={p.id} value={p.id}>{playerLabel(p)}</option>)}
              </select>
              {candidatePlayers.length === 0 ? <p className="pp-sub">No eligible {position}s on your roster{type === "block" ? " starting lineup" : ""}.</p> : null}
            </div>
          )}
        </>
      )}
      <button
        className="pp-btn pp-btn-gold"
        disabled={disabled || !canSubmit}
        onClick={() => onSubmit({ type, position: type === "noaction" ? null : position, playerId: type === "noaction" ? null : playerId, submittedAt: nowStamp() })}
      >
        {existing ? "Update Scheme" : "Submit Scheme"}
      </button>
    </div>
  );
}

export function SchemeSummary({ state, team }) {
  const sc = state.schemes[team.id];
  if (!sc) return null;
  const player = getPlayer(state, sc.playerId);
  const label = periodLabel(state.currentPeriod);
  let text;
  if (sc.type === "block") text = "Your submitted scheme for " + label + ": Block - protecting " + (player ? player.name : "?") + ".";
  else if (sc.type === "steal") text = "Your submitted scheme for " + label + ": Steal " + sc.position + " - dropping " + (player ? player.name : "?") + ".";
  else if (sc.type === "redraw") text = "Your submitted scheme for " + label + ": Redraw " + sc.position + " - dropping " + (player ? player.name : "?") + ".";
  else text = "Your submitted scheme for " + label + ": No Action.";
  return <div className="pp-scheme-summary">{text}</div>;
}

