/* The tab you live on all week.
 *
 * Issue #30: "Weekly Results" was the right screen and it only existed AFTER the
 * commissioner finalized. Through pre-deal, dealt and schemes-processed - the entire time
 * the week is actually being played - it said "No weeks finalized yet", so the tab that
 * answers "how is the league doing" was empty for six days out of seven.
 *
 * So it now carries the week in progress at the top and the finished weeks underneath,
 * which is one tab that answers the question all week and keeps every past week in the
 * same place it has always been. The finalized half below is unchanged.
 *
 * IT IS CALLED "WEEK" IN THE NAV, not "Scoreboard" (Scott, 2026-09-08, OQ-20). The name
 * stopped being true once the week's action moved onto it: a scoreboard is now roughly a
 * third of what the screen holds, alongside your own card and what every other team did.
 * Only the LABEL changed - the route key is still `results`, so no saved link breaks.
 */

import { WeeklyResultsTab } from "./WeeklyResultsTab.jsx";
import { WeekScoreboard } from "./scoreboard.jsx";

export function ScoreboardTab({ state, myTeam, onSeeAllActivity }) {
  const finished = state.weeklyResults.length > 0;
  return (
    <div>
      <WeekScoreboard state={state} myTeam={myTeam} onSeeAllActivity={onSeeAllActivity} />
      {finished ? (
        <>
          <div className="pp-eyebrow" style={{ margin: "18px 0 8px" }}>Finished Weeks</div>
          <WeeklyResultsTab state={state} />
        </>
      ) : null}
    </div>
  );
}
