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

/* The weekly cycle, named once. CLAUDE.md writes it as
 * pre-deal -> dealt -> schemes-processed -> stats -> finalized; the three below are the
 * phases a live league actually sits in, because finalizing rolls straight to the next
 * period at pre-deal (src/engine/standings.js). */
export const PHASES = ["pre-deal", "dealt", "schemes-processed"];

/**
 * The one thing this person should do next, or the one thing they are waiting on.
 *
 * Returns { headline, detail, tab } - `tab` is the nav key to deep-link to, or null when
 * there is genuinely nothing to open, so the caller can render a button or not.
 */
export function nextStep(state, role, team) {
  return role === "commissioner"
    ? commissionerStep(state)
    : managerStep(state, team);
}

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
    return {
      headline: "Deal " + periodName(state) + ".",
      detail: "Every team gets a fresh, random 12-player roster. Invite your managers first if they are not in yet - Commissioner " + ARROWED + " Invite.",
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
      : {
          headline: "Wait for schemes, then process them.",
          detail: "Managers are setting lineups and picking schemes. Commissioner " + ARROWED + " Weeks shows who is still out. Processing resolves every block, steal and redraw at once.",
          tab: "comm",
        };
  }
  if (phase === "schemes-processed") {
    return {
      headline: "Lock the rosters, then enter stats.",
      detail: "Schemes are resolved. Locking closes scheme submission for the weekend; managers can still swap a bench player in until you lock that player individually.",
      tab: "comm",
    };
  }
  return { headline: "Finalize the week.", detail: "Finalizing scores the week, awards standings points and opens the next one.", tab: "comm" };
}

function managerStep(state, team) {
  const phase = state.currentPeriod.phase;
  const period = periodName(state);

  if (!team || !team.roster || phase === "pre-deal") {
    return {
      headline: "Nothing to do yet.",
      detail: "Your commissioner deals " + period + " when the league is ready. You will get 12 players - 6 starters and 6 bench - and then you set your lineup and pick a scheme.",
      tab: null,
    };
  }

  if (state.rosterLocked) {
    return {
      headline: "Rosters are locked.",
      detail: "Scheme submission is closed for " + period + ". You can still swap any player whose real game has not started - once the commissioner locks a player, that slot is final. Results land when the week is finalized.",
      tab: "myteam",
    };
  }

  const scheme = state.schemes[team.id];
  if (!scheme) {
    return {
      headline: "Set your lineup and submit a scheme.",
      detail: "Your roster is in. Pick your 6 starters, then choose Block, Steal, Redraw or No Action. Submit before your commissioner processes the week - there is no clock, so do it now.",
      tab: "myteam",
    };
  }

  return {
    headline: "You are in. " + schemeWord(scheme) + " is on file.",
    detail: "You can change it right up until the commissioner processes " + period + ". Keep an eye on your lineup too - bench swaps stay open until a player's game kicks off.",
    tab: "myteam",
  };
}

/* "Week 3" / "Round 2", without dragging periodLabel's import graph in here. */
function periodName(state) {
  const p = state.currentPeriod;
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
