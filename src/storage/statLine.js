/* The one place that knows how a stat line maps between the view and the table.
 *
 * Yards and touchdowns split into passing / rushing / receiving on 2026-08-28 (OQ-4c),
 * so a stat line now has six per-category columns instead of two combined ones. The
 * combined `yards` / `tds` columns are kept and never written again: they hold what was
 * entered before the split, which cannot be converted because a total does not say how
 * much of it was passing. See docs/PHASE-4-PLAN.md section 3.
 *
 * hydrate.js, decompose.js and server/operations.js all read this map rather than
 * spelling the column names out three times and drifting.
 */

import { SPLIT_STAT_FIELDS } from "../engine/index.js";

/** view field -> database column. */
export const SPLIT_COLUMN = {
  passYards: "pass_yards",
  passTds: "pass_tds",
  rushYards: "rush_yards",
  rushTds: "rush_tds",
  recYards: "rec_yards",
  recTds: "rec_tds",
};

export { SPLIT_STAT_FIELDS };

/** The feed's mirror of each column - what a provider last reported, kept even after the
 * commissioner overrides it by hand. Unused until the pull button exists. */
export const FEED_COLUMN = Object.fromEntries(
  SPLIT_STAT_FIELDS.map((f) => [f, "feed_" + SPLIT_COLUMN[f]])
);

const num = (x) => (x === "" || x == null ? null : Number(x));

/** The six split columns for a write, from a view-shaped line. All null when the line
 * carries nothing split - which is how a Coach row, or an empty one, lands. */
export function splitColumnsFor(line) {
  const out = {};
  SPLIT_STAT_FIELDS.forEach((field) => {
    out[SPLIT_COLUMN[field]] = num(line ? line[field] : null);
  });
  return out;
}

/** True when a row carries any per-category value - i.e. was written after the split. */
export function rowHasSplit(row) {
  return SPLIT_STAT_FIELDS.some((field) => row[SPLIT_COLUMN[field]] != null);
}
