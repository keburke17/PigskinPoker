/* Keeping a phone on the current version of the site (Scott, 2026-11-05).
 *
 * THE BUG: after the Home button went live, Scott kept seeing Log Out in the league
 * header until he refreshed - every time he opened the site. Nothing in the code drew
 * it. A phone does not reload a page it already has open: switching back to Safari, or
 * opening a home-screen icon, brings back the page exactly as it was left, old code
 * and all. Netlify serves index.html with must-revalidate, so a REAL load always gets
 * the new build; the trouble is that no load happens.
 *
 * THE FIX: every build stamps its id into the bundle (__APP_BUILD__) and writes the same
 * id to /version.json (vite.config.js). Whenever the page comes back into view, ask the
 * server for /version.json; if the id differs, this page is an old build, so reload it.
 *
 * NEVER RELOADS OVER UNSAVED WORK. `canReload` is asked first - App passes "the save
 * queue is idle" - and if a save is in flight the reload waits for the next time it is
 * asked. Anything short of a confirmed different id (offline, a dev server with no
 * version.json, garbage) does nothing at all: a check that fails must not cost
 * anybody their page.
 */

import { useEffect, useRef } from "react";

/* eslint-disable no-undef */
export const BUILD_ID = typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : null;
/* eslint-enable no-undef */

/**
 * Is the server's build newer than this page's? Pure apart from the fetch it is handed,
 * so tests/freshVersion.test.js can drive it.
 *
 * True ONLY for a well-formed answer naming a different build. Every failure is false.
 */
export async function serverHasNewerBuild(fetchImpl, current = BUILD_ID) {
  if (!current || typeof fetchImpl !== "function") return false;
  try {
    const res = await fetchImpl("/version.json?t=" + Date.now(), { cache: "no-store" });
    if (!res || !res.ok) return false;
    const body = await res.json();
    return typeof body?.build === "string" && body.build !== "" && body.build !== current;
  } catch {
    return false;
  }
}

/**
 * Check when the page comes back into view - the moment a phone shows an old page -
 * and reload onto the new build when it is safe to.
 */
export function useFreshVersion(canReload) {
  const canReloadRef = useRef(canReload);
  canReloadRef.current = canReload;

  useEffect(() => {
    if (!BUILD_ID || typeof window === "undefined") return undefined;
    let checking = false;
    let lastChecked = 0;

    /* At most once a minute: on a computer, focus fires every time the window is
     * clicked back into, and one small request a minute is plenty. */
    const check = async () => {
      if (checking || document.visibilityState === "hidden") return;
      if (Date.now() - lastChecked < 60 * 1000) return;
      lastChecked = Date.now();
      checking = true;
      try {
        if ((await serverHasNewerBuild(window.fetch.bind(window))) && canReloadRef.current()) {
          window.location.reload();
        }
      } finally {
        checking = false;
      }
    };

    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    /* `pageshow` with persisted=true is Safari restoring the page from its back-forward
     * cache, which does not fire visibilitychange. */
    const onPageShow = (e) => { if (e.persisted) check(); };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", check);
    };
  }, []);
}
