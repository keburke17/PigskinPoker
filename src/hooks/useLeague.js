/* useLeague - the whole read/write lifecycle in one hook.
 *
 * Replaces the artifact's `update(s => ...)`, which cloned and re-saved the entire
 * league on every change. Each operation here writes only what it touches.
 *
 * PRESERVED BEHAVIOUR (docs/DATA-MODEL.md "Do not change"):
 *
 *   1. THE REFUSAL TO SILENTLY START BLANK. A load error that is not "no league yet"
 *      does NOT fall back to an empty league - it retries with staged backoff and then
 *      blocks. Starting blank would let the save path write emptiness over real data.
 *      This matters MORE now, not less.
 *   2. THE STRONG SAVE GUARANTEE. Aggressive saving, retries, the status bar and Save
 *      Now all survive; only the cost changed. See storage/writeQueue.js.
 *
 * NEW: conflicts are surfaced, never resolved by overwriting. There is no
 * last-write-wins path anywhere in this file.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { loadIdentity, saveIdentity } from "../storage/index.js";
import { createWriteQueue } from "../storage/writeQueue.js";
import { vkey } from "../storage/hydrate.js";

const MAX_LOAD_ATTEMPTS = 3;

export function useLeague(store) {
  const [view, setView] = useState(null);
  const [identity, setIdentity] = useState({ role: null, teamId: null });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  /* Distinct from loadFailed: the database answered correctly and simply has no league
   * in it yet. That is a deployment step that has not been run, not an error - and it
   * needs its own screen, or the app just sits on "Loading..." forever. */
  const [noLeague, setNoLeague] = useState(false);
  const [loadErrorDetail, setLoadErrorDetail] = useState(null);
  const [saveState, setSaveState] = useState({ status: "saved", lastSavedAt: null, error: null });
  const [conflict, setConflict] = useState(null);
  const [opError, setOpError] = useState(null);

  /* Locally-typed stat values that have not been written yet. The input stays
   * instant while the write is debounced; this overlay is what makes that safe. */
  const [pendingStats, setPendingStats] = useState({});

  /* Legacy team ids with a scheme in for this week, or null when we have not been
   * told (not the commissioner, or the first answer has not landed). Null and []
   * mean different things to the panel, so they stay distinguishable. */
  const [submittedTeamIds, setSubmittedTeamIds] = useState(null);

  const viewRef = useRef(null);
  const loadAttempt = useRef(0);
  const loadRetryTimer = useRef(null);
  const queueRef = useRef(null);

  viewRef.current = view;

  /* ------------------------------- loading ------------------------------- */
  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const next = await store.loadLeague();
      loadAttempt.current = 0;
      if (loadRetryTimer.current) {
        clearTimeout(loadRetryTimer.current);
        loadRetryTimer.current = null;
      }
      setView(next);
      setNoLeague(next === null);
      setPendingStats({});
      setLoading(false);
    } catch (e) {
      // Do NOT fall back to an empty league. Retry a few times, then block.
      const detail = e?.message || String(e);
      setLoadErrorDetail(detail);
      loadAttempt.current += 1;
      if (loadAttempt.current <= MAX_LOAD_ATTEMPTS) {
        if (loadRetryTimer.current) clearTimeout(loadRetryTimer.current);
        loadRetryTimer.current = setTimeout(load, loadAttempt.current * 2000);
        return;
      }
      setLoadFailed(true);
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    setIdentity(loadIdentity());
    load();
    return () => {
      if (loadRetryTimer.current) clearTimeout(loadRetryTimer.current);
    };
  }, [load]);

  useEffect(() => {
    saveIdentity(identity);
  }, [identity]);

  /* --------------------------- the write queue --------------------------- */
  if (!queueRef.current) {
    queueRef.current = createWriteQueue({
      onStatus: (s) => setSaveState(s),
    });
  }
  const queue = queueRef.current;

  useEffect(() => () => queue.dispose(), [queue]);

  /* Live updates from the store (Phase 2c: Supabase Realtime lands here unchanged). */
  useEffect(() => {
    if (!store.subscribe) return undefined;
    return store.subscribe((next) => {
      if (next) setView(next);
    });
  }, [store]);

  /* Commissioner-only: which teams have a scheme in this week.
   *
   * This does NOT come from `view`, and re-reading the league would not produce it.
   * An unresolved scheme is hidden from every browser read by design (OQ-9), and
   * `schemes` is deliberately absent from the Realtime publication too - a push would
   * tell a manager, mid-week, that a rival had just moved. So the count is ASKED for,
   * from the one screen entitled to it, and the answer is a list of team ids and
   * nothing else. See server/operations.js schemeStatus.
   *
   * A poll, because there is no event to subscribe to: the server call is the only
   * way this number ever changes on a screen that is just sitting open. */
  const refreshSchemeStatus = useCallback(async () => {
    if (identity.role !== "commissioner" || !store.schemeStatus) return;
    /* Only while schemes are actually being collected. Every other phase either has
     * no answer to give or has already resolved them into the roster. */
    if (viewRef.current?.currentPeriod?.phase !== "dealt") return;
    try {
      const r = await store.schemeStatus();
      if (r?.ok) setSubmittedTeamIds(r.submittedTeamIds ?? []);
    } catch {
      /* a missed poll is not fatal; the next tick retries */
    }
  }, [identity.role, store]);

  useEffect(() => {
    if (identity.role !== "commissioner" || !store.schemeStatus) {
      setSubmittedTeamIds(null);
      return undefined;
    }
    refreshSchemeStatus();
    const id = setInterval(refreshSchemeStatus, 15000);
    return () => clearInterval(id);
  }, [identity.role, store, refreshSchemeStatus]);

  /* Flush on the three moments a pending write could otherwise be lost. */
  useEffect(() => {
    const flush = () => queue.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [queue]);

  /* --------------------------- result handling --------------------------- */
  const handle = useCallback((result) => {
    if (!result) return;
    if (result.ok) {
      if (result.view) setView(result.view);
      return;
    }
    if (result.view) setView(result.view); // always show the truth
    if (result.reason === "stale") {
      setConflict({
        key: result.key,
        message: "Someone else just updated the league - reloaded.",
      });
    } else if (result.reason === "phase") {
      setOpError({ headline: result.message, detail: null });
    } else if (result.reason === "locked" || result.reason === "invalid") {
      setOpError({ headline: result.message, detail: null });
    } else if (result.reason === "network") {
      setOpError({ headline: "Couldn't save that change.", detail: result.message });
    }
  }, []);

  const versions = () => viewRef.current?._meta?.versions ?? {};


  const immediate = useCallback(
    (key, fn) => {
      setOpError(null);
      return queue.enqueue(
        key,
        async () => {
          const r = await fn();
          handle(r);
          return r;
        },
        true
      );
    },
    [queue, handle]
  );

  /* ------------------------------ operations ----------------------------- */

  /** Stat entry: instant locally, coalesced and debounced on the wire. */
  const setStatLine = useCallback(
    (teamId, slot, line) => {
      const k = teamId + ":" + slot;
      setPendingStats((prev) => ({ ...prev, [k]: line }));
      queue.enqueue(vkey.statLine(teamId, slot), async () => {
        const r = await store.setStatLine(teamId, slot, line, versions());
        handle(r);
        if (r.ok) {
          setPendingStats((prev) => {
            const next = { ...prev };
            delete next[k];
            return next;
          });
        }
        return r;
      });
    },
    [store, queue, handle]
  );

  const toggleSlotLock = useCallback(
    (teamId, playerId) =>
      immediate("lock:" + teamId + ":" + playerId, () =>
        store.toggleSlotLock(teamId, playerId, versions())
      ),
    [store, immediate]
  );

  const swapLineupSlot = useCallback(
    (teamId, slot, benchIndex) =>
      immediate(vkey.starterSlot(teamId, slot), () =>
        store.swapLineupSlot(teamId, slot, benchIndex, versions())
      ),
    [store, immediate]
  );

  /* The commissioner can submit on a team's behalf from Manage Rosters, and when he
   * does his own Weeks count should move at once rather than on the next tick. */
  const submitScheme = useCallback(
    async (teamId, scheme) => {
      const r = await immediate(vkey.scheme(teamId), () =>
        store.submitScheme(teamId, scheme, versions())
      );
      refreshSchemeStatus();
      return r;
    },
    [store, immediate, refreshSchemeStatus]
  );

  const toggleRosterLock = useCallback(
    () => immediate("rosterLock", () => store.toggleRosterLock(versions())),
    [store, immediate]
  );

  const dealPeriod = useCallback(
    () => immediate("deal", () => store.dealPeriod(versions())),
    [store, immediate]
  );
  const processSchemes = useCallback(
    () => immediate("processSchemes", () => store.processSchemes(versions())),
    [store, immediate]
  );
  const finalizePeriod = useCallback(
    () => immediate("finalize", () => store.finalizePeriod(versions())),
    [store, immediate]
  );
  const startPlayoffs = useCallback(
    (bracketSize, advancement) =>
      immediate("startPlayoffs", () => store.startPlayoffs(bracketSize, advancement, versions())),
    [store, immediate]
  );

  /** Commissioner admin: low-frequency, genuinely league-wide. */
  const mutate = useCallback(
    (key, fn) => immediate(key, () => store.mutateLeague(fn)),
    [store, immediate]
  );

  /* ---------------------------- derived view ----------------------------- */
  /* Overlay un-written stat values so typing is instant without lying about
   * anything else. Everything outside statsEntry is the server's truth. */
  let effectiveView = view;
  if (view && Object.keys(pendingStats).length) {
    effectiveView = { ...view, statsEntry: { ...view.statsEntry } };
    for (const [k, line] of Object.entries(pendingStats)) {
      const [teamId, slot] = k.split(":");
      effectiveView.statsEntry[teamId] = { ...(effectiveView.statsEntry[teamId] || {}), [slot]: line };
    }
  }

  return {
    view: effectiveView,
    submittedTeamIds,
    identity,
    setIdentity,
    loading,
    loadFailed,
    noLeague,
    loadErrorDetail,
    retryLoad: () => {
      loadAttempt.current = 0;
      setLoading(true);
      load();
    },
    saveState,
    saveNow: () => queue.flush(),
    conflict,
    dismissConflict: () => setConflict(null),
    opError,
    dismissOpError: () => setOpError(null),
    ops: {
      setStatLine,
      toggleSlotLock,
      swapLineupSlot,
      submitScheme,
      toggleRosterLock,
      dealPeriod,
      processSchemes,
      finalizePeriod,
      startPlayoffs,
      mutate,
    },
    store,
  };
}
