/* Pigskin Poker - which colour scheme this person picked for the Full Season game.
 *
 * Scott, 2026-11-16: each player chooses their own colours from a short list, on the My
 * Team tab, and nobody else sees the choice. It is a per-device setting, kept in this
 * browser, for the same reason the welcome card's seen-flag is (firstRun.js): the
 * alternative is a column on the account and a migration against a live season, and the
 * worst a new phone can do is show the default colours until it is picked again there.
 *
 * ONE choice for every Full Season league on this device, not one per league - it is the
 * person's colours, not the league's. The Weekly table and Last Digit keep their own looks
 * and never read it.
 *
 * It lives in src/storage/ because nothing outside this directory knows how anything is
 * persisted. The screen asks "which scheme?" / "use this one"; it does not know
 * localStorage exists. Which ids are valid is the screen's business (colorSchemes.js), so
 * an id this file returns may be one that has since been removed - the caller falls back.
 */

const KEY = "pigskin_color_scheme_v1";

export function readColorScheme() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return typeof raw === "string" && raw ? raw : null;
  } catch {
    /* Private mode or storage disabled: the default colours, never a broken render. */
    return null;
  }
}

export function saveColorScheme(id) {
  try {
    if (id) globalThis.localStorage?.setItem(KEY, String(id));
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* Non-fatal. The pick still applies for this visit; it just will not be remembered. */
  }
}
