/* Pigskin Poker UI - table mode (issue #75, OQ-30).
 *
 * The screens only a table has: its record (hands won and lost, in place of a season's
 * standings), a player's own seat, and the dealer's view of every seat. Everything here
 * reads `src/engine/table.js`; nothing here decides a rule.
 *
 * WHO CAN PRESS WHAT is the server's call, not these buttons'. A player can move only
 * their own seat and the dealer can move anybody's; a full table refuses a rejoin. The
 * buttons are drawn to match, but `setSeat` in server/operations.js is what enforces it.
 */

import { useState } from "react";
import {
  SEAT,
  handHistory,
  periodTeamIds,
  seatOf,
  seatsFree,
  seatsTaken,
  tableRecord,
  tableSeats,
} from "../engine/index.js";
import { ICON } from "../engine/constants.js";
import { EmptyState } from "./atoms.jsx";

export const SEAT_LABEL = {
  [SEAT.SEATED]: "Seated",
  [SEAT.SITTING_OUT]: "Sitting out",
  [SEAT.LEFT]: "Left the table",
};

const mono = { textAlign: "right", fontFamily: "var(--font-mono)" };

/** "In this hand" / "Next hand" - what a seat means for the cards right now. */
function handNote(state, teamId) {
  const inHand = periodTeamIds(state).includes(teamId);
  const dealt = state.currentPeriod.phase !== "pre-deal";
  const seat = seatOf(state, teamId);
  if (dealt && inHand && seat !== SEAT.SEATED) return "playing out this hand";
  if (dealt && !inHand && seat === SEAT.SEATED) return "in from the next hand";
  if (dealt && inHand) return "in this hand";
  return seat === SEAT.SEATED ? "in the next hand" : "";
}

/* ============================== Table Record ============================== */

export function TableRecordPanel({ state, myTeam }) {
  const record = tableRecord(state);
  const hands = handHistory(state);
  return (
    <>
      <p className="pp-sub" style={{ marginBottom: 10 }}>
        {seatsTaken(state)} of {tableSeats(state)} seats taken. A hand is won by finishing
        first in it - a dead tie for first is a win for both.
      </p>
      {record.length === 0 ? (
        <EmptyState>Nobody has sat down yet.</EmptyState>
      ) : (
        <div className="pp-table-scroll">
          <table className="pp-table">
            <thead>
              <tr>
                <th>Player</th>
                <th style={{ textAlign: "right" }}>Won</th>
                <th style={{ textAlign: "right" }}>Lost</th>
                <th style={{ textAlign: "right" }}>Played</th>
                <th>Seat</th>
              </tr>
            </thead>
            <tbody>
              {record.map((r, i) => (
                <tr key={r.teamId} className={i === 0 && r.won > 0 ? "pp-standings-first" : ""}>
                  <td style={{ fontWeight: myTeam && myTeam.id === r.teamId ? 800 : 700 }}>
                    {i === 0 && r.won > 0 ? <span className="pp-crown">{ICON.crown}</span> : null}
                    {r.name}
                  </td>
                  <td style={{ ...mono, fontWeight: 700, color: "var(--gold-bright)" }}>{r.won}</td>
                  <td style={mono}>{r.lost}</td>
                  <td style={mono}>{r.played}</td>
                  <td style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{SEAT_LABEL[r.seat]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="pp-h3" style={{ marginTop: 18 }}>Hands Played</h3>
      {hands.length === 0 ? (
        <p className="pp-sub">No hand has been finished yet.</p>
      ) : (
        hands.map((h) => (
          <div key={h.label} className="pp-roster-slot" style={{ display: "block" }}>
            <div style={{ fontWeight: 700 }}>
              {h.label} - won by {h.results.filter((r) => r.rank === 1).map((r) => r.teamName).join(" and ")}
            </div>
            <div className="pp-roster-slot-meta">
              {h.results.map((r) => "#" + r.rank + " " + r.teamName + " (" + r.rawScore + ")").join(",  ")}
            </div>
          </div>
        ))
      )}
    </>
  );
}

/* ================================ My seat ================================ */

/**
 * A player's own seat, on My Team. Sit out keeps the seat; Leave gives it up. Both are
 * a click with no confirmation except Leave, which is the one that can cost the seat.
 */
export function MySeatCard({ state, team, onSetSeat }) {
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState(null);
  const seat = seatOf(state, team.id);
  const free = seatsFree(state);

  const move = async (to) => {
    setBusy(true); setError(null);
    try {
      const r = await onSetSeat(team.id, to);
      if (r && r.ok === false) setError(r.message || "That did not work.");
    } finally {
      setBusy(false); setConfirmLeave(false);
    }
  };

  const note = handNote(state, team.id);
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Your Seat</h3>
      <p className="pp-sub">
        <strong>{SEAT_LABEL[seat]}</strong>{note ? " - " + note : ""}.{" "}
        {seat === SEAT.SEATED && "You will be dealt into the next hand."}
        {seat === SEAT.SITTING_OUT && "Your seat is held for you. Come back whenever you like."}
        {seat === SEAT.LEFT && (free > 0
          ? "A seat is free - you can take it back, with your record."
          : "The table is full. Your record is kept for when a seat comes free.")}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {seat === SEAT.SEATED && (
          <button className="pp-btn pp-btn-sm" disabled={busy} onClick={() => move(SEAT.SITTING_OUT)}>Sit Out Next Hand</button>
        )}
        {seat === SEAT.SITTING_OUT && (
          <button className="pp-btn pp-btn-sm pp-btn-gold" disabled={busy} onClick={() => move(SEAT.SEATED)}>I&apos;m Back In</button>
        )}
        {seat === SEAT.LEFT && (
          <button className="pp-btn pp-btn-sm pp-btn-gold" disabled={busy || free < 1} onClick={() => move(SEAT.SEATED)}>Rejoin The Table</button>
        )}
        {seat !== SEAT.LEFT && !confirmLeave && (
          <button className="pp-btn pp-btn-sm pp-btn-ghost" disabled={busy} onClick={() => setConfirmLeave(true)}>Leave The Table</button>
        )}
        {confirmLeave && (
          <>
            <span className="pp-sub" style={{ alignSelf: "center" }}>Give up your seat? Someone else can take it.</span>
            <button className="pp-btn pp-btn-sm" disabled={busy} onClick={() => move(SEAT.LEFT)}>Yes, Leave</button>
            <button className="pp-btn pp-btn-sm pp-btn-ghost" disabled={busy} onClick={() => setConfirmLeave(false)}>Stay</button>
          </>
        )}
      </div>
      {error ? <div className="pp-hint pp-hint-bad">{error}</div> : null}
    </div>
  );
}

/* ============================== Dealer's seats ============================== */

/**
 * Every seat at the table, for the dealer: who is in, who is out, and the same moves a
 * player has on their own seat. Takes the place of a season's Add a Team - a table's
 * teams arrive by people sitting down.
 */
export function TableSeatsPanel({ state, onSetSeat, onRenameTeam }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const free = seatsFree(state);

  const move = async (teamId, to) => {
    setBusy(teamId); setError(null);
    try {
      const r = await onSetSeat(teamId, to);
      if (r && r.ok === false) setError(r.message || "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pp-card">
      <h3 className="pp-h3">Seats</h3>
      <p className="pp-sub" style={{ marginBottom: 10 }}>
        {seatsTaken(state)} of {tableSeats(state)} taken{free ? ", " + free + " free" : " - the table is full"}.
        People take a seat by redeeming your invite. A hand needs at least two players
        seated when you deal; anyone who sits down or gets up after the deal changes the
        next hand, not this one.
      </p>
      {state.teams.length === 0 ? <EmptyState>Nobody has sat down yet.</EmptyState> : null}
      {state.teams.map((t) => {
        const seat = seatOf(state, t.id);
        const note = handNote(state, t.id);
        return (
          <div key={t.id} className="pp-roster-slot" style={{ flexWrap: "wrap", gap: 6 }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              {editing === t.id ? (
                <input className="pp-input" value={name} onChange={(e) => setName(e.target.value)} />
              ) : (
                <span style={{ fontWeight: 700 }}>{t.name}</span>
              )}
              <span className="pp-roster-slot-meta">{"  " + SEAT_LABEL[seat] + (note ? " - " + note : "")}</span>
            </div>
            {editing === t.id ? (
              <>
                <button className="pp-btn pp-btn-sm pp-btn-gold" disabled={!name.trim()} onClick={() => { onRenameTeam(t.id, name.trim()); setEditing(null); }}>Save</button>
                <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              </>
            ) : (
              <>
                <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => { setEditing(t.id); setName(t.name); }}>Rename</button>
                {seat === SEAT.SEATED && <button className="pp-btn pp-btn-sm" disabled={busy === t.id} onClick={() => move(t.id, SEAT.SITTING_OUT)}>Sit Out</button>}
                {seat === SEAT.SITTING_OUT && <button className="pp-btn pp-btn-sm" disabled={busy === t.id} onClick={() => move(t.id, SEAT.SEATED)}>Seat</button>}
                {seat === SEAT.LEFT && <button className="pp-btn pp-btn-sm" disabled={busy === t.id || free < 1} onClick={() => move(t.id, SEAT.SEATED)}>Reseat</button>}
                {seat !== SEAT.LEFT && <button className="pp-btn pp-btn-sm pp-btn-ghost" disabled={busy === t.id} onClick={() => move(t.id, SEAT.LEFT)}>Unseat</button>}
              </>
            )}
          </div>
        );
      })}
      {error ? <div className="pp-hint pp-hint-bad">{error}</div> : null}
    </div>
  );
}
