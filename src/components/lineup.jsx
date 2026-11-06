/* Pigskin Poker UI - the starting lineup, the bench, and moving players between them.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 1358-1418, where every change
 * was a dropdown under a starter: "Swap in from bench...". Changed three times since: the
 * rows carry points once the week is dealt (issue #29); the lock a move obeys is the
 * league's lineup-lock policy as well as the commissioner's per-player one, which this
 * asks src/engine/lineupLock.js about rather than reading `lockedPlayerIds`; and since
 * 2026-10-30 (OQ-34, Scott's pick of option A of three mockups) the dropdown is gone.
 *
 * TAP THE CARD. Every position card is a button, starter or bench. Tap one and it goes
 * gold and a short list opens right under it: everyone he can trade places with, where
 * they are now, and their average. Tap a line to make the move, or the card again (or
 * Cancel) to close it. Which players are on the list is src/engine/lineupMoves.js -
 * starter for bench either way round, starter for starter of the same position, and the
 * three-way TE-to-FLEX.
 *
 * THE LIST REPLACED THE HERE BUTTONS ON 2026-11-06. Scott built option A first (MOVE on the
 * card, HERE on every place he could go). League feedback was that some managers missed
 * the old dropdown and liked the pick-from-a-list mockup, option C, which keeps the list
 * the dropdown had while opening it from the card. Nothing about who may go where changed.
 *
 * THE MESSAGE ONLY SPEAKS AFTER A MOVE: who went where, for four seconds, then nothing.
 * Scott asked for no "Cancelled" and no standing header. A tap on a locked player says
 * nothing - the locked card shakes instead.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import {
  LINEUP_LOCK,
  STARTER_SLOTS,
  abbrFor,
  formatKickoff,
  getPlayer,
  isPlayerLocked,
  kickoffsFor,
  lineupLockMode,
  lineupMoveTargets,
  lockTimeFor,
  playerSeasonAverage,
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

  const shakeCard = (id) => {
    setShake(id);
    later(() => setShake(null), 350);
  };

  /* Tapping a card opens its list, or closes it if it is already open. */
  const tap = (at) => {
    const id = idAt(at);
    if (livePick && sameSpot(livePick, at)) {
      setPick(null);
      return;
    }
    if (!id) return;
    if (locked(id)) {
      setPick(null);
      shakeCard(id);
      return;
    }
    setPick(at);
  };

  /* Choosing a line in the list makes the move. */
  const choose = (target) => {
    if (!livePick || target.locked) return;
    const at = target.area === "starter" ? { area: "starter", slot: target.slot } : { area: "bench", index: target.index };
    const id = target.playerId;
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
      finish([[movingId, placeWords(at)], [fillId, placeWords(livePick)], [id, "to the bench"]], [movingId, fillId, id]);
    } else {
      onMoveStarter(livePick.slot, at.slot, null);
      finish([[movingId, placeWords(at)], [id, placeWords(livePick)]], [movingId, id]);
    }
  };

  const row = (at, key) => {
    const slot = at.area === "starter" ? at.slot : "BN";
    const id = idAt(at);
    const player = getPlayer(state, id);
    const isLocked = locked(id);
    const picked = sameSpot(livePick, at);
    const classes = [];
    if (picked) classes.push("pp-move-picked");
    if (id && flash.includes(id)) classes.push("pp-move-flash");
    const card = movable ? (
      <MoveCard
        slot={slot}
        position={player ? player.position : null}
        picked={picked}
        locked={isLocked}
        shake={!!id && shake === id}
        label={!player ? slot + " - empty" : picked ? "Close the list for " + player.name : "Move " + player.name}
        onClick={() => tap(at)}
      />
    ) : null;
    return (
      <Fragment key={key}>
        <RosterSlotRow
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
        {picked ? (
          <PickList
            state={state}
            player={player}
            targets={targets}
            roster={roster}
            onChoose={choose}
            onCancel={() => setPick(null)}
          />
        ) : null}
      </Fragment>
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

/* The position card as a button. It looks like the ordinary card, and goes gold while its
 * list is open. */
export function MoveCard({ slot, position, picked, locked, shake, label, onClick }) {
  const split = !!position && position !== slot;
  const classes = ["pp-pos-card", "pp-move-card", position ? "pp-pos-" + slot : "pp-pos-empty"];
  if (picked) classes.push("pp-move-card-picked");
  if (shake) classes.push("pp-move-shake");
  const rankClass = "pp-pos-card-rank" + (slot.length > 4 ? " pp-pos-card-rank-long" : split ? " pp-pos-card-rank-split" : "");
  return (
    <button
      type="button"
      className={classes.join(" ")}
      aria-label={label}
      aria-expanded={picked}
      aria-disabled={locked || !position ? true : undefined}
      onClick={onClick}
    >
      <span className={rankClass}>{slot}</span>
      {split ? <span className="pp-pos-card-sub">{position}</span> : null}
    </button>
  );
}

/* THE LIST (OQ-34, revised 2026-11-06). Everyone the picked player can trade places with,
 * one line each, the same people the HERE buttons used to light up: where they are now,
 * who they are, and their average. A player whose game has started stays in the list,
 * greyed and marked LOCKED, so a manager sees why he cannot pick him. A three-way move says
 * who comes off the bench. */
function PickList({ state, player, targets, roster, onChoose, onCancel }) {
  const nameOf = (id) => {
    const p = getPlayer(state, id);
    return p ? p.name : null;
  };
  return (
    <div className="pp-pick-list">
      <div className="pp-pick-list-head">Swap {player.name} with</div>
      {targets.length === 0 ? <div className="pp-sub">Nobody on your roster fits here.</div> : null}
      {targets.map((t) => {
        const p = getPlayer(state, t.playerId);
        const where = t.area === "starter" ? t.slot : "BN";
        const average = p ? playerSeasonAverage(state, p) : null;
        const fillName = t.fill != null ? nameOf(roster.bench[t.fill]) : null;
        return (
          <button
            key={t.area + (t.area === "starter" ? t.slot : t.index)}
            type="button"
            className="pp-pick-option"
            disabled={t.locked}
            onClick={() => onChoose(t)}
          >
            <span className={"pp-pick-tag pp-pos-" + where}>{where === "Coach" ? "HC" : where}</span>
            <span className="pp-pick-who">
              {p ? p.name : "Empty"}
              {p ? <small> {abbrFor(p.team)} {p.position === "Coach" ? "HC" : p.position}</small> : null}
              {fillName ? <small className="pp-pick-note">{fillName} comes off the bench</small> : null}
            </span>
            <span className="pp-pick-right">{t.locked ? "LOCKED" : average ? "avg " + average.avg.toFixed(1) : ""}</span>
          </button>
        );
      })}
      <button type="button" className="pp-pick-cancel" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function MoveMessage({ message, nameOf }) {
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
