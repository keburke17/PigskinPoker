/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1529-1649.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { useState } from "react";
import {
  PRIMARY_CATEGORIES,
  STAT_CATEGORIES,
  computeStarterPoints,
  getPlayer,
  hasSplitStats,
} from "../engine/index.js";
import { ConfirmButton, EmptyState, ErrorBanner, SuitBadge } from "./atoms.jsx";
import { RosterSlotRow } from "./roster.jsx";

/* The stat boxes for one non-Coach starter.
 *
 * Yards and touchdowns split into passing / rushing / receiving on 2026-08-28 (OQ-4c),
 * which is six boxes if they are all shown at once. They are not: each position leads
 * with the two it actually needs, and the rest open on a toggle - so entering a week is
 * the same two boxes per player it has always been, and a running quarterback or a
 * receiving back is one click away rather than impossible.
 */
export function StatCategoryInputs({ position, stats, onChange }) {
  const primary = PRIMARY_CATEGORIES[position] || ["rushYards", "rushTds"];
  const extras = STAT_CATEGORIES.filter((c) => !primary.includes(c.field));
  const hasExtra = extras.some((c) => {
    const v = stats[c.field];
    return v != null && v !== "" && Number(v) !== 0;
  });
  const [open, setOpen] = useState(false);
  const showExtras = open || hasExtra;

  /* A line recorded before the split cannot be converted - a combined total does not say
   * how much of it was passing - so it is reported rather than silently dropped. */
  const legacy = !hasSplitStats(stats) && (stats.yards != null || stats.tds != null)
    && (stats.yards !== "" || stats.tds !== "");

  const set = (field, value) => {
    const next = Object.assign({}, stats, { [field]: value });
    delete next.yards;
    delete next.tds;
    onChange(next);
  };

  const box = (c) => (
    <input
      key={c.field}
      className="pp-input"
      style={{ width: c.kind === "yards" ? 74 : 58 }}
      type="number"
      placeholder={c.label}
      title={c.label}
      value={stats[c.field] != null ? stats[c.field] : ""}
      onChange={(e) => set(c.field, e.target.value)}
    />
  );

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {STAT_CATEGORIES.filter((c) => primary.includes(c.field)).map(box)}
      {showExtras ? STAT_CATEGORIES.filter((c) => !primary.includes(c.field)).map(box) : null}
      {!showExtras ? (
        <button className="pp-btn pp-btn-sm pp-btn-ghost" title="Show passing, rushing and receiving boxes" onClick={() => setOpen(true)}>+ more</button>
      ) : null}
      {legacy ? (
        <span className="pp-sub" style={{ fontSize: 11 }}>
          was {stats.yards || 0} yds, {stats.tds || 0} TD before the split
        </span>
      ) : null}
    </div>
  );
}

export function StatEntryRow({ state, team, slot, isCommissioner, onChange }) {
  const pid = team.roster.starters[slot];
  const player = getPlayer(state, pid);
  const stats = (state.statsEntry[team.id] || {})[slot] || {};
  const locks = state.lockedPlayerIds || {};
  const locked = pid && locks[pid];
  if (!player) return <RosterSlotRow slot={slot} player={null} state={state} showStats={false} />;

  if (!isCommissioner) {
    return <RosterSlotRow slot={slot} player={player} state={state} statLine={stats} locked={locked} showStats={true} />;
  }

  return (
    <div className="pp-roster-slot" style={{ flexWrap: "wrap" }}>
      <span className="pp-roster-slot-label">{slot}</span>
      <SuitBadge position={player.position} />
      <div style={{ flex: 1, minWidth: 120 }}>
        <div className="pp-roster-slot-name">{player.name}</div>
        <div className="pp-roster-slot-meta">{player.position} - {player.team}</div>
      </div>
      {player.position === "Coach" ? (
        <select className="pp-select" style={{ width: 120 }} value={stats.result || ""} onChange={(e) => onChange(team.id, slot, { result: e.target.value || null })}>
          <option value="">Result...</option>
          <option value="Win">Win</option>
          <option value="Tie">Tie</option>
          <option value="Loss">Loss</option>
        </select>
      ) : (
        <StatCategoryInputs position={player.position} stats={stats} onChange={(next) => onChange(team.id, slot, next)} />
      )}
      <span className="pp-roster-slot-pts">{computeStarterPoints(state, stats, player.position)} pts</span>
      <button className={"pp-btn pp-btn-sm " + (locked ? "pp-btn-danger" : "pp-btn-ghost")} onClick={() => onChange(team.id, "__togglelock__", pid)}>
        {locked ? "Unlock" : "Lock"}
      </button>
    </div>
  );
}

export function teamRunningScore(state, team) {
  if (!team.roster) return 0;
  const stats = (state.statsEntry && state.statsEntry[team.id]) || {};
  let total = 0;
  ["Coach", "QB", "WR", "RB", "TE", "FLEX"].forEach((slot) => {
    const pid = team.roster.starters[slot];
    const player = getPlayer(state, pid);
    total += computeStarterPoints(state, stats[slot], player ? player.position : slot);
  });
  return total;
}

export function LiveScoresBar({ state, teams }) {
  const rows = teams.filter((t) => t.roster).map((t) => ({ team: t, score: teamRunningScore(state, t) }))
    .sort((a, b) => b.score - a.score);
  if (rows.length === 0) return null;
  return (
    <div className="pp-card">
      <h3 className="pp-h3">This {state.currentPeriod.type === "playoff" ? "Round's" : "Week's"} Scores</h3>
      <table className="pp-table">
        <thead><tr><th style={{ width: 30 }}>#</th><th>Team</th><th style={{ textAlign: "right" }}>Score</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.team.id}>
              <td>{i + 1}</td>
              <td style={{ fontWeight: 700 }}>{r.team.name}</td>
              <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--gold-bright)" }}>{r.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pp-sub" style={{ marginTop: 8, marginBottom: 0 }}>Updates live as stats are entered - only counts starters that already have a stat line.</p>
    </div>
  );
}

/* Pull this week's numbers off the feed.
 *
 * Says why it cannot rather than just sitting there greyed out - both preconditions are
 * things the commissioner can fix in one click, and a dead button that explains nothing
 * is how a feature gets a reputation for being broken. The server checks both again
 * regardless; this is the explanation, not the gate.
 */
function PullStatsButton({ state, onPullStats }) {
  const [busy, setBusy] = useState(false);
  const nflWeek = (state._meta && state._meta.nflWeek) ?? null;
  const blocked = !nflWeek
    ? "Set this week's NFL week on the Commissioner tab first - the pull needs to know which week to ask for."
    : !state.rosterLocked
      ? "Lock the rosters first, so the numbers cannot end up on a different player."
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        className="pp-btn pp-btn-gold"
        disabled={!!blocked || busy}
        title={blocked || "Fills every starter's boxes from NFL week " + nflWeek}
        onClick={async () => {
          setBusy(true);
          try {
            await onPullStats();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Reading the feed..." : "Pull Stats"}
      </button>
      {blocked ? <span className="pp-sub" style={{ maxWidth: 260, textAlign: "right" }}>{blocked}</span> : null}
    </div>
  );
}

/* What the pull did, and - the part that matters - what it deliberately did not do.
 *
 * A button that silently filled in six boxes per team would be worth less than typing
 * them, because nobody could tell which numbers came from where. This says which slots
 * it filled, which it left alone because they were typed by hand, and which it had
 * nothing for at all. See docs/PHASE-4-PLAN.md section 7, stage 6 - the persistent
 * "the feed says 91, you set 84" beside each box builds on this.
 */
export function StatsPullReport({ report }) {
  if (!report) return null;
  const { filled = [], kept = [], keptAgreeing = 0, missing = [], nflWeek } = report;
  const when = report.at ? String(report.at).replace("T", " ").replace(/\..*/, " UTC") : "just now";
  return (
    <div className="pp-card pp-card-tight">
      <h3 className="pp-h3">What the pull filled in</h3>
      <p className="pp-sub">NFL week {nflWeek}, read {when}.</p>
      <ul className="pp-rule-list">
        <li>{filled.length} stat line{filled.length === 1 ? "" : "s"} filled in from the feed.</li>
        {keptAgreeing > 0 ? <li>{keptAgreeing} of yours left as they were - the feed agrees with them.</li> : null}
      </ul>
      {kept.length > 0 && (
        <>
          <p className="pp-sub" style={{ marginBottom: 4 }}>
            <strong>Left alone - yours, not the feed's</strong>
          </p>
          <ul className="pp-rule-list">
            {kept.slice(0, 12).map((k, i) => (
              <li key={i}>
                {k.team} {k.slot} ({k.player}) - {k.differences
                  .map((d) => "you have " + (d.label || d.field) + " " + (d.yours ?? "blank") + ", the feed says " + d.feed)
                  .join("; ")}.
              </li>
            ))}
            {kept.length > 12 ? <li>...and {kept.length - 12} more.</li> : null}
          </ul>
        </>
      )}
      {missing.length > 0 && (
        <>
          <p className="pp-sub" style={{ marginBottom: 4 }}>
            <strong>The feed had nothing for these</strong>
          </p>
          <ul className="pp-rule-list">
            {missing.slice(0, 12).map((m, i) => (
              <li key={i}>{m.team} {m.slot}{m.player ? " (" + m.player + ")" : ""} - {m.why}.</li>
            ))}
            {missing.length > 12 ? <li>...and {missing.length - 12} more.</li> : null}
          </ul>
          <p className="pp-sub">
            They are left blank, which scores zero - the same as a starter who did not
            play. If a game has not finished yet, pull again once it has.
          </p>
        </>
      )}
    </div>
  );
}

export function LiveStatsTab({ state, isCommissioner, onStatChange, onToggleRosterLock, onFinalize, finalizeError, onPullStats, statsReport }) {
  const teamsForPeriod = state.currentPeriod.type === "playoff"
    ? state.teams.filter((t) => state.playoffConfig.activeTeamIds.includes(t.id))
    : state.teams;

  if (teamsForPeriod.length === 0) return <EmptyState>No teams to show stats for.</EmptyState>;
  if (teamsForPeriod.every((t) => !t.roster)) return <EmptyState>No roster dealt yet this period.</EmptyState>;

  return (
    <div>
      {isCommissioner && (
        <div className="pp-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h3 className="pp-h3" style={{ marginBottom: 2 }}>Commissioner Controls</h3>
              <p className="pp-sub">Enter stats for each starter, then finalize the {state.currentPeriod.type === "playoff" ? "round" : "week"} once everyone's in.</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {onPullStats ? <PullStatsButton state={state} onPullStats={onPullStats} /> : null}
              <button className={"pp-btn " + (state.rosterLocked ? "pp-btn-danger" : "")} onClick={onToggleRosterLock}>
                {state.rosterLocked ? "Unlock Rosters" : "Lock Rosters for the Weekend"}
              </button>
              <ConfirmButton label={"Finalize " + (state.currentPeriod.type === "playoff" ? "Round" : "Week")} confirmLabel="Yes, finalize" onConfirm={onFinalize} />
            </div>
          </div>
          {finalizeError ? <ErrorBanner message={finalizeError} /> : null}
        </div>
      )}
      {isCommissioner ? <StatsPullReport report={statsReport} /> : null}
      <LiveScoresBar state={state} teams={teamsForPeriod} />
      {teamsForPeriod.map((team) => (
        <div key={team.id} className="pp-card">
          <h3 className="pp-h3">{team.name}</h3>
          {!team.roster ? <EmptyState>No roster dealt.</EmptyState> : (
            ["Coach", "QB", "WR", "RB", "TE", "FLEX"].map((slot) => (
              <StatEntryRow key={slot} state={state} team={team} slot={slot} isCommissioner={isCommissioner} onChange={onStatChange} />
            ))
          )}
        </div>
      ))}
    </div>
  );
}

/* ========================= Combined Rosters / FA / Stats hub ========================= */

