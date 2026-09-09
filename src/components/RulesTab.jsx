/* Pigskin Poker UI - originally extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1716-1815, with only module boundaries
 * added: imports at the top, `export` on each declaration.
 *
 * SINCE EDITED, deliberately, because this screen is the rules as the league reads
 * them and it had fallen behind the game:
 *   2026-08-28 - the scoring card, for the passing / rushing / receiving split (OQ-4c).
 *   2026-09-05 - "Lineup Lock & Injury Swaps" states THIS league's lock policy rather
 *     than one of them, because the lock timing became an option (OQ-11).
 *   2026-09-06 - a Player Pool card (the live depth charts, injuries, and what a
 *     refresh may not do), the coaches line, and the tiebreaker card, which had
 *     documented six tiebreakers since the artifact while the engine applied five.
 *     That is OQ-A, now fixed, so the screen and the game finally agree.
 *   2026-09-07 - the scheme deadline and the weekly rollover, because a league can now
 *     run either on a clock (issue #52, OQ-14). "Schemes close when the commissioner
 *     processes the week" is the rule for a league that has not switched that on, and
 *     the wrong rule - in the expensive direction - for one that has.
 *   2026-09-08 - the standings-points line names the reverse ladder and says it is fixed
 *     (OQ-13, issue #48). It used to print a list of numbers without saying where they
 *     came from, which was fine while a commissioner could change them and misleading
 *     the moment he could not.
 *
 * docs/RULES.md is the long form of the same thing. Change both together. */

import {
  ARROW,
  DEFAULT_SCORING,
  LINEUP_LOCK,
  SUIT_CH,
  advanceDeadlineWords,
  autoAdvanceWeek,
  autoProcessSchemes,
  currentStandingsPointsArray,
  firstKickoff,
  formatKickoff,
  kickoffsFor,
  lineupLockMode,
  schemeDeadlineWords,
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
        {autoAdvanceWeek(state) ? (
          <li><strong>The week is scored and the next one dealt at {advanceDeadlineWords(state)}</strong>, once every game of the NFL week is final. The first week of a season, and every playoff round, still wait for the commissioner.</li>
        ) : null}
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
        {autoProcessSchemes(state) ? (
          <li><strong>Schemes are processed at {schemeDeadlineWords(state)}</strong>, on the clock. Submit nothing by then and you play No Action.</li>
        ) : (
          <li>Schemes are processed when the commissioner presses the button - there is no clock on it.</li>
        )}
      </RuleCard>

      <RuleCard title={SUIT_CH.diamond + " Scoring"}>
        <li>Yards count by type, each at its own rate: 1 point per {cfg.passYardsPerPoint} passing yards, 1 per {cfg.rushYardsPerPoint} rushing, 1 per {cfg.recYardsPerPoint} receiving.</li>
        <li>Every yard counts for the fraction of a point it earns, and your total is rounded to one decimal. Nothing is rounded down and thrown away.</li>
        <li>Each type still converts at its own rate, so 15 rushing and 15 receiving yards is 1.5 plus 1.5 - which is 3.</li>
        <li>Touchdowns: {cfg.pointsPerPassTD} for passing, {cfg.pointsPerRushTD} for rushing, {cfg.pointsPerRecTD} for receiving.</li>
        <li>Only passing, rushing and receiving count. Return yards, two-point conversions and fumble-recovery TDs are worth nothing.</li>
        <li>A starter who doesn't play scores 0 - same as anyone else who puts up nothing.</li>
        <li>Coach: {cfg.coachWin} pts for a Win, {cfg.coachTie} for a Tie, {cfg.coachLoss} for a Loss.</li>
        <li>Only starters score - bench players never score, regardless of stats.</li>
      </RuleCard>

      <RuleCard title={SUIT_CH.club + " Standings & Tiebreakers"}>
        <li>Teams are ranked by that week's score and earn standings points by finish, on a <strong>reverse ladder</strong>: the winner of the week takes one point per team in the league, and each place below takes one fewer, down to 1 for last.</li>
        {teamCount > 0 ? (
          <li>This league has {teamCount} team{teamCount === 1 ? "" : "s"}, so the ladder is {spArr.join(", ")} (1st {ARROW} last). It always matches the team count, so it grows when a team joins - and it is fixed, with no setting behind it.</li>
        ) : (
          <li>This league has no teams yet, so there is no ladder to show. It always matches the team count, and it is fixed - there is no setting behind it.</li>
        )}
        <li>Ties share the higher value.</li>
        <li>Season standings = sum of weekly standings points, not raw weekly scores.</li>
        <li>Tiebreaker order, in this order: {["Standings Points", "Week Wins", "Coach Wins", "Total TDs", "Total Yards", "Best single-player score in a week"].join(" " + ARROW + " ")}.</li>
        <li>Best single-player score tracks the player's name, points, and week - and updates whenever a later week beats it. Your Coach counts, if he ever gets you the most points in a week.</li>
        <li>A tie inside a single week uses the same six tiebreakers, on season-to-date totals - so it goes to whoever is already ahead in the season.</li>
        <li>Teams level on all six share a rank, and the next rank is skipped.</li>
      </RuleCard>

      <RuleCard title={SUIT_CH.star + " Playoffs"}>
        <li>The commissioner sets the NFL week the playoffs start in, how many teams make it, and how they advance - and the bracket starts itself when that week arrives. There is no button to press on the day.</li>
        <li>Only the teams in the bracket are dealt a roster. Miss the cut and your season is over.</li>
        <li>Once playoffs start, regular-season standings freeze, and the bracket settings lock for the season.</li>
        <li>Playoff rounds use the same cycle: {["deal", "schemes", "stats", "finalize"].join(" " + ARROW + " ")}.</li>
        <li>Same tiebreaker order applies, but scoped to that round only.</li>
        <li>Playoff periods are called "Round N" - regular season stays "Week N."</li>
        {state.playoffConfig.started ? (
          <li>Current bracket: {state.playoffConfig.bracketSize} teams, advancement {state.playoffConfig.advancement.join(" " + ARROW + " ")}.</li>
        ) : state.playoffConfig.startNflWeek != null ? (
          <li>This league: the top {state.playoffConfig.bracketSize} teams, starting in NFL week {state.playoffConfig.startNflWeek}, advancing {state.playoffConfig.advancement.join(" " + ARROW + " ")}.</li>
        ) : (
          <li>This league has not set a playoff week yet, so the playoffs will not start. The commissioner sets it under Commish {ARROW} Playoffs.</li>
        )}
      </RuleCard>

      <RuleCard title="Coaches">
        <li><strong>The Coach card is really the team.</strong> It scores the NFL team's result that week - Win, Tie or Loss - and the coach's name has nothing to do with the points. His name is on the card because it is more fun that way.</li>
        <li>Coaches can never be stolen, redrawn, or blocked.</li>
        <li>They only move between your own starting lineup and bench.</li>
        <li>No feed writes a coach's name. The game's admins keep one list of all 32 and correct it by hand, so a wrong name is a typo to report rather than anything that can cost you a point.</li>
      </RuleCard>

      <RuleCard title="The Player Pool">
        <li>Your league has its own pool. Marking a player OUT is a statement about this league - it never reaches anyone else's.</li>
        <li>The pool is built from the live NFL depth charts: each NFL team's current QB, 2 RBs, 2 WRs and TE, plus its head coach.</li>
        <li>The commissioner refreshes it before dealing, and only before dealing - there are no rosters to disturb yet.</li>
        <li>A refresh adds new starters and retires players who are no longer rostered. Retired means marked OUT, never deleted, so past weeks still make sense.</li>
        <li>Injuries come from the weekly roster file: a player on reserve is marked IR, anyone else off the active roster is marked OUT.</li>
        <li>An injured starter is skipped and the next healthy man takes the slot, so every NFL team still contributes a full QB / 2 RB / 2 WR / TE.</li>
        <li>A refresh never overwrites the commissioner: a player he added, or a status he set by hand, is left alone.</li>
        <li>Only Active players are dealt - OUT, IR and BYE are all skipped.</li>
        <li><strong>A player whose NFL team is on a bye is not dealt either</strong>, and cannot be stolen or redrawn. He comes back automatically the week his team plays again.</li>
        <li>Once you're dealt, you're dealt. A player who gets hurt or whose coach is fired mid-week still finishes your week; the change shows up at the next deal.</li>
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
      <li>After schemes are processed, the commissioner can lock rosters for the weekend, which closes further scheme submission.{autoProcessSchemes(state) ? " In this league that happens on its own at " + schemeDeadlineWords(state) + ", when the schemes are processed." : ""}</li>
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

