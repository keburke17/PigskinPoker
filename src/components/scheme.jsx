/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1273-1357.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited - until issue #27.
 *
 * ISSUE #27. The confirmation existed and was several screens away from the button that
 * produced it: SchemeSummary rendered at the top of the FIRST card, the submit button at
 * the bottom of the SECOND, with six starters and six bench rows in between. On a phone
 * there is no window size where both are visible, so submitting looked like nothing
 * happening. Worse, the only in-view evidence was a label reading "Update Scheme" above a
 * dropdown reading "No Action" - correct, and unreadable as confirmation.
 *
 * The fix is #27's own first option, plus its third: the summary is rendered a SECOND
 * time inside the Play Scheme card, immediately above the button, and the button now has
 * a busy state and a short-lived "Scheme submitted" acknowledgement. The original summary
 * at the top of My Team stays where the artifact put it - it is not in the way, and
 * removing it would be a layout change nobody asked for.
 */

import { useEffect, useRef, useState } from "react";
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
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const ackTimer = useRef(null);
  useEffect(() => () => clearTimeout(ackTimer.current), []);

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

  /* #27's third direction. `onSubmitScheme` is async (src/hooks/useLeague.js), and the
   * button did not disable, spin or acknowledge - so a slow save was indistinguishable
   * from a dead button, which invites a second press. `justSaved` is the short-lived
   * "taken" state; the summary below it is the durable one. */
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await onSubmit({
        type,
        position: type === "noaction" ? null : position,
        playerId: type === "noaction" ? null : playerId,
        submittedAt: nowStamp(),
      });
      /* MUST check the result, not merely that the promise settled. A rejected write
       * resolves perfectly happily with { ok: false } - the server refuses a scheme in
       * any phase but `dealt` (PHASE_RULES in server/operations.js) - and an
       * acknowledgement on top of that would be the exact lie issue #27 is about, only
       * worse: silence at least left you suspicious. A failure surfaces through the
       * error banner the app already has; this just declines to claim success. */
      if (r && r.ok === false) return;
      setJustSaved(true);
      clearTimeout(ackTimer.current);
      ackTimer.current = setTimeout(() => setJustSaved(false), 4000);
    } finally {
      setBusy(false);
    }
  };

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
      {/* THE POINT OF #27. The confirmation now sits against the control that produces
        * it, so the answer to "did that register?" is one line above your thumb rather
        * than five screens up. */}
      {existing ? <SchemeSummary state={state} team={team} /> : null}
      <button
        className="pp-btn pp-btn-gold"
        disabled={disabled || !canSubmit || busy}
        onClick={submit}
      >
        {busy ? "Saving..." : existing ? "Update Scheme" : "Submit Scheme"}
      </button>
      {justSaved && !busy ? <span className="pp-scheme-ack">Scheme submitted</span> : null}
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

