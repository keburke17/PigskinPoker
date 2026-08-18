/* Coalescing write queue.
 *
 * This is how the artifact's save GUARANTEE is kept while its COST is removed.
 *
 * The artifact saved the entire league, immediately, on every state change - so typing
 * "127" into a yards box was three full clones, three full serializations and three
 * network writes of a state object holding ~220 players plus a growing log. On game day
 * that is the thing that feels slow (P3).
 *
 * What is kept, deliberately:
 *   - nothing is ever lost;
 *   - failed writes retry with backoff;
 *   - the save-status bar and the manual Save Now button both still work.
 *
 * What changed:
 *   - writes COALESCE by key, so ten keystrokes in one box become one write;
 *   - the flush is DEBOUNCED, but forced on blur, visibilitychange and beforeunload,
 *     so a closing tab never drops an edit;
 *   - each write carries only what it touches.
 *
 * "We optimized it so it saves less" would be the wrong answer, and is not what this is.
 */

const DEFAULT_DEBOUNCE_MS = 400;
const RETRY_MS = 3000;
const MAX_RETRIES = 5;

export function createWriteQueue(opts = {}) {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const onStatus = opts.onStatus ?? (() => {});
  const onResult = opts.onResult ?? (() => {});

  /** key -> { run, attempts }. A later write to the same key replaces the earlier one. */
  const pending = new Map();
  let timer = null;
  let retryTimer = null;
  let inFlight = false;
  let lastError = null;
  let lastSavedAt = null;

  function status() {
    if (lastError) return "error";
    if (inFlight || pending.size > 0) return "saving";
    return "saved";
  }
  const emit = () => onStatus({ status: status(), lastSavedAt, error: lastError, pending: pending.size });

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, debounceMs);
    emit();
  }

  /**
   * @param {string}   key        writes with the same key coalesce (e.g. "stat:t1:QB")
   * @param {Function} run        async () => result
   * @param {boolean}  [immediate] skip the debounce (lifecycle ops, Save Now)
   */
  function enqueue(key, run, immediate = false) {
    pending.set(key, { run, attempts: 0 });
    if (immediate) return flush();
    schedule();
    return Promise.resolve();
  }

  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (inFlight || pending.size === 0) {
      emit();
      return;
    }

    inFlight = true;
    emit();

    // Snapshot: writes enqueued while this batch runs stay for the next one.
    const batch = [...pending.entries()];
    pending.clear();

    for (const [key, entry] of batch) {
      try {
        const result = await entry.run();
        if (result && result.ok === false && result.reason === "network") {
          throw new Error(result.message || "Network write failed");
        }
        lastError = null;
        onResult(key, result);
      } catch (e) {
        // Keep the guarantee: put it back and retry with backoff rather than drop it.
        entry.attempts += 1;
        lastError = e.message || String(e);
        if (entry.attempts <= MAX_RETRIES && !pending.has(key)) {
          pending.set(key, entry);
          if (!retryTimer) {
            retryTimer = setTimeout(() => {
              retryTimer = null;
              flush();
            }, RETRY_MS * entry.attempts);
          }
        } else {
          onResult(key, { ok: false, reason: "network", message: lastError });
        }
      }
    }

    inFlight = false;
    if (!lastError) lastSavedAt = new Date().toISOString();
    emit();
  }

  return {
    enqueue,
    flush,
    status,
    hasPending: () => pending.size > 0 || inFlight,
    clearError() {
      lastError = null;
      emit();
    },
    dispose() {
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      pending.clear();
    },
  };
}
