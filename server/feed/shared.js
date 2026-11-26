/* One download of each NFL file per scheduled run, shared by every league in it.
 *
 * WHY. The hourly jobs (the weekly cycle, the stats pull, the injury pull, the league
 * checker) walk every league in turn, and every league used to fetch the feed for
 * itself. The NFL's schedule, stats and depth charts are the same for everybody, so a
 * Tuesday with N leagues downloaded the 8.6 MB games.csv about 2N times, plus the stats
 * file and the depth charts N times each - inside a scheduled function that Netlify
 * stops after about 30 seconds. With a handful of leagues that is a run cut off
 * halfway; with thousands it cannot finish at all. docs/PLAN-AUTOMATIC-LEAGUES.md, step 2.
 *
 * WHAT IT DOES. `sharedFeed(source)` returns an object with the same methods as the feed
 * it wraps. Each method's answer is remembered by its arguments for the life of the
 * object, which is one run: the second league asking for Week 12's results gets the
 * first league's copy. On top of that, the games file itself is downloaded once however
 * many different questions are asked of it (results, kickoffs, week starts, the season's
 * games), because every one of those reads the same URL in full.
 *
 * WHAT IT DOES NOT DO.
 *   - Outlive the run. A fresh object every run, so a correction published at 5am is
 *     seen at 6am. Nothing is written anywhere.
 *   - Remember a failure. A rejected download is forgotten at once, so the next league
 *     tries again rather than inheriting a timeout.
 *   - Hand out the same object twice. Each caller gets its own deep copy, so code that
 *     edits what it was given (a results Map, a list of lines) cannot reach into the
 *     next league's answer.
 *   - Cache the big streamed files as text. The stats file is read as a stream and
 *     abandoned once the wanted week has gone by; the per-method memo is enough for it.
 */

import { GAMES_URL } from "./nflverse.js";

/** A fetch that downloads each URL in `cacheUrls` once and serves its text after. */
export function cachingFetch(cacheUrls, fetchImpl = fetch) {
  const texts = new Map();
  return async (url, init) => {
    const key = String(url);
    if (!cacheUrls.has(key)) return fetchImpl(url, init);
    if (!texts.has(key)) {
      const pending = (async () => {
        const res = await fetchImpl(url, init);
        if (!res.ok) {
          const err = new Error("HTTP " + res.status);
          err.status = res.status;
          throw err;
        }
        return res.text();
      })();
      texts.set(key, pending);
      pending.catch(() => texts.delete(key));
    }
    let text;
    try {
      text = await texts.get(key);
    } catch (err) {
      /* Answer like the network did, so the feed's own "returned HTTP 503" message is
       * unchanged and the caller's error handling sees what it always saw. */
      if (err && err.status) return { ok: false, status: err.status, text: async () => "" };
      throw err;
    }
    /* No `body`: the feed's readers fall back to reading the text whole, which is what
     * they do for this file anyway. */
    return { ok: true, status: 200, text: async () => text };
  };
}

/**
 * The feed, with every answer shared for the rest of the run.
 *
 * @param {object} source  a feed: server/feed/nflverse.js, fixture.js, or a test's object
 * @param {{ fetchImpl?: Function }} opts
 */
export function sharedFeed(source, { fetchImpl = fetch } = {}) {
  if (!source || source.__shared) return source;
  const fetchOnce = cachingFetch(new Set([GAMES_URL]), fetchImpl);
  const memo = new Map();
  const out = { __shared: true };

  for (const name of Object.keys(source)) {
    const value = source[name];
    if (typeof value !== "function" || !/^fetch[A-Z]/.test(name)) {
      out[name] = value;
      continue;
    }
    out[name] = async (args = {}) => {
      const key = name + ":" + JSON.stringify(args ?? {});
      if (!memo.has(key)) {
        /* fetchImpl goes to the live feed; the fixture and test feeds ignore it. */
        const pending = Promise.resolve(value.call(source, { ...(args ?? {}), fetchImpl: fetchOnce }));
        memo.set(key, pending);
        pending.catch(() => memo.delete(key));
      }
      return structuredClone(await memo.get(key));
    };
  }
  return out;
}
