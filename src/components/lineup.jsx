/* Pigskin Poker UI - the starting lineup and its bench swaps.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 1358-1418. Changed twice since:
 * the rows can carry points once the week is dealt (issue #29), and the lock a swap obeys
 * is no longer only the commissioner's per-player one - a league plays either `gametime`
 * (each player locks when his own team kicks off) or `weekly` (every lineup locks at the
 * week's first kickoff), which this asks src/engine/lineupLock.js about rather than
 * reading `lockedPlayerIds` directly. The swap itself is untouched: still one starter for
 * one bench player.
 */

import {
  LINEUP_LOCK,
  formatKickoff,
  getPlayer,
  isPlayerLocked,
  kickoffsFor,
  lineupLockMode,
  lockTimeFor,
  playerLabel,
} from "../engine/index.js";
import { useNow } from "../hooks/useNow.js";
import { RosterSlotRow } from "./roster.jsx";
import { eligibleBenchForSlot } from "./scheme.jsx";

/* `showStats` arrives once the week is dealt. Without it this screen showed you your own
 * lineup with no points on it anywhere - the one place in the app you would most expect to
 * find them (issue #29). The swap controls are unaffected: they disappear on their own
 * once the rosters lock. */
export function LineupEditor({ state, team, onSwap, showStats }) {
  /* The deadline arrives on its own, so the screen has to notice it on its own too. */
  const now = useNow();
  const mode = lineupLockMode(state);
  const kickoffs = kickoffsFor(state);
  const stats = (state.statsEntry && state.statsEntry[team.id]) || {};
  if (!team.roster) {
    return (
      <div>
        {["Coach", "QB", "WR", "RB", "TE", "FLEX"].map((slot) => (
          <div key={slot} style={{ marginBottom: 8 }}>
            <RosterSlotRow slot={slot} player={null} state={state} statLine={null} locked={false} showStats={false} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      <LineupLockNote state={state} now={now} />
      {["Coach", "QB", "WR", "RB", "TE", "FLEX"].map((slot) => {
        const pid = team.roster.starters[slot];
        const player = getPlayer(state, pid);
        const starterLocked = !!pid && isPlayerLocked(state, pid, now);
        const options = eligibleBenchForSlot(state, team, slot);
        /* Under `gametime` a bench player locks on his own game, so the ones whose
         * games have started come off the list rather than failing on the server. */
        const open = options.filter((o) => !isPlayerLocked(state, o.player.id, now));
        return (
          <div key={slot} style={{ marginBottom: 8 }}>
            <RosterSlotRow slot={slot} player={player} state={state} statLine={stats[slot]} locked={starterLocked} showStats={!!showStats} />
            {mode === LINEUP_LOCK.GAMETIME && player && !starterLocked ? (
              <SlotLockHint at={lockTimeFor(mode, kickoffs, player.team)} team={player.team} />
            ) : null}
            {options.length > 0 ? (
              <SwapRow
                disabled={starterLocked || open.length === 0}
                options={open}
                onSwap={(benchIdx) => {
                  const benchPlayer = getPlayer(state, team.roster.bench[benchIdx]);
                  if (benchPlayer && isPlayerLocked(state, benchPlayer.id, now)) return;
                  onSwap(slot, benchIdx);
                }}
              />
            ) : null}
          </div>
        );
      })}
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

/** When this particular slot closes. Silent when there is no time to name. */
export function SlotLockHint({ at, team }) {
  if (!at) return null;
  return (
    <div className="pp-sub" style={{ marginLeft: 8, marginTop: 2 }}>
      Locks {formatKickoff(at)} ({team})
    </div>
  );
}

export function SwapRow({ options, onSwap, disabled }) {
  return (
    <div style={{ display: "flex", gap: 6, marginLeft: 8, marginTop: 4 }}>
      <select
        className="pp-select"
        style={{ flex: 1 }}
        value=""
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === "") return;
          onSwap(Number(e.target.value));
        }}
      >
        <option value="">Swap in from bench...</option>
        {options.map((o) => <option key={o.idx} value={o.idx}>{playerLabel(o.player)}</option>)}
      </select>
    </div>
  );
}
