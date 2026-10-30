/* Pigskin Poker UI - the starting lineup, the bench, and moving players between them.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 1358-1418, where every change
 * was a dropdown under a starter: "Swap in from bench...". Changed three times since: the
 * rows carry points once the week is dealt (issue #29); the lock a move obeys is the
 * league's lineup-lock policy as well as the commissioner's per-player one, which this
 * asks src/engine/lineupLock.js about rather than reading `lockedPlayerIds`; and since
 * 2026-10-30 (OQ-34, Scott's pick of option A of three mockups) the dropdown is gone.
 *
 * TAP THE CARD. Every position card is a button, starter or bench. Tap one and it turns
 * gold and reads MOVE; every place that player can go swaps its card for a pulsing HERE;
 * everything else fades back. Tap a HERE to make the move, or the same card to cancel.
 * Which places light up is src/engine/lineupMoves.js - starter for bench either way
 * round, starter for starter of the same position, and the three-way TE-to-FLEX.
 *
 * THE MESSAGE ONLY SPEAKS WHEN SOMEONE IS MOVING. "Moving X" while a card is picked, who
 * went where for four seconds after, then nothing. Scott asked for no "Cancelled" and no
 * standing header, so a cancel or a tap on a locked player says nothing - the locked
 * card shakes instead.
 */

import { useEffect, useRef, useState } from "react";
import {
  LINEUP_LOCK,
  STARTER_SLOTS,
  formatKickoff,
  getPlayer,
  isPlayerLocked,
  kickoffsFor,
  lineupLockMode,
  lineupMoveTargets,
  lockTimeFor,
} from "../engine/index.js";
import { useNow } from "../hooks/useNow.js";
import { RosterSlotRow } from "./roster.jsx";

/* The phases the server takes a lineup change in (PHASE_RULES in server/operations.js).
 * Outside them the cards are plain cards rather than buttons that would only be refused. */
const MOVABLE_PHASES = ["dealt", "schemes-processed"];

const sameSpot = (a, b) =>
  !!a && !!b && a.area === b.area && (a.area === "starter" ? a.slot === b.slot : a.index === b.index);

/* Where a move put someone, in the words the message uses. */
const placeWords = (at) =>
  at.area === "bench" ? "to the bench" : at.slot === "FLEX" ? "into the FLEX" : "into " + at.slot;

export function LineupEditor({ state, team, onSwap, onMoveStarter, showStats }) {
  /* The deadline arrives on its own, so the screen has to notice it on its own too. */
  const now = useNow();
  const [pick, setPick] = useState(null);
  const [message, setMessage] = useState(null);
  const [flash, setFlash] = useState([]);
  const [shake, setShake] = useState(null);
  const timers = useRef([]);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /* A different team (the commissioner's team picker) or a new week starts clean. */
  const period = state.currentPeriod.type + ":" + state.currentPeriod.number;
  useEffect(() => {
    setPick(null);
    setMessage(null);
  }, [team.id, period]);

  const stats = (state.statsEntry && state.statsEntry[team.id]) || {};
  const roster = team.roster;
  const benchLength = roster ? roster.bench.length : 6;

  if (!roster) {
    return (
      <div>
        {STARTER_SLOTS.map((slot) => (
          <RosterSlotRow key={slot} slot={slot} player={null} state={state} statLine={null} locked={false} showStats={false} />
        ))}
        <BenchHeading />
        {Array.from({ length: benchLength }, (_, i) => (
          <RosterSlotRow key={i} slot="BN" player={null} state={state} statLine={null} locked={false} showStats={false} />
        ))}
      </div>
    );
  }

  const movable = MOVABLE_PHASES.includes(state.currentPeriod.phase);
  const locked = (id) => !!id && isPlayerLocked(state, id, now);
  const positionOf = (id) => {
    const p = getPlayer(state, id);
    return p ? p.position : null;
  };
  const idAt = (at) => (at.area === "starter" ? roster.starters[at.slot] : roster.bench[at.index]);
  /* A pick whose player has since locked, or moved under us, is dropped rather than
   * offering targets for a move the server would refuse. */
  const livePick = pick && movable && idAt(pick) && !locked(idAt(pick)) ? pick : null;
  const targets = livePick ? lineupMoveTargets(roster, livePick, positionOf, locked) : [];
  const targetAt = (at) => targets.find((t) => sameSpot(t, at)) || null;

  const nameOf = (id) => {
    const p = getPlayer(state, id);
    return p ? p.name : "Nobody";
  };

  const finish = (parts, moved) => {
    const shown = { parts, moving: false };
    setPick(null);
    setMessage(shown);
    setFlash(moved);
    later(() => setFlash([]), 900);
    /* Only this message fades - a later move's message gets its own four seconds. */
    later(() => setMessage((m) => (m === shown ? null : m)), 4000);
  };

  const tap = (at) => {
    const id = idAt(at);
    if (livePick && sameSpot(livePick, at)) {
      setPick(null);
      setMessage(null);
      return;
    }
    const target = livePick ? targetAt(at) : null;
    if (target) {
      if (target.locked) {
        setShake(id);
        later(() => setShake(null), 350);
        return;
      }
      const movingId = idAt(livePick);
      if (livePick.area === "bench") {
        onSwap(at.slot, livePick.index);
        finish([[movingId, placeWords(at)], [id, "to the bench"]], [movingId, id]);
      } else if (at.area === "bench") {
        onSwap(livePick.slot, at.index);
        finish([[id, placeWords(livePick)], [movingId, "to the bench"]], [movingId, id]);
      } else if (target.fill != null) {
        const fillId = roster.bench[target.fill];
        onMoveStarter(livePick.slot, at.slot, target.fill);
        finish(
          [[movingId, placeWords(at)], [fillId, placeWords(livePick)], [id, "to the bench"]],
          [movingId, fillId, id]
        );
      } else {
        onMoveStarter(livePick.slot, at.slot, null);
        finish([[movingId, placeWords(at)], [id, placeWords(livePick)]], [movingId, id]);
      }
      return;
    }
    if (!id) return;
    if (locked(id)) {
      setPick(null);
      setMessage(null);
      setShake(id);
      later(() => setShake(null), 350);
      return;
    }
    const next = lineupMoveTargets(roster, at, positionOf, locked).filter((t) => !t.locked).length;
    setPick(at);
    setMessage({ moving: true, who: id, count: next });
  };

  const row = (at, key) => {
    const slot = at.area === "starter" ? at.slot : "BN";
    const id = idAt(at);
    const player = getPlayer(state, id);
    const isLocked = locked(id);
    const picked = sameSpot(livePick, at);
    const target = livePick && !picked ? targetAt(at) : null;
    const classes = [];
    if (picked) classes.push("pp-move-picked");
    else if (livePick && !target) classes.push("pp-move-dim");
    if (id && flash.includes(id)) classes.push("pp-move-flash");
    const card = movable ? (
      <MoveCard
        slot={slot}
        position={player ? player.position : null}
        mode={picked ? "picked" : target ? (target.locked ? "blocked" : "here") : "card"}
        locked={isLocked}
        shake={!!id && shake === id}
        label={
          !player
            ? slot + " - empty"
            : picked
            ? "Cancel moving " + player.name
            : target
            ? "Move here, " + slot + ", " + player.name
            : "Move " + player.name
        }
        onClick={() => tap(at)}
      />
    ) : null;
    return (
      <RosterSlotRow
        key={key}
        slot={slot}
        player={player}
        state={state}
        statLine={at.area === "starter" ? stats[at.slot] : null}
        locked={isLocked}
        showStats={!!showStats}
        bench={at.area === "bench"}
        card={card}
        className={classes.join(" ")}
      />
    );
  };

  return (
    <div>
      <LineupLockNote state={state} now={now} />
      {STARTER_SLOTS.map((slot) => row({ area: "starter", slot }, slot))}
      <BenchHeading />
      {roster.bench.map((_, index) => row({ area: "bench", index }, "bn" + index))}
      {message ? <MoveMessage message={message} nameOf={nameOf} /> : null}
    </div>
  );
}

function BenchHeading() {
  return (
    <>
      <h3 className="pp-h3" style={{ marginTop: 16 }}>Bench</h3>
      <p className="pp-sub" style={{ marginBottom: 10 }}>
        Bench points are shown in grey and do not count toward your score.
      </p>
    </>
  );
}

/* The position card as a button. Its face is the ordinary card until a move is under way:
 * MOVE on the one picked, HERE on every place he can go, LOCKED on a place he could go if
 * the player there were free to move. */
export function MoveCard({ slot, position, mode, locked, shake, label, onClick }) {
  const split = !!position && position !== slot;
  const classes = ["pp-pos-card", "pp-move-card", position ? "pp-pos-" + slot : "pp-pos-empty"];
  if (mode === "picked") classes.push("pp-move-card-picked");
  if (mode === "here") classes.push("pp-move-card-here");
  if (mode === "blocked") classes.push("pp-move-card-blocked");
  if (shake) classes.push("pp-move-shake");
  let face;
  if (mode === "picked" || mode === "here") {
    face = (
      <>
        <span className="pp-pos-card-rank pp-move-word">{mode === "picked" ? "MOVE" : "HERE"}</span>
        <span className="pp-pos-card-sub">{slot}</span>
      </>
    );
  } else if (mode === "blocked") {
    face = <span className="pp-pos-card-rank pp-move-word-small">LOCKED</span>;
  } else {
    const rankClass = "pp-pos-card-rank" + (slot.length > 4 ? " pp-pos-card-rank-long" : split ? " pp-pos-card-rank-split" : "");
    face = (
      <>
        <span className={rankClass}>{slot}</span>
        {split ? <span className="pp-pos-card-sub">{position}</span> : null}
      </>
    );
  }
  return (
    <button
      type="button"
      className={classes.join(" ")}
      aria-label={label}
      aria-pressed={mode === "picked"}
      aria-disabled={locked || mode === "blocked" || !position ? true : undefined}
      onClick={onClick}
    >
      {face}
    </button>
  );
}

function MoveMessage({ message, nameOf }) {
  if (message.moving) {
    return (
      <div className="pp-move-message" role="status">
        Moving <b>{nameOf(message.who)}</b>.{" "}
        {message.count
          ? message.count + " place" + (message.count === 1 ? "" : "s") + " he can go."
          : "Nowhere he can go right now."}
      </div>
    );
  }
  return (
    <div className="pp-move-message" role="status">
      {message.parts.filter(([id]) => id).map(([id, words], i) => (
        <span key={i}>
          {i ? ", " : ""}
          <b>{nameOf(id)}</b> {words}
        </span>
      ))}
      .
    </div>
  );
}

/* What this league's rule is, said once at the top rather than on every row.
 *
 * Worth the line because the two policies feel completely different to play under, and
 * a manager who thinks he has until Sunday when the league locked on Thursday finds out
 * by losing a week. */
export function LineupLockNote({ state, now = Date.now() }) {
  const mode = lineupLockMode(state);
  const kickoffs = kickoffsFor(state);
  const at = lockTimeFor(mode, kickoffs, null);

  if (mode === LINEUP_LOCK.WEEKLY) {
    if (!at) {
      return (
        <p className="pp-sub" style={{ marginBottom: 10 }}>
          Lineups lock at this week's first kickoff. Kickoff times have not been read for
          this week yet, so nothing is locked on the clock - ask your commissioner.
        </p>
      );
    }
    const locked = Number(now) >= Date.parse(at);
    return (
      <p className="pp-sub" style={{ marginBottom: 10 }}>
        {locked
          ? "Lineups locked at " + formatKickoff(at) + " - this league locks every lineup at the week's first kickoff."
          : "Every lineup locks at " + formatKickoff(at) + " (this week's first kickoff)."}
      </p>
    );
  }

  return (
    <p className="pp-sub" style={{ marginBottom: 10 }}>
      {Object.keys(kickoffs).length === 0
        ? "Each player locks when his game starts. No kickoff times have been read for this week yet, so only the commissioner's locks apply."
        : "Each player locks when his own game starts - the later games stay changeable."}
    </p>
  );
}

/* SlotLockHint - "Locks Sun 1:00 PM (Detroit Lions)" under every gametime row - was
 * deleted with issue #33. The roster row itself now carries each player's kickoff
 * (src/components/roster.jsx), which under `gametime` IS the moment that slot closes,
 * and LineupLockNote above says once what the league locks on. Three sayings of one
 * fact was two too many on a phone. */
