/* Pigskin Poker UI - table mode (issue #75, OQ-30; the lobby, OQ-39).
 *
 * The screens only a table has: its record (hands won and lost, in place of a season's
 * standings), a player's own seat, and the dealer's lobby. Everything here reads
 * `src/engine/table.js`; nothing here decides a rule.
 *
 * WHO CAN PRESS WHAT is the server's call, not these buttons'. A player moves only their
 * own seat, and only the dealer deals somebody in, reorders the line or removes a player.
 * The buttons are drawn to match, but server/operations.js is what enforces it.
 */

import { useRef, useState } from "react";
import {
  SEAT,
  TABLE_FILL,
  autoSeatIds,
  handHistory,
  lobbyLine,
  lobbyOf,
  periodTeamIds,
  periodTitle,
  seatOf,
  seatsFree,
  seatsTaken,
  tableFill,
  tableRecord,
  tableSeats,
} from "../engine/index.js";
import { CP, ICON } from "../engine/constants.js";
import { EmptyState } from "./atoms.jsx";

export const SEAT_LABEL = {
  [SEAT.SEATED]: "Seated",
  [SEAT.WAITING]: "In the lobby",
  [SEAT.SITTING_OUT]: "Sitting out",
  [SEAT.LEFT]: "Left the table",
};

/* OQ-39: the three ways a table fills its open seats. The create-a-table form shows the
 * same three, so they are worded once, here. */
export const FILL_CHOICES = [
  { value: TABLE_FILL.DEALER, title: "Dealer decides", body: "Nobody sits in until you press Deal In." },
  { value: TABLE_FILL.LINE, title: "First come, first seated", body: "Open seats fill from the front of the line when the hand is dealt." },
  { value: TABLE_FILL.PLAYER, title: "Player says I'm In", body: "Players in the lobby tap I'm In, and are dealt in by their place in line if there's room." },
];

const FILL_HINT = {
  [TABLE_FILL.DEALER]: "You choose who sits in: press Deal In on anyone in the lobby. The line is still kept, in case you switch to First come later.",
  [TABLE_FILL.LINE]: "When the next hand is dealt, open seats fill from the front of the line. Deal In or Hold Back anyone to change that before then.",
  [TABLE_FILL.PLAYER]: "Players who tap I'm In are dealt in by their place in line if there's room. Anyone who hasn't tapped stays in the lobby.",
};

const mono = { textAlign: "right", fontFamily: "var(--font-mono)" };

const dealt = (state) => state.currentPeriod.phase !== "pre-deal";

/** "Hand 9" - the hand the lobby is filling: the next one once this one is dealt. */
function nextHandTitle(state) {
  const p = state.currentPeriod;
  return periodTitle(state, { ...p, number: dealt(state) ? p.number + 1 : p.number });
}

/** 1st, 2nd, 3rd. */
function ordinal(n) {
  const r = n % 100;
  if (r >= 11 && r <= 13) return n + "th";
  return n + (["th", "st", "nd", "rd"][n % 10] || "th");
}

/** What a seat means for the cards on the table right now, or "" if nothing to say. */
function handNote(state, teamId) {
  if (!dealt(state)) return "";
  const inHand = periodTeamIds(state).includes(teamId);
  const seat = seatOf(state, teamId);
  const removed = lobbyOf(state, teamId).removed;
  const now = periodTitle(state);
  if (inHand && removed) return "plays out " + now + ", then removed";
  if (inHand && seat !== SEAT.SEATED) return "plays out " + now + ", then out";
  if (!inHand && seat === SEAT.SEATED) return "dealt in from " + nextHandTitle(state);
  return "";
}

/* ============================== Table Record ============================== */

export function TableRecordPanel({ state, myTeam }) {
  const record = tableRecord(state);
  const hands = handHistory(state);
  return (
    <>
      <p className="pp-sub" style={{ marginBottom: 10 }}>
        {seatsTaken(state)} seated for the next hand, up to {tableSeats(state)} a hand. A hand
        is won by finishing first in it - a dead tie for first is a win for both.
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
              {record.map((r, i) => {
                /* OQ-39 (Scott, J): somebody who has gone stays in the record, greyed -
                 * their hands happened, and everyone they beat was beaten. */
                const gone = r.seat === SEAT.LEFT;
                const seatWords = gone
                  ? (r.removed ? "Removed" : "Left") + (r.lastHand ? " after Hand " + r.lastHand : "")
                  : SEAT_LABEL[r.seat];
                return (
                  <tr key={r.teamId} className={(i === 0 && r.won > 0 ? "pp-standings-first " : "") + (gone ? "pp-table-gone" : "")}>
                    <td style={{ fontWeight: myTeam && myTeam.id === r.teamId ? 800 : 700 }}>
                      {i === 0 && r.won > 0 ? <span className="pp-crown">{ICON.crown}</span> : null}
                      {r.name}
                    </td>
                    <td style={{ ...mono, fontWeight: 700, color: gone ? undefined : "var(--gold-bright)" }}>{r.won}</td>
                    <td style={mono}>{r.lost}</td>
                    <td style={mono}>{r.played}</td>
                    <td style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{seatWords}</td>
                  </tr>
                );
              })}
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

/** Runs one server call with a busy flag and an error line. */
function useAct() {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const act = async (key, fn) => {
    setBusy(key); setError(null);
    try {
      const r = await fn();
      if (r && r.ok === false) setError(r.message || r.error || "That did not work.");
      return r;
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, act };
}

/**
 * A player's own seat, on My Team. In the next hand, in the lobby, sitting out or gone,
 * and the moves a player has on their own: sit out, join the line, say I'm In, leave.
 */
export function MySeatCard({ state, team, onSetSeat, lobbyOps }) {
  const { busy, error, act } = useAct();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const seat = seatOf(state, team.id);
  const me = lobbyOf(state, team.id);
  const fill = tableFill(state);
  const next = nextHandTitle(state);
  const line = lobbyLine(state);
  const place = line.indexOf(team.id) + 1;
  const autoIn = autoSeatIds(state).includes(team.id);
  const free = seatsFree(state);
  const move = (to) => act(to, () => onSetSeat(team.id, to)).then(() => setConfirmLeave(false));
  const note = handNote(state, team.id);

  if (seat === SEAT.WAITING) {
    const already = dealt(state) ? periodTitle(state) + " is already dealt. " : "";
    let words;
    if (autoIn) words = "You'll be dealt into " + next + " when it is dealt.";
    else if (me.hold) words = "The dealer is holding you back for now.";
    else if (fill === TABLE_FILL.DEALER) words = "The dealer picks who sits in. You're " + ordinal(place) + " in line if they go by order.";
    else if (fill === TABLE_FILL.PLAYER && !me.ready) words = "Tap I'm In to be dealt into " + next + ". If more people tap in than there are seats, the line decides.";
    else words = free > 0 ? "You'll be dealt in when a seat opens up ahead of you." : "Every seat is taken right now. You'll be dealt in when one opens.";
    return (
      <div className="pp-card pp-lobby-card">
        <div className="pp-eyebrow pp-lobby-eyebrow">In the lobby</div>
        <div className="pp-lobby-place">{ordinal(place)} in line</div>
        <p className="pp-sub">{already}{words} {free === 1 ? "1 seat is open." : free > 1 ? free + " seats are open." : ""}</p>
        <div className="pp-lobby-btns">
          {fill === TABLE_FILL.PLAYER && (me.ready
            ? <button className="pp-btn pp-btn-sm" disabled={!!busy} onClick={() => act("ready", () => lobbyOps.flag(team.id, "ready", false))}>I&apos;m Not In</button>
            : <button className="pp-btn pp-btn-sm pp-btn-gold" disabled={!!busy} onClick={() => act("ready", () => lobbyOps.flag(team.id, "ready", true))}>I&apos;m In</button>)}
          <button className="pp-btn pp-btn-sm pp-btn-ghost" disabled={!!busy} onClick={() => move(SEAT.SITTING_OUT)}>Skip Next Hand</button>
        </div>
        {error ? <div className="pp-hint pp-hint-bad">{error}</div> : null}
      </div>
    );
  }

  return (
    <div className="pp-card">
      <h3 className="pp-h3">Your Seat</h3>
      <p className="pp-sub">
        <strong>{SEAT_LABEL[seat]}</strong>{note ? " - " + note : ""}.{" "}
        {seat === SEAT.SEATED && "You'll be dealt into the next hand."}
        {seat === SEAT.SITTING_OUT && "You're in the lobby but not in line. Tap I'm Back to get in line for the next hand."}
        {seat === SEAT.LEFT && "Your record is kept. Come back to the lobby any time."}
      </p>
      <div className="pp-lobby-btns" style={{ marginTop: 8 }}>
        {seat === SEAT.SEATED && (
          <button className="pp-btn pp-btn-sm" disabled={!!busy} onClick={() => move(SEAT.SITTING_OUT)}>Sit Out Next Hand</button>
        )}
        {seat === SEAT.SITTING_OUT && (
          <button className="pp-btn pp-btn-sm pp-btn-gold" disabled={!!busy} onClick={() => move(SEAT.WAITING)}>I&apos;m Back</button>
        )}
        {seat === SEAT.LEFT && (
          <button className="pp-btn pp-btn-sm pp-btn-gold" disabled={!!busy} onClick={() => move(SEAT.WAITING)}>Rejoin The Lobby</button>
        )}
        {seat !== SEAT.LEFT && !confirmLeave && (
          <button className="pp-btn pp-btn-sm pp-btn-ghost" disabled={!!busy} onClick={() => setConfirmLeave(true)}>Leave The Table</button>
        )}
        {confirmLeave && (
          <>
            <span className="pp-sub" style={{ alignSelf: "center" }}>Leave the table? Your record is kept.</span>
            <button className="pp-btn pp-btn-sm" disabled={!!busy} onClick={() => move(SEAT.LEFT)}>Yes, Leave</button>
            <button className="pp-btn pp-btn-sm pp-btn-ghost" disabled={!!busy} onClick={() => setConfirmLeave(false)}>Stay</button>
          </>
        )}
      </div>
      {error ? <div className="pp-hint pp-hint-bad">{error}</div> : null}
    </div>
  );
}

/* ============================== Dealer's lobby ============================== */

/**
 * OQ-39. The dealer's whole table: Who sits in, who is in the next hand, the lobby line
 * (drag a name by its grip, or Up and Down), who is sitting out, and who has gone. Takes
 * the place of a season's Add a Team - a table's teams arrive by redeeming the invite.
 */
export function TableSeatsPanel({ state, onSetSeat, onRenameTeam, lobbyOps, myTeamId = null }) {
  const { busy, error, act } = useAct();
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [drag, setDrag] = useState(null); // { id, over }
  const listRef = useRef(null);

  const fill = tableFill(state);
  const most = tableSeats(state);
  const seated = state.teams.filter((t) => seatOf(state, t.id) === SEAT.SEATED);
  const line = lobbyLine(state);
  const sittingOut = state.teams.filter((t) => seatOf(state, t.id) === SEAT.SITTING_OUT);
  const gone = state.teams.filter((t) => seatOf(state, t.id) === SEAT.LEFT);
  const auto = autoSeatIds(state);
  const free = seatsFree(state);
  const next = nextHandTitle(state);
  const teamById = new Map(state.teams.map((t) => [t.id, t]));

  const move = (id, to) => act(id, () => onSetSeat(id, to));
  const reorder = (order) => act("line", () => lobbyOps.reorder(order));
  const shift = (id, by) => {
    const order = line.slice();
    const i = order.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    reorder(order);
  };

  /* Drag by the grip. Pointer events rather than HTML drag-and-drop, so it works with a
   * finger on a phone; the drop lands the name where the row under the pointer is. */
  const onGripDown = (e, id) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id, over: null });
  };
  const onGripMove = (e) => {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el && el.closest && el.closest("[data-lid]");
    const over = row && listRef.current && listRef.current.contains(row) ? row.getAttribute("data-lid") : null;
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const onGripUp = () => {
    if (!drag) return;
    const { id, over } = drag;
    setDrag(null);
    if (!over || over === id) return;
    const order = line.filter((x) => x !== id);
    order.splice(order.indexOf(over) + (line.indexOf(id) < line.indexOf(over) ? 1 : 0), 0, id);
    reorder(order);
  };

  const removeButtons = (t) => {
    if (t.id === myTeamId) return null;
    if (confirmRemove === t.id) {
      return (
        <>
          <span className="pp-sub" style={{ alignSelf: "center" }}>Remove {t.name} from the table and the league?</span>
          <button className="pp-btn pp-btn-sm" disabled={!!busy} onClick={() => act(t.id, () => lobbyOps.remove(t.id)).then(() => setConfirmRemove(null))}>Yes, Remove</button>
          <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => setConfirmRemove(null)}>Keep</button>
        </>
      );
    }
    return <button className="pp-btn pp-btn-sm pp-btn-ghost" disabled={!!busy} onClick={() => setConfirmRemove(t.id)}>Remove</button>;
  };

  const nameCell = (t, sub) => (
    <div className="pp-lobby-who">
      {editing === t.id ? (
        <input className="pp-input" value={name} onChange={(e) => setName(e.target.value)} />
      ) : (
        <span style={{ fontWeight: 700 }}>{t.name}</span>
      )}
      {sub ? <span className="pp-roster-slot-meta">{sub}</span> : null}
    </div>
  );

  const renameButtons = (t) => editing === t.id ? (
    <>
      <button className="pp-btn pp-btn-sm pp-btn-gold" disabled={!name.trim()} onClick={() => { onRenameTeam(t.id, name.trim()); setEditing(null); }}>Save</button>
      <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
    </>
  ) : (
    <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => { setEditing(t.id); setName(t.name); }}>Rename</button>
  );

  const chip = (text, tone = "") => <span className={"pp-lobby-chip " + tone}>{text}</span>;

  return (
    <div className="pp-card">
      <h3 className="pp-h3">The Table</h3>

      <div className="pp-lobby-fill">
        <div className="pp-eyebrow">Who sits in</div>
        <div className="pp-lobby-fill-choices" role="radiogroup" aria-label="Who sits in">
          {FILL_CHOICES.map((c) => (
            <label key={c.value} className={"pp-lobby-fill-choice" + (fill === c.value ? " on" : "")}>
              <input type="radio" name="table-fill" aria-label={c.title} checked={fill === c.value} disabled={!!busy}
                onChange={() => act("fill", () => lobbyOps.fill(c.value))} />
              <span><strong>{c.title}</strong><span className="pp-sub" style={{ display: "block" }}>{c.body}</span></span>
            </label>
          ))}
        </div>
        <p className="pp-sub pp-lobby-hint">{FILL_HINT[fill]}</p>
      </div>

      <div className="pp-lobby-status">
        {dealt(state) ? chip(periodTitle(state) + ": " + periodTeamIds(state).length + " dealt") : null}
        {chip(next + ": " + seated.length + (auto.length ? " + " + auto.length + " from the line" : "") + " of " + most,
          seated.length + auto.length >= most ? "full" : "gold")}
      </div>

      {error ? <div className="pp-hint pp-hint-bad">{error}</div> : null}

      <div className="pp-lobby-sect">
        <div className="pp-lobby-sect-h"><h4 className="pp-h3">In for {next}</h4><span className="pp-sub">{seated.length} of {most}</span></div>
        {seated.length === 0 ? <div className="pp-lobby-empty">Nobody is seated yet.</div> : null}
        {seated.map((t) => (
          <div key={t.id} className="pp-roster-slot pp-lobby-row">
            {nameCell(t, handNote(state, t.id))}
            <div className="pp-lobby-btns">
              {renameButtons(t)}
              <button className="pp-btn pp-btn-sm" disabled={!!busy} onClick={() => move(t.id, SEAT.SITTING_OUT)}>Sit Out</button>
              {removeButtons(t)}
            </div>
          </div>
        ))}
        {free > 0 ? <div className="pp-lobby-empty">{free === 1 ? "1 open seat" : free + " open seats"}</div> : null}
      </div>

      <div className="pp-lobby-sect" ref={listRef}>
        <div className="pp-lobby-sect-h"><h4 className="pp-h3">Lobby - the line</h4><span className="pp-sub">{line.length} waiting</span></div>
        {line.length === 0 ? <div className="pp-lobby-empty">Nobody is waiting. People join the line by redeeming your invite.</div> : null}
        {line.map((id, i) => {
          const t = teamById.get(id);
          const l = lobbyOf(state, id);
          return (
            <div key={id} data-lid={id}
              className={"pp-roster-slot pp-lobby-row" + (drag && drag.id === id ? " dragging" : "") + (drag && drag.over === id && drag.id !== id ? " drop-at" : "")}>
              <span className="pp-lobby-grip" title="Drag to reorder" aria-hidden="true"
                onPointerDown={(e) => onGripDown(e, id)} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={() => setDrag(null)}>
                {CP(0x22ee, 0x22ee)}
              </span>
              <span className="pp-lobby-pos">{i + 1}</span>
              {nameCell(t)}
              <div className="pp-lobby-chips">
                {auto.includes(id) ? chip("Dealt in automatically", "new") : null}
                {l.hold ? chip("Held back") : null}
                {fill === TABLE_FILL.PLAYER ? chip(l.ready ? "Said I'm In" : "Hasn't said I'm In", l.ready ? "ok" : "") : null}
              </div>
              <div className="pp-lobby-btns">
                <button className="pp-btn pp-btn-sm pp-btn-gold" disabled={!!busy || free < 1} title={free < 1 ? "Every seat is taken" : ""} onClick={() => move(id, SEAT.SEATED)}>Deal In</button>
                {fill !== TABLE_FILL.DEALER ? (
                  <button className="pp-btn pp-btn-sm" disabled={!!busy} onClick={() => act(id, () => lobbyOps.flag(id, "hold", !l.hold))}>{l.hold ? "Release" : "Hold Back"}</button>
                ) : null}
                {i > 0 ? <button className="pp-btn pp-btn-sm pp-btn-ghost" disabled={!!busy} aria-label={"Move " + t.name + " up the line"} onClick={() => shift(id, -1)}>Up</button> : null}
                {i < line.length - 1 ? <button className="pp-btn pp-btn-sm pp-btn-ghost" disabled={!!busy} aria-label={"Move " + t.name + " down the line"} onClick={() => shift(id, 1)}>Down</button> : null}
                {removeButtons(t)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="pp-lobby-sect">
        <div className="pp-lobby-sect-h"><h4 className="pp-h3">Lobby - sitting out</h4><span className="pp-sub">not in line</span></div>
        {sittingOut.length === 0 ? <div className="pp-lobby-empty">Nobody is sitting out.</div> : null}
        {sittingOut.map((t) => (
          <div key={t.id} className="pp-roster-slot pp-lobby-row">
            {nameCell(t, handNote(state, t.id))}
            <div className="pp-lobby-btns">
              <button className="pp-btn pp-btn-sm pp-btn-gold" disabled={!!busy || free < 1} onClick={() => move(t.id, SEAT.SEATED)}>Deal In</button>
              <button className="pp-btn pp-btn-sm" disabled={!!busy} onClick={() => move(t.id, SEAT.WAITING)}>Back in Line</button>
              {removeButtons(t)}
            </div>
          </div>
        ))}
      </div>

      {gone.length ? (
        <div className="pp-lobby-sect">
          <div className="pp-lobby-sect-h"><h4 className="pp-h3">Left the table</h4><span className="pp-sub">record kept</span></div>
          {gone.map((t) => {
            const removed = lobbyOf(state, t.id).removed;
            return (
              <div key={t.id} className="pp-roster-slot pp-lobby-row pp-lobby-gone">
                {nameCell(t, handNote(state, t.id) || (removed ? "Removed. Send them the invite to bring them back, record and all." : "Left on their own."))}
                {removed ? null : (
                  <div className="pp-lobby-btns">
                    <button className="pp-btn pp-btn-sm" disabled={!!busy} onClick={() => move(t.id, SEAT.WAITING)}>Back in Line</button>
                    {removeButtons(t)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
