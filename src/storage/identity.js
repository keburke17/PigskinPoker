/* Per-device identity (which team/role is logged in on THIS browser).
 *
 * This never belonged in shared storage. The artifact put it there because
 * window.storage was the only persistence available; localStorage is the right home
 * and needs no backend, now or in Phase 2.
 */

import { IDENTITY_KEY } from "./types.js";

const EMPTY = { role: null, teamId: null };

export function loadIdentity() {
  try {
    const raw = globalThis.localStorage?.getItem(IDENTITY_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...EMPTY };
    return { role: parsed.role ?? null, teamId: parsed.teamId ?? null };
  } catch {
    // Corrupt or unavailable (private mode, storage disabled). Stay logged out.
    return { ...EMPTY };
  }
}

export function saveIdentity(identity) {
  try {
    globalThis.localStorage?.setItem(IDENTITY_KEY, JSON.stringify(identity ?? EMPTY));
  } catch {
    // Non-fatal: the user just has to log in again next visit.
  }
}
