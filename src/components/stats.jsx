/* The commissioner's stat entry, and the two feed buttons that fill it in.
 *
 * Originally LegacyProject/PigskinPokerCode.jsx lines 1529-1649, extracted verbatim. Since
 * then: the split stat boxes (OQ-4c), Pull Stats and its report, the LOCKED pill reading
 * the league's lineup-lock policy rather than only the commissioner's own lock, and - for
 * issues #29 and #30 - the removal of `LiveScoresBar` and `teamRunningScore` from this
 * file.
 *
 * That scoreboard used to be the ONLY place in the app a team total appeared, buried under
 * the controls below. It is now the Scoreboard tab; the sum behind it moved into the
 * engine as `teamPeriodScore`, which is also what let roster.jsx show a total without
 * importing from this file (roster.jsx <- stats.jsx already, so the other direction was a
 * cycle). This screen keeps the number where the commissioner is actually typing: on each
 * team's heading.
 */

import { useState } from "react";
import {
  PRIMARY_CATEGORIES,
  STAT_CATEGORIES,
  computeStarterPoints,
  getPlayer,
  hasSplitStats,
  isPlayerLocked,
  periodTeams,
  teamPeriodScore,
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
  /* The pill and the button say different things on purpose: `locked` is whether the
   * player can be moved at all (manual lock or the league's kickoff policy), while the
   * button below toggles only the MANUAL half - the commissioner cannot un-start a
   * football game. */
  const locked = !!pid && isPlayerLocked(state, pid);
  const manualLocked = !!pid && !!(state.lockedPlayerIds || {})[pid];
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
      <button className={"pp-btn pp-btn-sm " + (manualLocked ? "pp-btn-danger" : "pp-btn-ghost")} onClick={() => onChange(team.id, "__togglelock__", pid)}>
        {manualLocked ? "Unlock" : "Lock"}
      </button>
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

/* Let the schedule press that button instead.
 *
 * Worded as what it DOES rather than as a feature name, because the thing a
 * commissioner needs to know before ticking it is that it changes who presses the
 * button and nothing else: the same guards, the same refusal to touch a line he typed,
 * and the same requirement that he lock the rosters first. It cannot deal, process or
 * finalize - the week still ends when he says it does.
 */
function AutoPullToggle({ state, onSetAutoPullStats }) {
  const [busy, setBusy] = useState(false);
  const on = !!(state._meta && state._meta.autoPullStats);
  return (
    <label
      className="pp-sub"
      style={{ display: "flex", alignItems: "center", gap: 6, cursor: busy ? "wait" : "pointer", maxWidth: 260, textAlign: "right" }}
      title="Checks the feed every few hours and fills in whatever has been published. It never overwrites a number you typed, and it still needs the rosters locked."
    >
      <input
        type="checkbox"
        checked={on}
        disabled={busy}
        onChange={async (e) => {
          const next = e.target.checked;
          setBusy(true);
          try {
            await onSetAutoPullStats(next);
          } finally {
            setBusy(false);
          }
        }}
      />
      <span>Pull automatically, every few hours</span>
    </label>
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

export function LiveStatsTab({ state, isCommissioner, onStatChange, onToggleRosterLock, onFinalize, finalizeError, onPullStats, statsReport, onSetAutoPullStats }) {
  const teamsForPeriod = periodTeams(state);

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
              {onPullStats ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  <PullStatsButton state={state} onPullStats={onPullStats} />
                  {onSetAutoPullStats ? <AutoPullToggle state={state} onSetAutoPullStats={onSetAutoPullStats} /> : null}
                </div>
              ) : null}
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
      {teamsForPeriod.map((team) => (
        <div key={team.id} className="pp-card">
          <div className="pp-roster-head pp-roster-head-static">
            <span className="pp-roster-head-name">{team.name}</span>
            {team.roster ? <span className="pp-roster-head-pts">{teamPeriodScore(state, team)}</span> : null}
          </div>
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

