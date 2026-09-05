/* Pigskin Poker UI - the starting lineup and its bench swaps.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 1358-1418. Changed since: the
 * rows can carry points once the week is dealt (issue #29).
 */

import { getPlayer, playerLabel } from "../engine/index.js";
import { RosterSlotRow } from "./roster.jsx";
import { eligibleBenchForSlot } from "./scheme.jsx";

/* `showStats` arrives once the week is dealt. Without it this screen showed you your own
 * lineup with no points on it anywhere - the one place in the app you would most expect to
 * find them (issue #29). The swap controls are unaffected: they disappear on their own
 * once the rosters lock. */
export function LineupEditor({ state, team, onSwap, showStats }) {
  const locks = state.lockedPlayerIds || {};
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
      {["Coach", "QB", "WR", "RB", "TE", "FLEX"].map((slot) => {
        const pid = team.roster.starters[slot];
        const player = getPlayer(state, pid);
        const starterLocked = pid && locks[pid];
        const options = eligibleBenchForSlot(state, team, slot);
        return (
          <div key={slot} style={{ marginBottom: 8 }}>
            <RosterSlotRow slot={slot} player={player} state={state} statLine={stats[slot]} locked={starterLocked} showStats={!!showStats} />
            {options.length > 0 ? (
              <SwapRow
                disabled={starterLocked}
                options={options}
                onSwap={(benchIdx) => {
                  const benchPlayer = getPlayer(state, team.roster.bench[benchIdx]);
                  if (benchPlayer && locks[benchPlayer.id]) return;
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

