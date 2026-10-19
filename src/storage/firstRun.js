/* Pigskin Poker - "has this person been welcomed to this league yet?"
 *
 * Issue #26 asked where the seen-flag should live and recommended localStorage keyed by
 * account plus league, on the grounds that a column on `league_members` is a migration,
 * and a migration means running db:push against a season people are playing. That is the
 * call taken here. The honest cost: the welcome re-shows on a new device, which for a
 * one-screen orientation card is arguably right rather than a bug.
 *
 * It lives in src/storage/ because that is the rule - nothing outside this directory
 * knows how anything is persisted (src/storage/types.js). The overlay asks
 * "seen?" / "mark seen"; it does not know localStorage exists.
 */

const KEY = "pigskin_welcomed_v1";

/* Keyed by BOTH, and in this order, because one person can be a manager in one league
 * and the commissioner of another - being welcomed to one says nothing about the other.
 * A missing accountId still gets a stable key rather than colliding on undefined. */
function slot(accountId, leagueId) {
  return String(accountId || "anon") + ":" + String(leagueId || "-");
}

function readAll() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    /* Private mode, storage disabled, or corrupt. Treat as "never welcomed" - showing
     * the card again is harmless; throwing on a render is not. */
    return {};
  }
}

export function hasBeenWelcomed(accountId, leagueId) {
  return !!readAll()[slot(accountId, leagueId)];
}

export function markWelcomed(accountId, leagueId) {
  try {
    const all = readAll();
    all[slot(accountId, leagueId)] = true;
    globalThis.localStorage?.setItem(KEY, JSON.stringify(all));
  } catch {
    /* Non-fatal by design. The worst case is the card appearing once more next visit,
     * which is a great deal better than a dismiss button that can throw. */
  }
}

/* ---------------------------------------------------------------------------
 * OQ-31: which weekly recap this person has already seen in this league.
 *
 * The recap pops up once per week - the first time a manager opens the app after the
 * finalize - and then lives on My Team. Remembered here, per device, for the same reason
 * the welcome card is: the alternative is a column on league_members and a migration, and
 * the worst a new phone can do is show last week's recap one extra time.
 *
 * `week` is a string naming the recap (season id and week number), so a new season's
 * Week 1 is not mistaken for last season's.
 * ------------------------------------------------------------------------- */
const RECAP_KEY = "pigskin_recap_seen_v1";

function readRecaps() {
  try {
    const raw = globalThis.localStorage?.getItem(RECAP_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function hasSeenRecap(accountId, leagueId, week) {
  return readRecaps()[slot(accountId, leagueId)] === week;
}

export function markRecapSeen(accountId, leagueId, week) {
  try {
    const all = readRecaps();
    all[slot(accountId, leagueId)] = week;
    globalThis.localStorage?.setItem(RECAP_KEY, JSON.stringify(all));
  } catch {
    /* Non-fatal: at worst the recap pops up once more. */
  }
}
