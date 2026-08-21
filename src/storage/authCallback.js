/* What a magic link brings back when it DOES NOT work.
 *
 * A sign-in link that succeeds returns tokens in the URL fragment and the Supabase
 * client picks them up. A link that fails returns an ERROR in that same fragment:
 *
 *   #error=access_denied&error_code=otp_expired&error_description=Email+link+is+...
 *
 * The client has nothing to do with that, so it drops it. Without this module the app
 * dropped it too, and the result was the worst bug this project has had: you tap the
 * link in your email, land back on the sign-in screen, and are asked for your email
 * again. Nothing is broken as far as the screen is concerned. Nothing is said. So you
 * ask for another link - which INVALIDATES the one you were about to try - and you are
 * in a loop with no way to find out why.
 *
 * Reading the fragment costs nothing and turns that into one sentence.
 *
 * A link fails for boring reasons, all of them recoverable and none of them obvious:
 *
 *   - it was already used. They work once.
 *   - a NEWER link was requested. Asking again supersedes the one still in the inbox,
 *     which is a trap, because a stalled link is exactly when people ask again.
 *   - it aged out (an hour, by default).
 *   - a mail scanner opened it first - some corporate and webmail filters follow links
 *     to check them, which spends the token before the human ever clicks.
 *
 * Pure, and parsing strings: no DOM, no client, so it is testable directly.
 */

/** Supabase puts these in the fragment; some flows use the query string instead, so
 *  both are read. Returns the raw pair, or null when the link was fine. */
export function parseAuthCallbackError(url) {
  const s = String(url || "");
  const out = {};
  for (const part of [s.split("#")[1] || "", s.split("#")[0].split("?")[1] || ""]) {
    if (!part) continue;
    const p = new URLSearchParams(part);
    for (const k of ["error", "error_code", "error_description"]) {
      if (!out[k] && p.get(k)) out[k] = p.get(k);
    }
  }
  if (!out.error && !out.error_code) return null;
  return {
    code: out.error_code || out.error,
    description: out.error_description || "",
  };
}

/**
 * The sentence someone actually reads. It has to say what to DO, because every one of
 * these is fixed by requesting a fresh link - the failure people cannot diagnose is the
 * one where the app stays silent and they assume the link is simply broken.
 */
export function authCallbackErrorMessage(err) {
  if (!err) return null;
  const code = String(err.code || "");
  if (code === "otp_expired" || code === "access_denied") {
    return {
      headline: "That sign-in link has expired or was already used.",
      detail:
        "Links work once, and asking for a new one cancels the last. Send yourself a fresh link below and open the NEWEST email.",
    };
  }
  if (code === "server_error" || code === "unexpected_failure") {
    return {
      headline: "Sign-in could not be completed.",
      detail: err.description || "Something went wrong on the way back. Try sending a new link.",
    };
  }
  return {
    headline: "That sign-in link did not work.",
    detail: err.description || code,
  };
}

/* ---------------------------------------------------------------------------
 * The one reading, taken once.
 *
 * WHY AT IMPORT TIME rather than when the store is built. Capturing it in
 * createSupabaseStore meant capturing it during a React render, and the reading has a
 * side effect - it takes the fragment out of the address bar. StrictMode renders twice
 * in development, so the first store read the error and cleaned the URL and the second
 * store, built moments later from the cleaned URL, found nothing. The banner then
 * appeared for nobody, in development only.
 *
 * Whether this page load arrived from a broken link is a fact about the page load. It
 * is settled before React starts and does not change afterwards, so it is read here,
 * once, and everything else asks.
 * ------------------------------------------------------------------------ */

function capture() {
  const loc = globalThis.location;
  if (!loc) return null; // Node, tests, SSR: there is no URL to have arrived from.
  const err = authCallbackErrorMessage(parseAuthCallbackError(loc.href || ""));
  /* Out of the address bar. Reloading is the first thing anyone does when a screen
     looks stuck, and without this they would get the same complaint back forever with
     no link left to blame for it. Only on failure - on success the fragment carries
     the tokens and belongs to the Supabase client. */
  if (err && globalThis.history?.replaceState) {
    globalThis.history.replaceState({}, "", (loc.pathname || "/") + (loc.search || ""));
  }
  return err;
}

const PAGE_LOAD_ERROR = capture();

/** Why the magic link that brought us here failed, or null if it did not. */
export function authLinkErrorForThisPageLoad() {
  return PAGE_LOAD_ERROR;
}
