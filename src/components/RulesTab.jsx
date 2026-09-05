/* Pigskin Poker UI - extracted from
 * LegacyProject/PigskinPokerCode.jsx lines 1716-1815.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. One card has been edited since: "Lineup Lock & Injury Swaps" now states
 * THIS league's lock policy rather than one of them, because it became an option.
 */

import {
  ARROW,
  DEFAULT_SCORING,
  LINEUP_LOCK,
  SUIT_CH,
  currentStandingsPointsArray,
  firstKickoff,
  formatKickoff,
  kickoffsFor,
  lineupLockMode,
} from "../engine/index.js";

export function QuickRefTile({ label, value }) {
  return (
    <div className="pp-qr-tile">
      <div className="pp-qr-value">{value}</div>
      <div className="pp-qr-label">{label}</div>
    </div>
  );
}

export function RuleCard({ title, children }) {
  return (
    <div className="pp-card pp-card-tight" style={{ marginBottom: 10 }}>
      <h3 className="pp-h3">{title}</h3>
      <ul className="pp-rule-list">{children}</ul>
    </div>
  );
}

export function RulesTab({ state }) {
  /* Merged over the defaults so a league whose config predates the 2026-08-28 split
   * still reads out real numbers rather than blanks - the same fallback the engine
   * uses when it scores. */
  const cfg = Object.assign({}, DEFAULT_SCORING, state.scoringConfig);
  const teamCount = state.teams.length || 0;
  const spArr = currentStandingsPointsArray(state, teamCount || 1);
  return (
    <div>
      <div className="pp-card">
        <h2 className="pp-h2" style={{ marginBottom: 10 }}>Quick Reference</h2>
        <div className="pp-qr-grid">
          <QuickRefTile label={"pt per " + cfg.passYardsPerPoint + " pass yds"} value={"1 : " + cfg.passYardsPerPoint} />
          <QuickRefTile label={"pt per " + cfg.rushYardsPerPoint + " rush yds"} value={"1 : " + cfg.rushYardsPerPoint} />
          <QuickRefTile label={"pt per " + cfg.recYardsPerPoint + " rec yds"} value={"1 : " + cfg.recYardsPerPoint} />
          <QuickRefTile label="TD: pass / rush / rec" value={cfg.pointsPerPassTD + " / " + cfg.pointsPerRushTD + " / " + cfg.pointsPerRecTD} />
          <QuickRefTile label="Coach W / T / L" value={cfg.coachWin + " / " + cfg.coachTie + " / " + cfg.coachLoss} />
          <QuickRefTile label="Max TEs per team" value="2" />
          <QuickRefTile label={"Std pts (1st " + ARROW + " last)"} value={spArr.join(", ")} />
          <QuickRefTile label="Roster size" value="6 starters + 6 bench" />
        </div>
      </div>

      <RuleCard title={SUIT_CH.spade + " The Weekly Deal"}>
        <li>Every week (or playoff round), each team gets a fresh, random 12-player roster - nothing carries over.</li>
        <li>6 starters: Coach, QB, WR, RB, TE, FLEX.</li>
        <li>6 bench: one more of each (Coach, QB, WR, RB, TE), plus one more FLEX-eligible player.</li>
        <li>FLEX can only be a WR or RB - never a TE.</li>
        <li>Because of that, every team is capped at 2 TEs total, same as QB and Coach.</li>
        <li>The bench isn't tied to a slot - it's just 6 players, each shown under their real position.</li>
      </RuleCard>

      <RuleCard title={SUIT_CH.heart + " Play Schemes"}>
        <li>Each week, every manager picks one action: <strong>Block</strong>, <strong>Steal</strong>, <strong>Redraw</strong>, or <strong>No Action</strong>.</li>
        <li><strong>Block</strong> - protect one of your own starters from being stolen this week.</li>
        <li><strong>Steal</strong> - drop a player of a chosen position, take a random unprotected player of that same position from another team's starters.</li>
        <li><strong>Redraw</strong> - drop a player of a chosen position, get a random free-agent replacement at that exact position.</li>
        <li>Coach can never be selected for a scheme.</li>
        <li>Replacements are always the exact same position as what was dropped - never flexible.</li>
        <li>Dropped players go straight back into the free-agent pool, even mid-processing.</li>
        <li>Steals resolve in random order - no submission-order advantage.</li>
        <li>Schemes are never shown to other managers - only the resulting roster.</li>
      </RuleCard>

      <RuleCard title={SUIT_CH.diamond + " Scoring"}>
        <li>Yards count by type, each at its own rate: 1 point per {cfg.passYardsPerPoint} passing yards, 1 per {cfg.rushYardsPerPoint} rushing, 1 per {cfg.recYardsPerPoint} receiving.</li>
        <li>Each type converts on its own, so 15 rushing and 15 receiving yards is 1 point plus 1 point - not 3.</li>
        <li>Touchdowns: {cfg.pointsPerPassTD} for passing, {cfg.pointsPerRushTD} for rushing, {cfg.pointsPerRecTD} for receiving.</li>
        <li>Only passing, rushing and receiving count. Return yards, two-point conversions and fumble-recovery TDs are worth nothing.</li>
        <li>A starter who doesn't play scores 0 - same as anyone else who puts up nothing.</li>
        <li>Coach: {cfg.coachWin} pts for a Win, {cfg.coachTie} for a Tie, {cfg.coachLoss} for a Loss.</li>
        <li>Only starters score - bench players never score, regardless of stats.</li>
      </RuleCard>

      <RuleCard title={SUIT_CH.club + " Standings & Tiebreakers"}>
        <li>Teams are ranked by that week's score and earn standings points by finish: {spArr.join(", ")} (1st {ARROW} last).</li>
        <li>Ties share the higher value.</li>
        <li>Season standings = sum of weekly standings points, not raw weekly scores.</li>
        <li>Tiebreaker order, in this order: {["Standings Points", "Week Wins", "Coach Wins", "Total TDs", "Total Yards", "Best single-player score in a week"].join(" " + ARROW + " ")}.</li>
        <li>Best single-player score tracks the player's name, points, and week - and updates whenever a later week beats it.</li>
      </RuleCard>

      <RuleCard title={SUIT_CH.star + " Playoffs"}>
        <li>Commissioner sets a bracket size (top N teams by season standings) and an advancement list per round.</li>
        <li>Once playoffs start, regular-season standings freeze.</li>
        <li>Playoff rounds use the same cycle: {["deal", "schemes", "stats", "finalize"].join(" " + ARROW + " ")}.</li>
        <li>Same tiebreaker order applies, but scoped to that round only.</li>
        <li>Playoff periods are called "Round N" - regular season stays "Week N."</li>
        {state.playoffConfig.started ? (
          <li>Current bracket: {state.playoffConfig.bracketSize} teams, advancement {state.playoffConfig.advancement.join(" " + ARROW + " ")}.</li>
        ) : null}
      </RuleCard>

      <RuleCard title="Coaches">
        <li>Coaches can never be stolen, redrawn, or blocked.</li>
        <li>They only move between your own starting lineup and bench.</li>
      </RuleCard>

      <LineupLockCard state={state} />
    </div>
  );
}

/* What this league does about lineup changes, in its own terms.
 *
 * Written from the setting rather than describing both, because a rules screen that
 * lists the options is a rules screen nobody can act on: a manager wants to know
 * whether he can still move his receiver at four o'clock, not what leagues in general
 * do. The kickoff line is there for the same reason - the deadline is a time, so it
 * says the time.
 */
export function LineupLockCard({ state }) {
  const mode = lineupLockMode(state);
  const kickoffs = kickoffsFor(state);
  const first = firstKickoff(kickoffs);
  const known = Object.keys(kickoffs).length > 0;

  return (
    <RuleCard title="Lineup Lock & Injury Swaps">
      <li>After schemes are processed, the commissioner can lock rosters for the weekend, which closes further scheme submission.</li>
      {mode === LINEUP_LOCK.WEEKLY ? (
        <>
          <li><strong>This league locks every lineup at the week's first kickoff</strong>{first ? " - " + formatKickoff(first) + " this week" : ""}. What you have in your lineup then is what plays.</li>
          <li>Injuries and inactives announced after that are your bad luck, the same as starting a player who is ruled out.</li>
        </>
      ) : (
        <>
          <li><strong>This league locks each player when his own game starts.</strong> You can keep changing your lineup all day, using players whose games have not kicked off yet.</li>
          <li>So a one o'clock starter is frozen at one o'clock, and a Sunday-night receiver can still come in at seven.</li>
        </>
      )}
      {!known ? <li>Kickoff times have not been read for this week, so only the commissioner's own locks apply.</li> : null}
      <li>The commissioner can lock any individual player by hand at any time - for a late scratch, say - and that lock always holds.</li>
      <li>Lineup swaps always route a starter through the bench - you can never directly swap two starters.</li>
    </RuleCard>
  );
}

/* =============================== Commissioner ================================ */

