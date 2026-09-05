/* Pigskin Poker - constants and glyphs.
 * Moved verbatim from PigskinPokerCode.jsx lines 299-322.
 */

export const POSITIONS = ["Coach", "QB", "WR", "RB", "TE"];
export const SCHEME_POSITIONS = ["QB", "WR", "RB", "TE"]; // Coach never selectable
export const FA_TABS = ["QB", "WR", "RB", "TE", "Coach", "BYE", "IR", "OUT"];

/* DO NOT CHANGE THIS PATTERN.
 * Glyphs are built with String.fromCodePoint rather than raw literal bytes so every
 * source file stays plain ASCII end-to-end. The author's note: `\u` escapes in JSX text
 * render literally instead of being interpreted, which caused real bugs during
 * development. Do not "simplify" this to raw unicode characters or \u escapes.
 */
export function CP() {
  return String.fromCodePoint.apply(null, arguments);
}

export const SUIT_CH = {
  spade: CP(0x2660),
  heart: CP(0x2665),
  diamond: CP(0x2666),
  club: CP(0x2663),
  star: CP(0x2605),
  sparkle: CP(0x2724),
};

export const ICON = {
  trophy: CP(0x1f3c6),
  crown: CP(0x1f451),
  warn: CP(0x26a0, 0xfe0f),
  football: CP(0x1f3c8),
  redraw: CP(0x1f501),
  shield: CP(0x1f6e1, 0xfe0f),
  flag: CP(0x1f3c1),
  forward: CP(0x27a1, 0xfe0f),
  /* Disclosure triangles for the collapsible roster cards. Built the same way as every
   * other glyph here, for the same reason - see the note above CP(). */
  caretRight: CP(0x25b8),
  caretDown: CP(0x25be),
};

export const SUIT_GLYPH = {
  Coach: SUIT_CH.spade,
  QB: SUIT_CH.heart,
  WR: SUIT_CH.diamond,
  RB: SUIT_CH.club,
  TE: SUIT_CH.star,
  FLEX: SUIT_CH.sparkle,
};

export const ARROW = CP(0x2192);

/* Scoring defaults.
 *
 * The split keys are the live rule as of 2026-08-28 (OQ-4c): yards and touchdowns
 * count separately as passing, rushing and receiving, each at its own commissioner-
 * editable rate. Under one shared rate a quarterback's passing yardage dominated every
 * other slot, which is what the designer asked to fix.
 *
 * `yardsPerPoint` and `pointsPerTD` are the ARTIFACT'S rule and are deliberately kept.
 * They score stat lines recorded before the split - which cannot be converted, because a
 * combined yards figure does not say how much of it was passing - and they are what
 * tests/parity.test.js replays. Nothing written from now on reaches them.
 * See docs/PHASE-4-PLAN.md section 3.
 */
export const DEFAULT_SCORING = {
  passYardsPerPoint: 25, // 1 point per N passing yards
  rushYardsPerPoint: 10,
  recYardsPerPoint: 10,
  pointsPerPassTD: 4,
  pointsPerRushTD: 6,
  pointsPerRecTD: 6,
  yardsPerPoint: 10, // legacy: 1 point per N yards, all positions
  pointsPerTD: 5, // legacy
  coachWin: 2,
  coachTie: 1,
  coachLoss: 0,
};

/* The six per-category stat fields a stat line carries, and the config key each one
 * converts through. Order is display order. */
export const STAT_CATEGORIES = [
  { field: "passYards", rate: "passYardsPerPoint", label: "Pass Yds", kind: "yards" },
  { field: "passTds", rate: "pointsPerPassTD", label: "Pass TD", kind: "tds" },
  { field: "rushYards", rate: "rushYardsPerPoint", label: "Rush Yds", kind: "yards" },
  { field: "rushTds", rate: "pointsPerRushTD", label: "Rush TD", kind: "tds" },
  { field: "recYards", rate: "recYardsPerPoint", label: "Rec Yds", kind: "yards" },
  { field: "recTds", rate: "pointsPerRecTD", label: "Rec TD", kind: "tds" },
];

export const SPLIT_STAT_FIELDS = STAT_CATEGORIES.map((c) => c.field);

/* Which categories each position enters first. The rest stay available behind a toggle,
 * because a running quarterback and a receiving back are both ordinary. */
export const PRIMARY_CATEGORIES = {
  QB: ["passYards", "passTds"],
  RB: ["rushYards", "rushTds"],
  WR: ["recYards", "recTds"],
  TE: ["recYards", "recTds"],
};

/** Starter slots, in the order the app displays and scores them. */
export const STARTER_SLOTS = ["Coach", "QB", "WR", "RB", "TE", "FLEX"];
