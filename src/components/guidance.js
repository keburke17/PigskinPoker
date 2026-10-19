/* Pigskin Poker - "what should I do right now?", as pure functions.
 *
 * Issues #24, #25 and #26 are one complaint wearing three hats: the app never states
 * the next step. A commissioner lands on an empty league, a manager lands on somebody
 * else's zeroes, and neither screen says who moves next.
 *
 * This module answers that in one place so the overlay (WelcomeOverlay), the persistent
 * nudge under it and the Help tab cannot drift apart. It is pure - state in, copy out -
 * which is what makes tests/guidance.test.js able to pin every phase without a DOM.
 *
 * NOT src/engine/. Nothing here decides anything; it reads a phase the engine already
 * set and picks a sentence. Putting it in the engine would put copy in the one directory
 * that is meant to be nothing but rules.
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
  SEAT,
  TABLE_MIN_PLAYERS,
  isTable,
  periodTeamIds,
  seatOf,
} from "../engine/index.js";

/* The weekly cycle, named once. CLAUDE.md writes it as
 * pre-deal -> dealt -> schemes-processed -> stats -> finalized; the three below are the
 * phases a live league actually sits in, because finalizing rolls straight to the next
 * period at pre-deal (src/engine/standings.js). */
export const PHASES = ["pre-deal", "dealt", "schemes-processed"];


/* "at the week's first kickoff", and the time itself when the schedule has been read -
 * a deadline nobody can name is only half a deadline. */
function weeklyDeadline(state) {
  const at = firstKickoff(kickoffsFor(state));
  return at ? "the week's first kickoff (" + formatKickoff(at) + ")" : "the week's first kickoff";
}

const isWeekly = (state) => lineupLockMode(state) === LINEUP_LOCK.WEEKLY;

/* ---------------------------------------------------------------------------
 * THE CLOCK (issue #52, OQ-14). A league can have the scheme deadline and the
 * Tuesday-morning finalize-and-deal run on their own. Both are off by default, so every
 * sentence below has to branch: telling a manager "there is no clock, so do it now"
 * when 3am Thursday will take his scheme off him is the exact failure that made
 * automating this worth documenting in the first place.
 * ------------------------------------------------------------------------- */

/**
 * Will the clock deal the week in front of this league?
 *
 * NOT SIMPLY `autoAdvanceWeek`. The clock never deals the FIRST week of a season -
 * there is no finished week behind it to follow, so `dealEligibility` refuses (see
 * server/autoCycle.js). Week 1 waits for the commissioner, and saying otherwise on his
 * own screen would leave him waiting for a Tuesday that never comes.
 */
function clockWillDeal(state) {
  return autoAdvanceWeek(state) && (state.weeklyResults || []).length > 0;
}

/**
 * The one thing this person should do next, or the one thing they are waiting on.
 *
 * Returns { headline, detail, tab } - `tab` is the nav key to deep-link to, or null when
 * there is genuinely nothing to open, so the caller can render a button or not.
 */
export function nextStep(state, role, team) {
  /* A table (issue #75) gets its own wording: a dealer, players, seats and hands. A
   * season's sentences below are untouched by it. */
  if (isTable(state)) return role === "commissioner" ? dealerStep(state) : playerStep(state, team);
  return role === "commissioner"
    ? commissionerStep(state)
    : managerStep(state, team);
}

/* ------------------------------ table mode ------------------------------ */

function dealerStep(state) {
  const phase = state.currentPeriod.phase;
  const hand = periodName(state);
  if (phase === "pre-deal") {
    const seated = periodTeamIds(state).length;
    if (seated < TABLE_MIN_PLAYERS) {
      return {
        headline: "Get a second player to the table.",
        detail: "A hand needs at least " + TABLE_MIN_PLAYERS + " players seated. Dealer " + ARROWED + " Invite makes one code for the whole table - everyone who redeems it takes a seat with a team of their own.",
        tab: "comm",
      };
    }
    return clockWillDeal(state)
      ? {
          headline: hand + " is dealt for you at " + advanceDeadlineWords(state) + ".",
          detail: "Nothing to press - the clock deals it to whoever is seated then. You can still deal it now yourself if you would rather not wait.",
          tab: "comm",
        }
      : {
          headline: "Deal " + hand + ".",
          detail: seated + " players are seated, and each gets a fresh, random 12-player hand. Anyone sitting out is not dealt in, and anyone who sits down after the deal waits for the next hand.",
          tab: "comm",
        };
  }
  if (phase === "dealt") {
    if (state.rosterLocked) {
      return {
        headline: "Enter the stats, then finalize.",
        detail: "Rosters are locked, so scheme submission is closed. Pull Stats fills every starter's boxes from the NFL week; anything you typed yourself is never overwritten.",
        tab: "comm",
      };
    }
    return autoProcessSchemes(state)
      ? {
          headline: "Schemes process themselves at " + schemeDeadlineWords(state) + ".",
          detail: "Players are setting lineups and picking schemes; Dealer " + ARROWED + " Hands shows who is still out. Anyone who has not submitted by then gets No Action. You can still process early if everyone is in.",
          tab: "comm",
        }
      : {
          headline: "Wait for schemes, then process them.",
          detail: "Players are setting lineups and picking schemes. Dealer " + ARROWED + " Hands shows who is still out. Processing resolves every block, steal and redraw at once.",
          tab: "comm",
        };
  }
  if (phase === "schemes-processed") {
    if (autoAdvanceWeek(state)) {
      return {
        headline: "The hand finalizes itself on " + advanceDeadlineWords(state) + ".",
        detail: "Once every game of the NFL week is final, the clock scores the hand, records who won and deals the next one to whoever is seated. Check the stats before then - after a finalize there is no undo.",
        tab: "comm",
      };
    }
    return {
      headline: "Lock the rosters, then enter stats.",
      detail: isWeekly(state)
        ? "Schemes are resolved. Locking closes scheme submission for the weekend; lineups close on their own at " + weeklyDeadline(state) + ", so nothing is left for you to press there."
        : "Schemes are resolved. Locking closes scheme submission for the weekend; players can still swap a bench player in until that player's own game kicks off. You can freeze one earlier by hand.",
      tab: "comm",
    };
  }
  return {
    headline: "Finalize the hand.",
    detail: "Finalizing scores the hand, records who won it, and opens the next one. Anyone who sat down or got up during the hand is dealt in or out from then.",
    tab: "comm",
  };
}

function playerStep(state, team) {
  const phase = state.currentPeriod.phase;
  const hand = periodName(state);
  const seat = team ? seatOf(state, team.id) : SEAT.SEATED;
  const inHand = !!team && periodTeamIds(state).includes(team.id);

  if (seat === SEAT.LEFT && !inHand) {
    return {
      headline: "You have left the table.",
      detail: "Your team and your record are kept. Rejoin from My Team whenever a seat is free.",
      tab: "myteam",
    };
  }
  if (phase === "pre-deal") {
    return seat === SEAT.SITTING_OUT
      ? {
          headline: "You are sitting out " + hand + ".",
          detail: "Your seat is held for you. Come back from My Team before the deal and you are dealt in.",
          tab: "myteam",
        }
      : {
          headline: "Nothing to do yet.",
          detail:
            (clockWillDeal(state)
              ? hand + " is dealt automatically on " + advanceDeadlineWords(state) + "."
              : "The dealer deals " + hand + " when the table is ready.") +
            " You will get 12 players - 6 starters and 6 bench - and then you set your lineup and pick a scheme.",
          tab: null,
        };
  }
  if (!inHand) {
    return {
      headline: "You are not in " + hand + ".",
      detail: seat === SEAT.SEATED
        ? "It was dealt before you took your seat. You are in the next hand."
        : "You were sitting out when it was dealt. Come back from My Team to be dealt into the next one.",
      tab: "myteam",
    };
  }
  /* In the hand: the same steps a season's manager has, with the dealer in place of the
   * commissioner. */
  const step = managerStep(state, team);
  return {
    ...step,
    detail: step.detail.replace(/the commissioner/g, "the dealer").replace(/your commissioner/g, "the dealer").replace(/the week is finalized/g, "the hand is finalized"),
  };
}

/* ------------------------------- a season ------------------------------- */

function commissionerStep(state) {
  const phase = state.currentPeriod.phase;
  const teams = state.teams.length;

  /* Setup outranks the cycle. A league with no teams cannot be dealt, and the Weeks
   * panel's disabled Deal button was the whole of issue #24's complaint. */
  if (teams === 0) {
    return {
      headline: "Add your teams.",
      detail: "A league needs teams before it can deal. Commissioner " + ARROWED + " Teams, one row per manager. You can rename them later.",
      tab: "comm",
    };
  }
  if (phase === "pre-deal") {
    return clockWillDeal(state)
      ? {
          headline: periodName(state) + " is dealt for you at " + advanceDeadlineWords(state) + ".",
          detail: "Nothing to press - the clock deals it, refreshing the player pool first. You can still deal it now yourself if you would rather not wait.",
          tab: "comm",
        }
      : {
          headline: "Deal " + periodName(state) + ".",
          detail:
            "Every team gets a fresh, random 12-player roster. Invite your managers first if they are not in yet - Commissioner " + ARROWED + " Invite." +
            (autoAdvanceWeek(state) ? " The clock takes over from next week - it never deals the first one." : ""),
          tab: "comm",
        };
  }
  if (phase === "dealt") {
    return state.rosterLocked
      ? {
          headline: "Enter the stats, then finalize.",
          detail: "Rosters are locked, so scheme submission is closed. Pull Stats fills every starter's boxes from the NFL week; anything you typed yourself is never overwritten.",
          tab: "comm",
        }
      : autoProcessSchemes(state)
        ? {
            headline: "Schemes process themselves at " + schemeDeadlineWords(state) + ".",
            detail: "Managers are setting lineups and picking schemes; Commissioner " + ARROWED + " Weeks shows who is still out. Anyone who has not submitted by then gets No Action for the week. You can still process early if everyone is in.",
            tab: "comm",
          }
        : {
            headline: "Wait for schemes, then process them.",
            detail: "Managers are setting lineups and picking schemes. Commissioner " + ARROWED + " Weeks shows who is still out. Processing resolves every block, steal and redraw at once.",
            tab: "comm",
          };
  }
  if (phase === "schemes-processed") {
    if (autoAdvanceWeek(state)) {
      return {
        headline: "The week finalizes itself on " + advanceDeadlineWords(state) + ".",
        detail: "Once every game of the NFL week is final, the clock scores the week, awards standings points and deals the next one. Check the stats before then if you want to correct anything - after a finalize there is no undo.",
        tab: "comm",
      };
    }
    return {
      headline: "Lock the rosters, then enter stats.",
      detail: isWeekly(state)
        ? "Schemes are resolved. Locking closes scheme submission for the weekend; lineups close on their own at " + weeklyDeadline(state) + ", so nothing is left for you to press there."
        : "Schemes are resolved. Locking closes scheme submission for the weekend; managers can still swap a bench player in until that player's own game kicks off. You can freeze one earlier by hand.",
      tab: "comm",
    };
  }
  return autoAdvanceWeek(state)
    ? {
        headline: "The week finalizes itself on " + advanceDeadlineWords(state) + ".",
        detail: "The clock waits until every game of the NFL week is final, then scores the week and deals the next one. Finalize it yourself sooner if the numbers are already right.",
        tab: "comm",
      }
    : { headline: "Finalize the week.", detail: "Finalizing scores the week, awards standings points and opens the next one.", tab: "comm" };
}

function managerStep(state, team) {
  const phase = state.currentPeriod.phase;
  const period = periodName(state);

  if (!team || !team.roster || phase === "pre-deal") {
    return {
      headline: "Nothing to do yet.",
      detail:
        (clockWillDeal(state)
          ? period + " is dealt automatically on " + advanceDeadlineWords(state) + "."
          : "Your commissioner deals " + period + " when the league is ready.") +
        " You will get 12 players - 6 starters and 6 bench - and then you set your lineup and pick a scheme.",
      tab: null,
    };
  }

  if (state.rosterLocked) {
    return {
      headline: "Rosters are locked.",
      detail: isWeekly(state)
        ? "Scheme submission is closed for " + period + ". Your lineup closes at " + weeklyDeadline(state) + " - after that it is final, whatever the injury news says. Results land when the week is finalized."
        : "Scheme submission is closed for " + period + ". You can still swap any player whose real game has not started - once his game kicks off, or the commissioner locks him, that slot is final. Results land when the week is finalized.",
      tab: "myteam",
    };
  }

  const scheme = state.schemes[team.id];
  if (!scheme) {
    return {
      headline: "Set your lineup and submit a scheme.",
      detail:
        "Your roster is in. Pick your 6 starters, then choose Block, Steal, Redraw or No Action. " +
        (autoProcessSchemes(state)
          ? "Schemes close at " + schemeDeadlineWords(state) + ", on the clock. Miss it and you get No Action for the week."
          : "Submit before your commissioner processes the week - there is no clock, so do it now."),
      tab: "myteam",
    };
  }

  return {
    headline: "You are in. " + schemeWord(scheme) + " is on file.",
    detail:
      (autoProcessSchemes(state)
        ? "You can change it right up until " + schemeDeadlineWords(state) + "."
        : "You can change it right up until the commissioner processes " + period + ".") +
      (isWeekly(state)
        ? " Keep an eye on your lineup too - every lineup closes at " + weeklyDeadline(state) + "."
        : " Keep an eye on your lineup too - bench swaps stay open until each player's own game kicks off."),
    tab: "myteam",
  };
}

/* "Week 3" / "Round 2", without dragging periodLabel's import graph in here. */
function periodName(state) {
  const p = state.currentPeriod;
  if (isTable(state) && p.type === "week") return "Hand " + p.number;
  return (p.type === "playoff" ? "Round " : "Week ") + p.number;
}

function schemeWord(scheme) {
  if (scheme.type === "block") return "Block";
  if (scheme.type === "steal") return "Steal";
  if (scheme.type === "redraw") return "Redraw";
  return "No Action";
}

/* ASCII-only source (CLAUDE.md, Conventions). The engine's CP() glyphs are for rendered
 * symbols; this is a plain arrow inside prose and stays a hyphen-caret. */
const ARROWED = "->";
