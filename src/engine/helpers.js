/* Pigskin Poker - pure helpers.
 * Moved from PigskinPokerCode.jsx lines 324-400, with rng threaded into the two
 * functions that used Math.random (see src/engine/rng.js).
 */

import { defaultRng } from "./rng.js";

/** Fisher-Yates. Was line 326; rng was Math.random inline. */
export function shuffle(arr, rng = defaultRng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Was line 335. Kept byte-identical in format so legacy ids and new ids interleave. */
export function uid(prefix, rng = defaultRng) {
  return prefix + "_" + rng().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function nowStamp() {
  return new Date().toISOString();
}

export function formatClock(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

export function playerLabel(p) {
  if (!p) return "(empty)";
  return p.name + " - " + p.position + " - " + p.team;
}

export function standingsPointsArray(teamCount) {
  const arr = [];
  for (let i = 0; i < teamCount; i++) arr.push(teamCount - i);
  return arr;
}

export function defaultAdvancement(bracketSize) {
  const list = [];
  let n = bracketSize;
  while (n >= 1) {
    list.push(n);
    if (n === 1) break;
    n = Math.max(1, Math.floor(n / 2));
  }
  return list;
}

export function emptyCumulative() {
  return {
    standingsPoints: 0,
    weekWins: 0,
    coachWins: 0,
    totalTDs: 0,
    totalYards: 0,
    bestPlayer: null, // {name, position, points, period, periodLabel}
  };
}

export function periodLabel(period) {
  if (!period) return "";
  return (period.type === "playoff" ? "Playoff Round " : "Week ") + period.number;
}

export function makeEmptyLineup() {
  return {
    starters: { Coach: null, QB: null, WR: null, RB: null, TE: null, FLEX: null },
    bench: [null, null, null, null, null, null], // unordered set of 6 ids, each its own position
  };
}

/* J. GOFF, NOT JARED GOFF (Scott, 2026-10-19 - the roster-row mockups, option A4b).
 * Long names were being cut off on a phone, and Sleeper and Yahoo both answer that the
 * same way: the first initial and the whole surname. Everything after the first word is
 * the surname, so "Amon-Ra St. Brown" is "A. St. Brown" and "Marvin Harrison Jr." keeps
 * his Jr.
 *
 * A first name that is ALREADY short is left alone rather than shortened again: "A.J.
 * Brown" and "DK Metcalf" are how those players are known, and "A. Brown" or "D. Metcalf"
 * would be a different name. Display only - nothing matches or stores on this. */
export function shortPlayerName(name) {
  const text = String(name || "").trim();
  const space = text.indexOf(" ");
  if (space < 1) return text;
  const first = text.slice(0, space);
  const rest = text.slice(space + 1).trim();
  if (!rest) return text;
  if (first.indexOf(".") !== -1 || (first.length <= 3 && first === first.toUpperCase())) return text;
  return first.charAt(0) + ". " + rest;
}
