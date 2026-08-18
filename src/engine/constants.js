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

export const DEFAULT_SCORING = {
  yardsPerPoint: 10, // 1 point per N yards
  pointsPerTD: 5,
  coachWin: 2,
  coachTie: 1,
  coachLoss: 0,
};

/** Starter slots, in the order the app displays and scores them. */
export const STARTER_SLOTS = ["Coach", "QB", "WR", "RB", "TE", "FLEX"];
