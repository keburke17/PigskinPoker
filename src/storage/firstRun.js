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
