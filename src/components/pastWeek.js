/* A finished week, in the shape the roster screens already read.
 *
 * WHY THIS EXISTS. Scott, 2026-10-27: when a new week is dealt, go back on the Rosters
 * tab and see who you had and what they scored. Every week's rosters and stat lines are
 * kept (hydrate.js hands the finished ones over as `_meta.pastPeriods`), so this does
 * not work anything out - it takes the live view and swaps in that week's rosters, stat
 * lines, NFL week and kickoffs. The Roster Grid and Full Rosters then draw it with
 * exactly the code they draw this week with, so a finished week cannot be scored any
 * differently on this screen than it was when it was played.
 *
 * READ-ONLY, and marked so: `_meta.pastWeek` is true, and nothing that writes is shown
 * from a past week. Nothing here is saved anywhere.
 */

const samePeriod = (a, b) => !!a && !!b && a.type === b.type && a.number === b.number;

/** The finished periods the week picker can go back to, oldest first. */
export function pastRosterPeriods(state) {
  const past = (state && state._meta && state._meta.pastPeriods) || [];
  return past
    .filter((p) => !samePeriod(p, state.currentPeriod))
    .slice()
    .sort((a, b) => (a.type === b.type ? a.number - b.number : a.type === "playoff" ? 1 : -1));
}

/**
 * The league view as it stood at the end of one finished period, or null when that
 * period is not one the league kept.
 */
export function pastWeekState(state, period) {
  const past = pastRosterPeriods(state).find((p) => samePeriod(p, period));
  if (!past) return null;
  return {
    ...state,
    currentPeriod: { type: past.type, number: past.number, phase: "finalized" },
    /* A team that was not dealt in that week - added since, or out of the bracket - has
     * no roster, which is what the screens already draw for "not dealt". */
    teams: state.teams.map((t) => ({ ...t, roster: past.rosters[t.id] || null })),
    statsEntry: past.statsEntry || {},
    schemes: {},
    lockedPlayerIds: {},
    rosterLocked: true,
    _meta: {
      ...state._meta,
      nflWeek: past.nflWeek,
      kickoffs: past.kickoffs || {},
      pastWeek: true,
    },
  };
}

/** Is this the view of a finished week, rather than the one being played? */
export function isPastWeek(state) {
  return !!(state && state._meta && state._meta.pastWeek);
}
