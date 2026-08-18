# Phase 3 - plan

Status: **draft for review.** Nothing in here is built yet.

Phase 3 was originally scoped as *"real authorization now, real accounts later"*. Most of
the "real authorization now" half was **borrowed forward into Phase 2c** - codes are
hashed, sessions are real, and every privileged write is checked on the server. So Phase 3
as it actually stands is three different things wearing one label:

1. **the gaps 2c knowingly left behind** (rate limiting, session lifecycle, code policy),
2. **the accounts layer** that was always Phase 3's real content,
3. **decisions that shape it** - OQ-10 above all - which are the designer's, not mine.

This document is the plan for (1) and (2), and says exactly which parts of it (3) turns on
or off.

---

## Where Phase 3 starts

Already done, in 2c - do not redo:

- codes hashed with scrypt, stored in tables the publishable key cannot read
- login returns an opaque session token; only `sha256(token)` is stored
- `isCommissioner()` / `canActForTeam()` gate every privileged operation, asserted in
  `tests/server.test.js`
- `auth.users` deliberately not shadowed, so accounts are additive rather than a migration

Carried forward deliberately, and written down in `docs/AUTH.md` under "what is
deliberately still weak":

| Gap | Where | Severity |
|---|---|---|
| No rate limiting on login | `server/operations.js` login paths | **the one that matters** |
| Changing a team join code does not sign out that team | `setTeamJoinCode` | one line |
| No minimum join code length | `setTeamJoinCode` | a 2-character code is possible today |
| Sessions expire (30 days) but never rotate | `server/auth.js` | moderate |
| `sessions` is hand-rolled | `server/auth.js` | to be replaced, not grown |
| Block is not validated server-side (OQ-B) | `submitScheme` | a crafted request can block another team's player |
| Stat writes are not refused while the roster is unlocked (OQ-E) | `setStatLine` | narrow, but it silently misattributes stats |

---

## The slices

### 3a - Harden what shipped (no decisions needed, ship on its own)

Independent of every open question except the two rule confirmations at the end. This is
the slice that should land first and could land alone.

**1. Rate limiting on login.**
Netlify Functions are stateless and horizontally scaled, so the counter has to live in
Postgres. One new table, `auth_throttle`, keyed by bucket:

```
auth_throttle(bucket_key text primary key, attempts int, window_start timestamptz,
              locked_until timestamptz)
```

Two buckets are checked per login attempt:

- **per source IP** (`ip:<sha256(ip + pepper)>`) - hard limit. Netlify supplies
  `x-nf-client-connection-ip`; the header has to be plumbed from `netlify/functions/api.mjs`
  into the op, which does not receive it today. The IP is hashed with a server-side pepper
  so the table is not a visitor log.
- **per target** (`league:<id>` / `team:<id>`) - deliberately a *slowdown*, not a lockout.
  A hard per-target lock would let anyone lock the real commissioner out of his own league
  by hammering the login, which is a worse failure than a slow brute force.

Proposed policy: 10 failures in 15 minutes on a bucket, then exponential backoff capped at
1 hour for the IP bucket and capped at a fixed delay for the target bucket. A successful
login clears its buckets. Failures return 429 with `Retry-After`. Rows older than the
window are pruned opportunistically on write, so nothing accumulates.

**2. `setTeamJoinCode` deletes that team's sessions.** The commissioner rotating a code
means "someone should no longer have this"; a 30-day token surviving it defeats the point.
Commissioner code rotation already does this (`scripts/set-commissioner-code.mjs`); this is
the same one-line delete on the team path, plus a test.

**3. Join code policy.** Minimum 8 characters (matching what `PIGSKIN_COMMISSIONER_CODE`
already enforces), maximum 64, printable ASCII, rejected server-side rather than warned
about in the UI - the UI states the rule inline. **Validation is on set, not on verify**,
so no existing code stops working; hashes are one-way, so there is no way to find short
codes already in the database. If any live team is on a short code, rotate it once during
cutover.

**4. Session lifecycle.** Absolute 30-day cap kept, plus idle expiry (proposed: 14 days)
and a token refresh on use so an active manager is not signed out mid-season. Add a
commissioner "sign out all devices" action for a team. Deliberately modest: if 3c lands,
Supabase Auth replaces this mechanism, so this is maintenance, not investment.

**5. The two server-side rule validations that 2c deferred.** Both are the designer's
rules, both are listed as confirmation items:

- **OQ-B** - Block must name one of *your own starters*. The form already allows nothing
  else; the server does not re-check, so a crafted request can block another team's player.
- **OQ-E** - reject stat writes while the roster is unlocked, which closes the
  stats-follow-the-slot gap without changing anything anyone would notice.

**Both validators go in `server/operations.js`, not in `src/engine/`.** The engine stays
byte-identical to the legacy region so `tests/parity.test.js` stays green: the engine's
behaviour for valid input does not change, and only the server rejects input the UI could
never have produced.

*Verification:* every one of these lands in `tests/server.test.js` / `tests/rls.test.js`,
which **skip silently without a local Supabase stack** (59 of 190 tests). Check the skip
count, not the pass.

---

### 3b + 3c - Membership and real accounts (gated on OQ-5)

These ship together or not at all. `league_members` with no accounts to populate it is
dead schema, and accounts without it have nowhere to record a role.

**3b - the tables**, exactly as `docs/AUTH.md` already commits to:

- `profiles(user_id pk -> auth.users(id), display_name, created_at)` - never columns on
  `auth.users`
- `league_members(league_id, user_id, role, team_id, created_at, unique(league_id, user_id))`
- RLS policies and grants in the same migration, per the standing rule
- `verifySession()` accepts **either** a join-code session token **or** a Supabase JWT, and
  both resolve to the same `{leagueId, role, teamId}` - so nothing downstream changes

**3c - the sign-in**:

- Supabase email magic link, recommended over passwords: nothing to store, no reset flow to
  build, and it fits a dozen people who log in a few times a season. Google is one dashboard
  toggle on top if wanted.
- The code box **stays exactly where it is**. Sign-in is an addition beside it, not a
  replacement.
- Migration by invitation, not by force: a manager already holding a join-code session who
  signs in with email gets their `league_members` row created from the session they already
  have. Nobody is locked out mid-season, and the join code keeps working.
- This is also the point where collecting an email address is free - see OQ-6. If
  notifications are ever wanted, having the addresses already is the difference between a
  feature and a chore.

---

### 3d - League ownership and multi-league (gated on OQ-10 - **the blocking question**)

Only if multi-league is on the roadmap at all. If it is, it belongs *with* accounts, not
after them, because "who owns this league" otherwise gets answered twice.

- reads become league-scoped in RLS (`using (league_id = ...)`) - today every read policy
  is `using (true)`, which is correct for one public league and wrong the moment there are
  two
- league creation in the app, with **the creator becoming its commissioner** - which also
  retires the land-grab that `bootstrap-league.mjs` exists to prevent
- `VITE_LEAGUE_NAME` goes away
- routing, because leagues need URLs - the one place Phase 3 might justify a dependency

If the answer is "one league forever", all of the above is deleted from the plan and
Phase 3 gets materially smaller.

---

### 3e - Season archive (candidate; raise now, schedule separately)

Not auth, but it is the one place where an **answered** question is only half delivered, so
it should not sit unnoticed.

OQ-2 was answered *yes, seasons should exist*, and the `seasons` table shipped. But the app
still only offers **Reset League**, and reset goes through `replaceLeague`, whose delete
pass removes every row not present in the new blob - teams, periods, rosters, stat lines,
results. `seasons` is in `NEVER_DELETE_FROM`, so the season row survives; everything that
made it interesting does not. In other words the schema can keep last year, and the app
still throws it away.

Proposal: an `archiveSeasonAndStartNew` operation - end the current season, create the next
year's, carry the teams forward, leave every history row attached to the old season.
`hydrateLeague(db, { seasonId })` already takes a season, so the read seam exists.
Destructive reset stays, renamed to what it is.

**This is the one item that touches real league data, so it does not ship mid-season.**

---

## Order, and what it costs

| | Slice | Depends on | Rough size |
|---|---|---|---|
| 1 | 3a hardening | nothing (bar two rule confirmations) | ~1 working session |
| 2 | 3b + 3c accounts | OQ-5 yes | ~2-3 sessions |
| 3 | 3d multi-league | OQ-10 yes, and 3c | ~2-3 sessions, plus an RLS rewrite |
| 4 | 3e season archive | scheduling, not a decision | ~1 session |

3a first regardless of the answers. It is the smallest slice, it is the one with an actual
security hole in it, and it makes every later slice safer to develop against.

---

## Development constraints worth stating

- **Almost all of Phase 3 lives in the tests that skip without Docker.** `rls.test.js`,
  `server.test.js` and `bootstrap.test.js` are 59 of the 190 tests, and they are precisely
  the ones covering authorization, policies and the schema. A green `npm test` with no
  local stack proves nothing about this phase. Every change here needs
  `npx supabase start` running, and the skip count checked before believing a pass.
- **Migrations stay forward-only**, and every new table ships with its RLS policies and
  grants in the same migration. Run `npm run verify:grants` after any `db push`.
- **Cutover is one-way in places.** Enforcing OQ-B server-side, rotating short join codes,
  and any session-lifecycle change will sign people out or reject requests that used to
  succeed. None of it should land mid-week without telling the league.
