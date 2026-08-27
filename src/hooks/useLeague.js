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
  /* The newest value typed into each stat box, whether or not it has been written.
   * A write only clears the overlay if it wrote THIS value - see setStatLine. */
  const latestStat = useRef({});
  /* A refresh arrived while our own writes were in flight and was set aside rather
   * than applied on top of them. Picked up once the queue drains. */
  const missedRefresh = useRef(false);

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
      latestStat.current = {};
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

  /* Live updates from the store (Phase 2c: Supabase Realtime lands here unchanged).
   *
   * A refresh is NEVER applied while our own writes are still in flight. Realtime
   * fires on our own rows too, so a lineup swap or a typed stat would be answered,
   * half a second later, by a snapshot taken before it - the change appearing, then
   * reverting, then re-appearing when the write finished. What we set aside is not
   * dropped: `missedRefresh` re-reads once the queue is empty. */
  useEffect(() => {
    if (!store.subscribe) return undefined;
    return store.subscribe((next) => {
      if (!next) return;
      if (queue.hasPending()) {
        missedRefresh.current = true;
        return;
      }
      setView(next);
    });
  }, [store, queue]);

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

  /* The catch-up for the subscription above: as soon as nothing of ours is in
   * flight, pick up the refresh it set aside. */
  useEffect(() => {
    if (saveState.status !== "saved" || !missedRefresh.current) return undefined;
    missedRefresh.current = false;
    let cancelled = false;
    store
      .loadLeague()
      .then((next) => {
        if (!cancelled && next && !queue.hasPending()) setView(next);
      })
      .catch(() => {
        /* the next realtime event will bring it round again */
      });
    return () => {
      cancelled = true;
    };
  }, [saveState.status, store, queue]);

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
      latestStat.current[k] = line;
      setPendingStats((prev) => ({ ...prev, [k]: line }));
      queue.enqueue(vkey.statLine(teamId, slot), async () => {
        const r = await store.setStatLine(teamId, slot, line, versions());
        handle(r);
        /* Clear the overlay ONLY if this write carried the newest thing typed.
         *
         * It used to clear unconditionally, and that is what ate the numbers: type
         * "500", and the write for "5" comes back a second later carrying a server
         * view that says 5. Dropping the overlay then showed the server's 5 in a box
         * he had already finished typing 500 into - so the value visibly shortened,
         * and moving to the TDs box mid-flight made it likelier by giving the round
         * trip time to land. If a newer value is queued, the overlay stays up until
         * THAT write returns. */
        if (r.ok && latestStat.current[k] === line) {
          delete latestStat.current[k];
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

  /** Move the two players on screen NOW, then write it.
   *
   * A swap is a straight exchange of one starter and one bench player - the same
   * two lines the artifact ran in place (`onSwap`), and the same two the server
   * runs. Showing it immediately is therefore not a guess about what the server
   * will do; it is the same move, drawn without waiting for the round trip. A
   * refusal still wins: if it carries the real league (someone else moved first)
   * `handle` puts that on screen, and if it does not, swapLineupSlot below undoes
   * the move itself.
   *
   * Versions are untouched on purpose: the write still carries the versions we
   * last saw from the server, so the compare-and-swap still catches a conflict. */
  const applySwapLocally = useCallback((teamId, slot, benchIndex) => {
    setView((prev) => {
      const team = prev?.teams?.find((t) => t.id === teamId);
      if (!team || !team.roster) return prev;
      const starterId = team.roster.starters[slot];
      const benchId = team.roster.bench[benchIndex];
      const locks = prev.lockedPlayerIds || {};
      if ((starterId && locks[starterId]) || (benchId && locks[benchId])) return prev;
      const nextBench = team.roster.bench.slice();
      nextBench[benchIndex] = starterId;
      return {
        ...prev,
        teams: prev.teams.map((t) =>
          t.id !== teamId
            ? t
            : {
                ...t,
                roster: {
                  ...t.roster,
                  starters: { ...t.roster.starters, [slot]: benchId },
                  bench: nextBench,
                },
              }
        ),
      };
    });
  }, []);

  const swapLineupSlot = useCallback(
    (teamId, slot, benchIndex) => {
      applySwapLocally(teamId, slot, benchIndex);
      return immediate(vkey.starterSlot(teamId, slot), async () => {
        const r = await store.swapLineupSlot(teamId, slot, benchIndex, versions());
        /* Put the two players back if the swap was refused and the refusal did not
         * carry the real league with it - "that player is locked" does not. Without
         * this the move would sit there on screen beside the message saying it did
         * not happen. A swap is its own inverse, so running it again undoes it
         * without disturbing anything else that moved in the meantime.
         *
         * A network failure is NOT a refusal: the queue is still retrying it, and
         * undoing would take away a move that is about to succeed. */
        if (r && !r.ok && !r.view && r.reason !== "network") {
          applySwapLocally(teamId, slot, benchIndex);
        }
        return r;
      });
    },
    [store, immediate, applySwapLocally]
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
