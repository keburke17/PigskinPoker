/* Routing, hand-written.
 *
 * WHY NO DEPENDENCY. CLAUDE.md is explicit that dependencies stay boring, because this
 * is handed to a hobbyist and every one of them is something he has to maintain.
 * react-router would be the obvious reach, and its last three major versions were each
 * effectively a rewrite - that is precisely the maintenance this project is avoiding.
 * What is actually needed here is small enough to read in one sitting:
 *
 *   /                        the landing page - sign in, redeem a code, create a league
 *   /join/<code>             a shared invite link, code prefilled
 *   /l/<leagueId>            a league, default tab
 *   /l/<leagueId>/<tab>      a league, on a named tab
 *
 * That is four shapes and no nesting. A router that also does data loading, lazy routes
 * and nested layouts would be solving problems this app does not have.
 *
 * The History API is doing the work. `popstate` covers the back button, which is the
 * thing people actually miss when navigation is component state.
 */

/* These are the tab KEYS from App's NAV, not their labels - `hub` is the one that
 * catches you out, because it is labelled "Rosters". They must match exactly: a key
 * missing from this list is written into the URL happily and then silently parsed back
 * as "home", so the address bar and the screen disagree and a shared deep link takes
 * someone to the wrong tab. */
export const TABS = ["home", "myteam", "hub", "results", "rules", "comm"];

/** Parse a path into a route. Unknown shapes fall back to the landing page rather than
 *  erroring - a bad URL should show something, not a blank screen. */
export function parsePath(pathname) {
  const parts = String(pathname || "/").split("/").filter(Boolean);

  if (parts[0] === "join") {
    // The code may legitimately be absent - /join is still the redeem screen, just with
    // an empty box.
    return { name: "join", code: parts[1] ? decodeURIComponent(parts[1]) : "" };
  }

  if (parts[0] === "l" && parts[1]) {
    const tab = parts[2] && TABS.includes(parts[2]) ? parts[2] : "home";
    return { name: "league", leagueId: parts[1], tab };
  }

  return { name: "landing" };
}

/** The inverse. Kept next to parsePath so the two cannot drift apart. */
export function buildPath(route) {
  if (!route) return "/";
  if (route.name === "join") return route.code ? "/join/" + encodeURIComponent(route.code) : "/join";
  if (route.name === "league") {
    const tab = route.tab && route.tab !== "home" ? "/" + route.tab : "";
    return "/l/" + route.leagueId + tab;
  }
  return "/";
}

export const currentRoute = () => parsePath(globalThis.location?.pathname ?? "/");

/**
 * Navigate.
 *
 * `replace` matters more than it looks: redeeming an invite should REPLACE /join/<code>
 * rather than push, so pressing back afterwards does not drop someone onto a code they
 * have already spent.
 */
export function navigate(route, { replace = false } = {}) {
  const path = buildPath(route);
  if (!globalThis.history) return;
  if (path === globalThis.location.pathname) return; // no-op, and no spurious popstate
  globalThis.history[replace ? "replaceState" : "pushState"]({}, "", path);
  // pushState does not fire popstate, so listeners are told explicitly. One event name
  // for both directions keeps the subscriber in useRoute trivial.
  globalThis.dispatchEvent(new PopStateEvent("popstate"));
}

/** Subscribe to route changes. Returns an unsubscribe. */
export function onRouteChange(handler) {
  const fn = () => handler(currentRoute());
  globalThis.addEventListener?.("popstate", fn);
  return () => globalThis.removeEventListener?.("popstate", fn);
}
