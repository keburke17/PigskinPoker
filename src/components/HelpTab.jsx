/* Pigskin Poker - how to USE the site, as opposed to how the game works.
 *
 * Issue #25: six tabs and not one of them answered "what do I do here?". The Rules tab
 * is very good and is a different document - it describes the game (the deal, schemes,
 * scoring, tiebreakers). Nothing told a manager when a scheme is due, or a commissioner
 * that the week is a five-phase cycle they have to drive.
 *
 * SITS BESIDE RULES, DOES NOT REPLACE IT. #25 left that open and came down on "beside is
 * probably right": Rules reads out the league's live scoring config and is reference;
 * this is prose and a walkthrough. Merging them would mean one screen with two voices.
 * The cost is a seventh nav pill on the commissioner's phone, which is real - see the
 * note on NAV in src/App.jsx and OQ-H in docs/OPEN-QUESTIONS.md.
 *
 * The "your next step" line at the top comes from the same nextStep() the welcome
 * overlay uses, so the short version and the long version cannot disagree.
 *
 * THE LOCK CARD READS THIS LEAGUE'S POLICY, it does not describe one. Lineup lock
 * became a league option in #34 (OQ-11) and this card was missed - it still said
 * "nothing locks automatically", which stopped being true the day that shipped and is
 * the single fact a manager most needs right. It now branches the way the Rules tab's
 * "Lineup Lock & Injury Swaps" card does, off the same lineupLockMode(). Whichever of
 * these two screens someone reads, they get their own league's rule.
 */

import {
  LINEUP_LOCK,
  firstKickoff,
  formatKickoff,
  kickoffsFor,
  lineupLockMode,
} from "../engine/index.js";
import { nextStep } from "./guidance.js";
import { RuleCard } from "./RulesTab.jsx";

export function HelpTab({ state, role, team, onGoTo }) {
  const step = nextStep(state, role, team);
  const isCommissioner = role === "commissioner";
  /* The league's lineup-lock policy, read the same way RulesTab reads it. `first` is
   * null until the week's kickoffs have been fetched, which is a real state - a league
   * whose schedule has not been read locks on nothing but the commissioner's own
   * buttons, and saying so is better than naming a deadline that is not there. */
  const weekly = lineupLockMode(state) === LINEUP_LOCK.WEEKLY;
  const first = firstKickoff(kickoffsFor(state));

  return (
    <div>
      <div className="pp-card">
        <h2 className="pp-h2" style={{ marginBottom: 6 }}>Start here</h2>
        <p className="pp-sub" style={{ marginBottom: 10 }}>
          Every week each team is dealt a brand-new random 12-player roster. You pick 6
          starters, play one scheme against the other managers, and the week is scored
          and turned into standings points. Then it happens again, from scratch.
        </p>
        <div className="pp-overlay-step">
          <div className="pp-overlay-step-head">{step.headline}</div>
          <p className="pp-sub" style={{ marginBottom: 0 }}>{step.detail}</p>
        </div>
        {step.tab ? (
          <button className="pp-btn pp-btn-gold" style={{ marginTop: 10 }} onClick={() => onGoTo(step.tab)}>
            {step.tab === "myteam" ? "Go to My Team" : "Go to Commissioner"}
          </button>
        ) : null}
      </div>

      <RuleCard title="Your week, as a manager">
        <li><strong>1. The roster is dealt.</strong> Your commissioner presses Deal. Until then there is genuinely nothing for you to do, and My Team will show empty slots.</li>
        <li><strong>2. Set your lineup.</strong> My Team - swap a bench player into a matching starting slot. Every change routes through the bench; you can never swap two starters directly.</li>
        <li><strong>3. Submit a scheme.</strong> Same screen, at the bottom. Block, Steal, Redraw or No Action. You can change it as often as you like until it is processed.</li>
        <li><strong>4. Schemes are processed.</strong> All blocks resolve first, then steals and redraws together in random order. Your roster can change here - someone may take a starter you did not protect.</li>
        <li><strong>5. The weekend.</strong> Rosters get locked, which closes scheme submission. Lineup swaps stay open per player until that player's real game starts.</li>
        <li><strong>6. Results.</strong> The commissioner enters or pulls the stats and finalizes. Standings points are awarded and the next week opens.</li>
      </RuleCard>

      {isCommissioner ? (
        <RuleCard title="Running a week, as commissioner">
          <li><strong>First time only:</strong> add your teams (Commissioner {ARROW} Teams), then send invites (Commissioner {ARROW} Invite). Optionally refresh the player pool, set your scoring rates, and set which NFL week this period plays.</li>
          <li><strong>1. Deal.</strong> Commissioner {ARROW} Weeks {ARROW} Deal Rosters. Needs at least one team.</li>
          <li><strong>2. Wait for schemes.</strong> The same panel lists who is in and who is still out. Managers can keep changing theirs until you move.</li>
          <li><strong>3. Process Schemes.</strong> Resolves every block, steal and redraw at once. This is the real scheme deadline - there is no clock, so tell your league when you intend to press it.</li>
          <li><strong>4. Lock Rosters for the Weekend.</strong> Commissioner {ARROW} Enter Stats. Closes scheme submission. Lock individual players as their games kick off to stop late lineup swaps.</li>
          <li><strong>5. Stats.</strong> Type them, or press Pull Stats to fill every starter's boxes from the NFL week. Pulling never overwrites a line you typed yourself.</li>
          <li><strong>6. Finalize.</strong> Scores the week, awards standings points, opens the next one. This one commits.</li>
        </RuleCard>
      ) : null}

      <RuleCard title="What each screen does">
        <li><strong>Scoreboard</strong> - the week in progress. Live scores, and a projected standings-points column that is read-only until the week is finalized.</li>
        <li><strong>My Team</strong> - your roster, your lineup swaps, and your scheme. The only screen where you do anything.</li>
        <li><strong>League</strong> - season standings, playoff bracket, and the activity log of steals, blocks and redraws.</li>
        <li><strong>Rosters</strong> - everybody's rosters and the free-agent pool.</li>
        <li><strong>Rules</strong> - the game itself: scoring rates, tiebreakers, playoffs. The numbers there are read from your league's own settings.</li>
        {isCommissioner ? <li><strong>Commish</strong> - Enter Stats and Weeks run the week; Teams, Invite, Player Pool, Scoring, Standings Cfg and Playoffs are setup; Manage Rosters acts on a manager's behalf; Backup and Reset are the escape hatches.</li> : null}
      </RuleCard>

      <RuleCard title="When something locks">
        <li><strong>Schemes close when your commissioner processes the week.</strong> There is no clock on that one - it happens when they press the button, so get yours in early.</li>
        {weekly ? (
          <>
            <li><strong>Your whole lineup closes at the week&apos;s first kickoff</strong>{first ? ", which is " + formatKickoff(first) + " this week" : ""}. What you have set then is what plays, all weekend.</li>
            <li>Injury news after that is bad luck rather than something to fix - the same as starting a player who turns out to be ruled out.</li>
          </>
        ) : (
          <>
            <li><strong>Each player freezes when his own game kicks off</strong>{first ? ", starting with " + formatKickoff(first) + " this week" : ""}. Everyone else stays swappable, so a late-window receiver can still come in on Sunday evening.</li>
            <li>That is why a player can show a LOCKED pill while the rest of your lineup is still open.</li>
          </>
        )}
        {!first ? <li><strong>This week&apos;s kickoff times have not been read yet</strong>, so nothing is locking on the clock right now - only the commissioner&apos;s own locks apply.</li> : null}
        <li><strong>Your commissioner can lock any player by hand</strong>, at any time - a late scratch, say - and that lock always wins.</li>
        <li>Rules spells this out in full, in your league&apos;s own terms, under Lineup Lock &amp; Injury Swaps.</li>
      </RuleCard>

      <RuleCard title="Words we use">
        <li><strong>Scheme</strong> - your one action for the week: Block, Steal, Redraw or No Action.</li>
        <li><strong>Block</strong> - protect one of your starters from being stolen.</li>
        <li><strong>Steal</strong> - drop a player at a position, take a random unprotected starter at that position from another team.</li>
        <li><strong>Redraw</strong> - drop a player at a position, take a random free agent at that same position.</li>
        <li><strong>FLEX</strong> - a starting slot that takes a WR or a RB, never a TE.</li>
        <li><strong>Standings points</strong> - what you earn for your finishing place in a week. The season table sums these, not raw scores.</li>
        <li><strong>Period</strong> - a week in the regular season, a round in the playoffs.</li>
        <li><strong>Phase</strong> - where the current period is in its cycle: not dealt, schemes open, rosters locked, stats in progress.</li>
        <li><strong>Free agent</strong> - any player not on a roster this week. Dropped players go straight back, even mid-processing.</li>
      </RuleCard>

      <RuleCard title="When something looks wrong">
        <li><strong>"Saved at ..." in the header</strong> is the app's save state. "Save failed - retrying" means it is still trying; your change is not lost, and Save Now forces it.</li>
        <li><strong>A conflict banner</strong> means somebody else changed the same thing first. Your change was not applied and nothing of theirs was overwritten - make it again if you still want it.</li>
        <li><strong>A greyed-out Deal button</strong> means the league has no teams yet.</li>
        <li><strong>A greyed-out Pull Stats</strong> means either no NFL week is set for this period, or the rosters are not locked yet - it will tell you which.</li>
        <li><strong>A LOCKED pill</strong> on a player means the commissioner froze that slot. Ask them if it looks wrong.</li>
        <li><strong>Sign-in links</strong> arrive by email and are single-use. If one has expired, ask for another from the sign-in screen.</li>
      </RuleCard>
    </div>
  );
}

/* Prose arrow. Source is ASCII-only (CLAUDE.md, Conventions) - the engine's CP() glyphs
 * are for rendered symbols like the suits, not for a hyphen in a sentence. */
const ARROW = " -> ";
