/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1716-1815.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { ARROW, SUIT_CH, currentStandingsPointsArray } from "../engine/index.js";

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
  const cfg = state.scoringConfig;
  const teamCount = state.teams.length || 0;
  const spArr = currentStandingsPointsArray(state, teamCount || 1);
  return (
    <div>
      <div className="pp-card">
        <h2 className="pp-h2" style={{ marginBottom: 10 }}>Quick Reference</h2>
        <div className="pp-qr-grid">
          <QuickRefTile label={"pt per " + cfg.yardsPerPoint + " yds"} value={"1 : " + cfg.yardsPerPoint} />
          <QuickRefTile label="pts per TD" value={cfg.pointsPerTD} />
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
        <li>1 point per {cfg.yardsPerPoint} yards.</li>
        <li>{cfg.pointsPerTD} points per TD.</li>
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

      <RuleCard title="Lineup Lock & Injury Swaps">
        <li>After schemes are processed, the commissioner can lock rosters for the weekend, which closes further scheme submission.</li>
        <li>Even while locked, the commissioner can mark individual players as locked once their real-life game starts.</li>
        <li>Managers can still freely swap any non-locked player in or out of their lineup, right up until that player's game begins.</li>
        <li>Lineup swaps always route a starter through the bench - you can never directly swap two starters.</li>
      </RuleCard>
    </div>
  );
}

/* =============================== Commissioner ================================ */

