/* Login rate limiting. Server-side only - it holds the pepper and writes a table the
 * publishable key cannot see.
 *
 * THE PROBLEM THIS SOLVES. Until now nothing limited login attempts at all. The codes
 * are short, shared, and typed by people - "DEMO-TEAM-1" is representative - so the
 * whole keyspace is small enough to walk, and the only cost per guess was scrypt's
 * ~50ms. That is the one item docs/AUTH.md called "the one that matters".
 *
 * TWO BUCKETS, TWO DIFFERENT CONTROLS. This is the part worth reading:
 *
 *   IP bucket      - a real lockout, with exponential backoff. Punishing the source of
 *                    the guessing is safe, because the only person inconvenienced is
 *                    the one doing it.
 *   target bucket  - a SLOWDOWN. It is capped at a few seconds and never escalates,
 *                    which is the entire point. An escalating lock on "team 3" or
 *                    "this league" would hand anyone a denial-of-service against the
 *                    real commissioner: hammer his login and he cannot get into his own
 *                    league on game day. An attacker would pick that deliberately, and
 *                    it is a worse outcome than a slow brute force.
 *
 *                    BE HONEST ABOUT WHAT IT COSTS: while an attack is running, a
 *                    legitimate sign-in to that league can meet a few seconds' wait.
 *                    That is the accepted price, and it is bounded - seconds, not the
 *                    hour the IP bucket will happily impose on the attacker. What it
 *                    buys is that a DISTRIBUTED attack, where every request comes from
 *                    a fresh address and the IP bucket never bites, still cannot exceed
 *                    one guess every few seconds against a given league.
 *
 * A SUCCESSFUL LOGIN CLEARS BOTH. Someone who mistypes a code four times and then gets
 * it right is not carrying a strike into next week.
 *
 * FAILING OPEN IS DELIBERATE. If the throttle table itself errors, login proceeds. A
 * broken counter must not become an outage that locks the entire league out on a
 * Sunday; the counter is a mitigation, not the security boundary. Every path that can
 * swallow an error says so at the point it does it.
 */

import crypto from "node:crypto";

export const POLICY = {
  windowMs: 15 * 60 * 1000, // failures older than this start a fresh count
  freeAttempts: 10,         // failures allowed in a window before anything happens
  ipBaseLockMs: 60 * 1000,  // first IP lockout, doubling per excess failure
  ipMaxLockMs: 60 * 60 * 1000,   // capped at an hour - long enough, not permanent
  targetDelayMs: 5 * 1000,       // the target bucket's fixed, capped slowdown
  pruneAfterMs: 24 * 60 * 60 * 1000, // rows untouched for a day are litter
};

/* The pepper keeps the table from being a visitor log: without it, a stored
 * sha256 of an IP is trivially reversible by walking the address space.
 *
 * It falls back to the secret key rather than demanding a new environment variable.
 * This project is being handed to a hobbyist, and a required-but-easily-missed
 * variable that silently degrades a security control is a bad trade. Consequence,
 * stated plainly: rotating the secret key re-buckets everyone in flight, which costs
 * one window of counting and nothing else. */
function pepper(env = process.env) {
  return env.AUTH_IP_PEPPER || env.SUPABASE_SECRET_KEY || "pigskin-dev-pepper";
}

/** @returns {string|null} null when the platform gave us no address to count. */
export function ipBucket(ip, env = process.env) {
  if (!ip || typeof ip !== "string") return null;
  const hash = crypto.createHash("sha256").update(ip.trim() + "|" + pepper(env)).digest("hex");
  return "ip:" + hash;
}

export const leagueBucket = (leagueId) => (leagueId ? "league:" + leagueId : null);

/* Keyed on the LEGACY team id rather than the row's uuid, deliberately: the legacy id
 * arrives in the request, so the bucket can be checked before any database work and
 * before scrypt runs. Keying on the uuid would mean resolving the team first, which is
 * exactly the work an attacker wants us to do. Scoped by league so two leagues cannot
 * share a counter through having a "team_1" each. */
export const teamBucket = (leagueId, teamLegacyId) =>
  leagueId && teamLegacyId ? "team:" + leagueId + ":" + teamLegacyId : null;

const isIp = (key) => key.startsWith("ip:");

/* freeAttempts is a budget of FAILURES, and it is spent when it reaches zero: the
 * tenth wrong code is still answered "incorrect code" (it is one), and it is also the
 * one that arms the lock, so the eleventh ATTEMPT is the first to be refused. Ten
 * tries, then you wait.
 *
 * Backoff then doubles per further failure - a minute, two, four - capped at an hour.
 * The count is clamped before the shift because 1 << 40 is not a number anyone wants
 * to reason about. */
function lockMsFor(bucketKey, attempts) {
  const spent = attempts - POLICY.freeAttempts + 1;
  if (spent <= 0) return 0;
  if (!isIp(bucketKey)) return POLICY.targetDelayMs; // fixed, and never escalating
  const doublings = Math.min(spent - 1, 20);
  return Math.min(POLICY.ipBaseLockMs * 2 ** doublings, POLICY.ipMaxLockMs);
}

/* CONCURRENCY, STATED PLAINLY. recordFailure reads then writes, so two simultaneous
 * failures on one bucket can both read the same count and record the same increment -
 * one failure goes uncounted. Fixing it properly means an atomic increment in a
 * Postgres function, which is a schema object and a migration to maintain.
 *
 * Not fixed on purpose: the error is at most a handful of attempts on a threshold of
 * ten, an attacker parallelising requests hits the lock a fraction later rather than
 * escaping it, and the mitigation is a speed bump in front of scrypt rather than the
 * security boundary. Worth revisiting if this ever guards something that matters more
 * than a fantasy league. */
async function readBuckets(db, keys) {
  const { data, error } = await db
    .from("auth_throttle")
    .select("bucket_key, attempts, window_start, locked_until")
    .in("bucket_key", keys);
  if (error) return null; // fail open - see the header
  return data ?? [];
}

/**
 * Called BEFORE the code is verified.
 * @returns {{retryAfterSeconds:number}|null} null means "carry on".
 */
export async function checkThrottle(db, bucketKeys) {
  const keys = bucketKeys.filter(Boolean);
  if (keys.length === 0) return null;
  const rows = await readBuckets(db, keys);
  if (!rows) return null;

  const now = Date.now();
  let worstMs = 0;
  for (const row of rows) {
    if (!row.locked_until) continue;
    /* `locked_until` is the ONLY authority here, deliberately.
     *
     * An earlier version also required the counting window to still be open, which
     * quietly capped every lockout at windowMs: an IP that had earned an hour was let
     * back in after fifteen minutes, so the whole exponential backoff above
     * POLICY.windowMs did nothing. The two clocks answer different questions - the
     * window decides whether the COUNT still means anything, the lock decides whether
     * this attempt is allowed - and conflating them broke the more important one. */
    const remaining = new Date(row.locked_until).getTime() - now;
    if (remaining > worstMs) worstMs = remaining;
  }
  if (worstMs <= 0) return null;
  return { retryAfterSeconds: Math.max(1, Math.ceil(worstMs / 1000)) };
}

/** Called after a login attempt is REJECTED. Increments every bucket it was counted in. */
export async function recordFailure(db, bucketKeys) {
  const keys = bucketKeys.filter(Boolean);
  if (keys.length === 0) return;
  const now = Date.now();
  const rows = (await readBuckets(db, keys)) ?? [];
  const byKey = new Map(rows.map((r) => [r.bucket_key, r]));

  for (const key of keys) {
    const prior = byKey.get(key);
    /* Does the existing count still stand, or does this failure start a fresh one?
     *
     * It stands while the window is open - and ALSO while a lock is in force or has
     * only just lapsed. Without that second clause, serving a lockout would reset the
     * count: an attacker locked out for an hour comes back to a clean slate and ten
     * more free guesses, and the backoff never escalates past its first step. Sitting
     * out a punishment must not be a way to clear it. */
    const lockedUntilMs = prior?.locked_until ? new Date(prior.locked_until).getTime() : 0;
    const windowLive =
      prior &&
      (new Date(prior.window_start).getTime() + POLICY.windowMs >= now ||
        lockedUntilMs + POLICY.windowMs >= now);
    const attempts = windowLive ? prior.attempts + 1 : 1;
    const windowStart = windowLive ? prior.window_start : new Date(now).toISOString();
    const lockMs = lockMsFor(key, attempts);

    const { error } = await db.from("auth_throttle").upsert({
      bucket_key: key,
      attempts,
      window_start: windowStart,
      locked_until: lockMs > 0 ? new Date(now + lockMs).toISOString() : null,
      updated_at: new Date(now).toISOString(),
    });
    // Fail open, loudly enough to find in a log but without failing the request:
    // a counter that cannot write must not become a login outage.
    if (error) console.warn("[throttle] could not record failure for " + key + ": " + error.message);
  }
  await prune(db);
}

/** Called after a login SUCCEEDS. The buckets have done their job. */
export async function clearBuckets(db, bucketKeys) {
  const keys = bucketKeys.filter(Boolean);
  if (keys.length === 0) return;
  const { error } = await db.from("auth_throttle").delete().in("bucket_key", keys);
  if (error) console.warn("[throttle] could not clear buckets: " + error.message);
}

/* Opportunistic, on the write path, so nothing accumulates and there is no scheduled
 * job to forget about. Cheap: it is one indexed delete on a table that stays tiny. */
async function prune(db) {
  const cutoff = new Date(Date.now() - POLICY.pruneAfterMs).toISOString();
  await db.from("auth_throttle").delete().lt("updated_at", cutoff);
}

export const THROTTLED = {
  status: 429,
  error: "Too many sign-in attempts. Wait a moment and try again.",
};
