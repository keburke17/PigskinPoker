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
 *
 * THE SAME TRAP, TWICE OVER, SINCE ISSUE #52. A league can now have its scheme deadline
 * and its Tuesday finalize-and-deal run on a clock (OQ-14, off by default). Every
 * sentence on this screen that said "your commissioner presses X" or "there is no
 * clock" is FALSE for a league that has switched them on - and it is false in the
 * direction that costs a manager his week. So each of those sentences branches on
 * autoProcessSchemes()/autoAdvanceWeek(), and there is a card whose whole job is to
 * list what moves without anybody pressing anything.
 */

import {
  LINEUP_LOCK,
  advanceDeadlineWords,
  autoAdvanceWeek,
  autoProcessSchemes,
  firstKickoff,
  formatKickoff,
  kickoffsFor,
  lineupLockMode,
  schemeDeadlineWords,
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
  /* This league's clock, read once. Both off is the default and the ordinary case. */
  const autoSchemes = autoProcessSchemes(state);
  const autoWeek = autoAdvanceWeek(state);
  const schemeDeadline = schemeDeadlineWords(state);
  const advanceDeadline = advanceDeadlineWords(state);

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
        <li><strong>1. The roster is dealt.</strong> {autoWeek ? "Every week after the first is dealt for you at " + advanceDeadline + "; the first one waits for your commissioner." : "Your commissioner presses Deal."} Until then there is genuinely nothing for you to do, and My Team will show empty slots.</li>
        <li><strong>2. Set your lineup.</strong> My Team - swap a bench player into a matching starting slot. Every change routes through the bench; you can never swap two starters directly.</li>
        <li><strong>3. Submit a scheme.</strong> Same screen, at the bottom. Block, Steal, Redraw or No Action. You can change it as often as you like {autoSchemes ? "until " + schemeDeadline : "until it is processed"}.</li>
        <li><strong>4. Schemes are processed.</strong> {autoSchemes ? "At " + schemeDeadline + ", on the clock - like waivers. Submit nothing by then and you get No Action." : "When your commissioner presses Process Schemes."} All blocks resolve first, then steals and redraws together in random order. Your roster can change here - someone may take a starter you did not protect.</li>
        <li><strong>5. The weekend.</strong> Rosters get locked, which closes scheme submission. Lineup swaps stay open per player until that player's real game starts.</li>
        <li><strong>6. Results.</strong> {autoWeek ? "The week is scored at " + advanceDeadline + ", once every game of the NFL week is final, and the next week is dealt the same morning." : "The commissioner enters or pulls the stats and finalizes."} Standings points are awarded and the next week opens.</li>
      </RuleCard>

      {isCommissioner ? (
        <RuleCard title="Running a week, as commissioner">
          <li><strong>First time only:</strong> add your teams (Commissioner {ARROW} Teams), then send invites (Commissioner {ARROW} Invite). Optionally refresh the player pool, set your scoring rates, and set which NFL week this period plays.</li>
          <li><strong>1. Deal.</strong> Commissioner {ARROW} Weeks {ARROW} Deal Rosters. Needs at least one team.{autoWeek ? " Done for you at " + advanceDeadline + " from week two onwards." : ""}</li>
          <li><strong>2. Wait for schemes.</strong> The same panel lists who is in and who is still out. Managers can keep changing theirs until you move.</li>
          <li><strong>3. Process Schemes.</strong> Resolves every block, steal and redraw at once. {autoSchemes ? "This runs itself at " + schemeDeadline + "; press it earlier if everyone is in." : "This is the real scheme deadline - there is no clock, so tell your league when you intend to press it."}</li>
          <li><strong>4. Lock Rosters for the Weekend.</strong> Commissioner {ARROW} Enter Stats. Closes scheme submission. Lock individual players as their games kick off to stop late lineup swaps.</li>
          <li><strong>5. Stats.</strong> Type them, or press Pull Stats to fill every starter's boxes from the NFL week. Pulling never overwrites a line you typed yourself. Tick <em>Pull automatically</em> beside the button and it checks every few hours instead - the same rules, just without you pressing it.</li>
          <li><strong>6. Finalize.</strong> Scores the week, awards standings points, opens the next one. This one commits.{autoWeek ? " On the clock it happens at " + advanceDeadline + ", and only once every game of the week is final." : ""}</li>
          <li><strong>Turning the clock on or off:</strong> Commissioner {ARROW} Weeks {ARROW} Run the week on a clock. Both switches are off unless you turn them on, and your own buttons keep working either way.</li>
        </RuleCard>
      ) : null}

      <RuleCard title="What each screen does">
        <li><strong>Week</strong> - the week in progress: your team and its score, what every team blocked, stole or redrew this week, and the live scoreboard with a projected standings-points column that is read-only until the week is finalized.</li>
        <li><strong>My Team</strong> - your roster, your lineup swaps, and your scheme. The only screen where you do anything.</li>
        <li><strong>League</strong> - season standings, playoff bracket, and every week of the activity log. The Week screen shows the current week of it; this is where all of it lives.</li>
        <li><strong>Rosters</strong> - everybody's rosters and the free-agent pool.</li>
        <li><strong>Rules</strong> - the game itself: scoring rates, tiebreakers, playoffs. The numbers there are read from your league's own settings.</li>
        {isCommissioner ? <li><strong>Commish</strong> - Enter Stats and Weeks run the week; Teams, Invite, Player Pool, Scoring, Standings Cfg and Playoffs are setup, and all three settings panels also appear together on the setup screen before your first week is dealt; Manage Rosters acts on a manager's behalf; Delete League is the one escape hatch, and it takes the league away from everyone in it and cannot be undone.</li> : null}
      </RuleCard>

      {/* ISSUE #52. The one card whose entire job is "what moves without anybody
          pressing anything, and when". It renders in BOTH states on purpose: a league
          with nothing automated still has the stats pull, and "nothing else moves on
          its own" is a fact worth stating rather than leaving people to infer. */}
      <RuleCard title="What happens on its own">
        {autoSchemes ? (
          <li><strong>Schemes are processed at {schemeDeadline}, every week.</strong> Like waivers in a normal fantasy league. Whatever is on file then is what plays; no scheme on file means No Action, and there is no appeal.</li>
        ) : (
          <li><strong>Schemes close when your commissioner processes the week</strong> - not on a clock. Get yours in early.</li>
        )}
        {autoWeek ? (
          <>
            <li><strong>The week is scored and the next one dealt at {advanceDeadline}.</strong> Standings update at the same moment, and you wake up to a fresh 12-player roster.</li>
            <li><strong>It waits for the football to actually finish.</strong> If a game is postponed or still running, nothing happens and it tries again an hour later - it will not score a week that is not over.</li>
            <li><strong>The first week of a season is never dealt automatically.</strong> There is no finished week behind it, so week 1 waits until your commissioner has the teams in.</li>
            <li><strong>The playoffs are not one of these exceptions.</strong> Your commissioner picks the NFL week they start in, and the bracket seeds itself when the week before it is finalized - so only the teams who made it are dealt a roster.</li>
            <li><strong>Check your stat lines before {advanceDeadline}.</strong> Finalizing keeps the totals and the standings points but not the individual boxes behind them, so a wrong number cannot be corrected afterwards.</li>
          </>
        ) : (
          <li><strong>Nothing deals or finalizes on its own.</strong> Your commissioner drives every week from start to finish.</li>
        )}
        <li><strong>Stat lines fill themselves in</strong> if your commissioner ticked <em>Pull automatically</em> - every few hours through the weekend. A number he typed himself is never overwritten.</li>
        <li><strong>Kickoff times and the player pool refresh when a week is dealt</strong>, so lineups lock on the real schedule and you are dealt players who are actually starting.</li>
        {autoSchemes || autoWeek ? (
          <li><strong>Everything the clock does is written into the activity log</strong> on the League tab. If a roster appeared overnight, that is where it says so.</li>
        ) : null}
      </RuleCard>

      <RuleCard title="When something locks">
        {autoSchemes ? (
          <li><strong>Schemes close at {schemeDeadline}.</strong> That one IS a clock - your commissioner can process earlier if everyone is in, but never later.</li>
        ) : (
          <li><strong>Schemes close when your commissioner processes the week.</strong> There is no clock on that one - it happens when they press the button, so get yours in early.</li>
        )}
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
        <li><strong>Automatic pulls that never seem to happen</strong> need the same two things, plus the rosters locked - the schedule skips a week it is not allowed to write to rather than forcing it.</li>
        <li><strong>An automatic deal or finalize that did not happen</strong> is nearly always the clock refusing on purpose: a game of the week has not finished, this week is not mapped to an NFL week, the league has no teams, or the regular season ran out with no playoff week set. Nothing is stuck - it re-checks every hour, and your commissioner can always press the button himself.</li>
        {/* ISSUE #56. Worth saying on the screen rather than only in the docs: the
            per-slot numbers do not survive a finalize, so "check it before" is the only
            advice there is. It matters more once a week can finalize unattended. */}
        <li><strong>A wrong stat in a week that is already finalized cannot be corrected.</strong> Finalizing keeps each team&apos;s totals and standings points, but not the individual boxes behind them - so check the numbers <em>before</em> the week is finalized, and especially before {advanceDeadline} if your league finalizes on a clock.</li>
        <li><strong>A deadline that feels an hour out</strong> means the league&apos;s timezone is wrong. Commissioner {ARROW} Weeks {ARROW} Run the week on a clock.</li>
        <li><strong>A LOCKED pill</strong> on a player means the commissioner froze that slot. Ask them if it looks wrong.</li>
        <li><strong>Sign-in links</strong> arrive by email and are single-use. If one has expired, ask for another from the sign-in screen.</li>
      </RuleCard>
    </div>
  );
}

/* Prose arrow. Source is ASCII-only (CLAUDE.md, Conventions) - the engine's CP() glyphs
 * are for rendered symbols like the suits, not for a hyphen in a sentence. */
const ARROW = " -> ";
