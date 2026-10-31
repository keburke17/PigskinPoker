/* Pigskin Poker - a refused write, as the sentence to put on screen.
 *
 * Pure: a store result in, a banner (or null) out. It lives here rather than inside
 * useLeague.js so tests/opError.test.js can pin every refusal the app can produce
 * without a DOM, and there is no second copy of this wording anywhere.
 *
 * WHY IT EXISTS AT ALL. `handle()` used to shape these inline, in a chain of else-ifs
 * that ended at `network` with NO final else - so any reason not on that list fell off
 * the end and the refusal vanished. The screen kept whatever it had drawn, the server's
 * own view quietly replaced it on the next read, and nobody was told anything. Three
 * reasons the client mints were in that gap: `forbidden`, `unauthorized` and
 * `throttled`, plus `unlocked` from the server (setStatLine with the rosters open).
 *
 * A manager renaming his own team is how it was found (2026-09-09): the write was a
 * 403, and he watched the old name come back with no message at all. The other half of
 * that fix is renameTeam in server/operations.js.
 *
 * SO THE SHAPE OF THIS FUNCTION IS THE POINT: every failure ends in a banner, including
 * a reason nobody has invented yet. Say something imperfect rather than nothing.
 */

/** The two sentences an ErrorBanner takes, or null when the result is not a failure. */
export function failureBanner(result) {
  if (!result || result.ok !== false) return null;

  /* The server's own sentence wherever there is one. It knows what it refused and why -
   * "You can only change your own team", "Lock the rosters before entering stats" - and
   * anything written here would be a vaguer version of it. */
  const said = typeof result.message === "string" && result.message.trim() ? result.message.trim() : null;

  if (result.reason === "network") {
    /* The one case where the server's message is NOT the headline: it is a fetch
     * failure or a 500, so it reads like plumbing. The queue is still retrying. */
    return { headline: "Couldn't save that change.", detail: said };
  }
  if (result.reason === "unauthorized") {
    return {
      headline: said || "You're not signed in any more.",
      detail: "Your session may have ended. Log out and back in if this keeps happening.",
    };
  }
  if (result.reason === "throttled") {
    return {
      headline: said || "That was too many requests in a row.",
      detail: result.retryAfter ? "Try again in " + result.retryAfter + " seconds." : null,
    };
  }
  return { headline: said || "Couldn't save that change.", detail: null };
}
