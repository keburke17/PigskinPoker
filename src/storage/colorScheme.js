/* Pigskin Poker - which colour scheme this person picked, for each poker game.
 *
 * Scott, 2026-11-16: each player chooses their own colours from a short list, from the
 * settings button beside their team name, and nobody else sees the choice. It is a
 * per-device setting, kept in this browser, for the same reason the welcome card's
 * seen-flag is (firstRun.js): the alternative is a column on the account and a migration
 * against a live season, and the worst a new phone can do is show the default colours
 * until it is picked again there.
 *
 * ONE choice PER GAME - Full Season and Weekly - shared by every league of that game on
 * this device. Separate because each game has its own default look (Pylon Orange, the
 * Classic Felt), so someone in both can still tell them apart unless they choose not to.
 * Last Digit keeps its own look and never reads this.
 *
 * It lives in src/storage/ because nothing outside this directory knows how anything is
 * persisted. The screen asks "which scheme?" / "use this one"; it does not know
 * localStorage exists. Which ids are valid is the screen's business (colorSchemes.jsx), so
 * an id this file returns may be one that has since been removed - the caller falls back.
 */

const KEYS = {
  season: "pigskin_color_scheme_v1",
  weekly: "pigskin_color_scheme_weekly_v1",
};

function keyFor(game) {
  return KEYS[game] || KEYS.season;
}

export function readColorScheme(game) {
  try {
    const raw = globalThis.localStorage?.getItem(keyFor(game));
    return typeof raw === "string" && raw ? raw : null;
  } catch {
    /* Private mode or storage disabled: the default colours, never a broken render. */
    return null;
  }
}

export function saveColorScheme(game, id) {
  try {
    if (id) globalThis.localStorage?.setItem(keyFor(game), String(id));
    else globalThis.localStorage?.removeItem(keyFor(game));
  } catch {
    /* Non-fatal. The pick still applies for this visit; it just will not be remembered. */
  }
}
