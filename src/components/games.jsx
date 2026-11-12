/* The games on the homepage, and their pictures (Scott, 2026-11-04).
 *
 * Every game the site offers is one entry in GAMES. Grab Bag is two of them - Full
 * Season and Weekly are the same poker game, chosen at creation by `leagues.mode`
 * (their names live in homeStatus.js, gameName) - and the two "coming soon" slots are placeholders for the games Scott
 * is designing. A coming-soon entry has no `mode`, and the homepage draws it as a card
 * that is NOT a button: there is nothing behind it to open yet.
 *
 * To make a new game live: give its entry a `mode` the server's createLeague accepts,
 * and drop `comingSoon`. Until then nothing about it reaches the server.
 *
 * THE ICONS ARE SCOTT'S PICKS from the design canvas: a trophy for the season, the solid
 * football for the weekly table, a goalpost and a jersey held for the two new games. The
 * card suits came OFF the titles at the same time ("everywhere", 2026-11-04) - but only
 * the titles: the suits inside the game (scheme tickets, the card-style rosters) stay.
 *
 * Inline SVG rather than image files, so each takes its colours from where it sits, and
 * the source stays ASCII (CLAUDE.md, "CP() for every glyph").
 */

import { CP } from "../engine/constants.js";
import { gameName } from "./homeStatus.js";

/* Each icon draws in a 24x24 box at whatever `size` it is asked for. `tone` picks the
 * colours for where it sits: "gold" on a game's gold badge, "ivory" on a league's ivory
 * badge, "dim" on a coming-soon card, "title" beside a heading on the dark felt. */
const INK = {
  gold: "#1c1a08",
  ivory: "#0c2318",
  dim: "#a9bdaf",
  title: "#ffdc84",
  light: "#fbf7ee",
};

function Svg({ size, label, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" })}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function TrophyIcon({ size = 24, tone = "gold", label }) {
  return (
    <Svg size={size} label={label} fill="none" stroke={INK[tone]} strokeWidth="1.8">
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 6H5a3 3 0 0 0 3 4" />
      <path d="M16 6h3a3 3 0 0 1-3 4" />
      <path d="M12 13v4" />
      <path d="M8 20h8" />
      <path d="M10 17h4" />
    </Svg>
  );
}

/* The solid football: filled leather, white end stripes and laces, tilted. */
const BALL = {
  gold: { fill: "#5a3418", edge: "#1c1a08", lace: "#f8f3e4" },
  ivory: { fill: "#7a2e29", edge: "#4a1c18", lace: "#f8f3e4" },
  dim: { fill: "#2a4236", edge: "#a9bdaf", lace: "#a9bdaf" },
  title: { fill: "#8a5428", edge: "#ffdc84", lace: "#f8f3e4" },
  light: { fill: "#5a3418", edge: "#fbf7ee", lace: "#f8f3e4" },
};

export function FootballIcon({ size = 24, tone = "gold", label }) {
  const c = BALL[tone] || BALL.gold;
  return (
    <Svg size={size} label={label}>
      <g transform="rotate(-35 12 12)">
        <path d="M2 12C5.5 5.5 18.5 5.5 22 12C18.5 18.5 5.5 18.5 2 12z" fill={c.fill} stroke={c.edge} strokeWidth="1.2" />
        <path d="M5.6 9.4c.7 1.7.7 3.5 0 5.2M18.4 9.4c-.7 1.7-.7 3.5 0 5.2" fill="none" stroke={c.lace} strokeWidth="1.2" />
        <path d="M8.8 12h6.4M10.2 10.7v2.6M12 10.7v2.6M13.8 10.7v2.6" fill="none" stroke={c.lace} strokeWidth="1.3" />
      </g>
    </Svg>
  );
}

export function GoalpostIcon({ size = 24, tone = "dim", label }) {
  return (
    <Svg size={size} label={label} fill="none" stroke={INK[tone]} strokeWidth="1.8">
      <path d="M12 21v-9" />
      <path d="M6 12h12" />
      <path d="M6 12V3" />
      <path d="M18 12V3" />
    </Svg>
  );
}

export function JerseyIcon({ size = 24, tone = "dim", label }) {
  return (
    <Svg size={size} label={label} fill="none" stroke={INK[tone]} strokeWidth="1.8">
      <path d="M9 3l-5 2.5 1.5 4.5L8 9.5V21h8V9.5l2.5.5L20 5.5 15 3a3 3 0 0 1-6 0z" />
    </Svg>
  );
}

export function ChevronIcon({ size = 18 }) {
  return (
    <Svg size={size} fill="none" stroke="#a9bdaf" strokeWidth="2">
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

const ICONS = { trophy: TrophyIcon, football: FootballIcon, goalpost: GoalpostIcon, jersey: JerseyIcon };

/** One game's picture, by the name GAMES gives it. */
export function GameIcon({ icon, size, tone }) {
  const Icon = ICONS[icon] || FootballIcon;
  return <Icon size={size} tone={tone} />;
}

/** The football that now stands where the spade and diamond were, beside every title. */
export function TitleBall({ size = 28 }) {
  return <FootballIcon size={size} tone="title" />;
}

/**
 * The games, in the order the homepage lists them. `mode` is what createLeague is asked
 * for; an entry without one is coming soon.
 */
export const GAMES = [
  /* Each card is a name, a line of what the game is (`blurb`) and a line of who it suits
   * (`great`, drawn after a "Great for" label) - Scott, 2026-11-12. The eyebrow says how
   * long a game runs; "Full season" means this one, since there is no other to play.
   * `accent` is each game's colour ON THE HOMEPAGE ONLY - its card and the badge on each
   * of your leagues: Full Season gold, Weekly teal, Last Digit red (Scott, 2026-11-12).
   * Inside a league nothing changes yet - Scott means to rework the Full Season look
   * itself, and the colours wait for that. */
  {
    key: "season",
    mode: "season",
    icon: "trophy",
    accent: "gold",
    name: gameName("season"),
    eyebrow: "Full season",
    blurb: "A fresh 12-man roster every week. Block, steal or redraw, climb the standings, win the playoffs.",
    great: "Your regular league crew " + CP(0x00b7) + " A full season with playoffs",
  },
  {
    key: "table",
    mode: "table",
    icon: "football",
    accent: "teal",
    name: gameName("table"),
    eyebrow: "Any week",
    blurb: "A new roster every week. Sit in when you want, sit out when you don't. Win the week, win the night.",
    great: "Casual groups " + CP(0x00b7) + " 2-12 players a hand " + CP(0x00b7) + " Join any week",
  },
  /* OQ-37 (Scott, 2026-11-05). The first of the two coming-soon slots, now live. Named
   * Last Digit so nobody takes it for traditional squares. */
  {
    key: "lastdigit",
    mode: "lastdigit",
    icon: "goalpost",
    accent: "red",
    name: gameName("lastdigit"),
    eyebrow: "Full season",
    blurb: "Hold one NFL team all season. Score the last digit of its final score, every week.",
    great: "Office pools " + CP(0x00b7) + " Up to 32 players",
  },
  {
    key: "soon-2",
    comingSoon: true,
    icon: "jersey",
    name: "New Game",
    blurb: "Another one after that.",
  },
];

/** The picture a league's row shows: its game's. */
/** A game's homepage colour - "gold", "teal" or "red" - from its GAMES entry. */
export function accentForGame(game) {
  const entry = GAMES.find((g) => g.mode === (game === "table" || game === "lastdigit" ? game : "season"));
  return (entry && entry.accent) || "gold";
}

/** The icon ink that reads on an accent's badge: light on red, dark on gold and teal. */
export function badgeTone(accent) {
  return accent === "red" ? "light" : "gold";
}

export function iconForGame(game) {
  return game === "table" ? "football" : game === "lastdigit" ? "goalpost" : "trophy";
}
