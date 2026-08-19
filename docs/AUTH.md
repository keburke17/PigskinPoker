# Authentication and Authorization

How logging in works, why it changed, and the path from join codes to real accounts.

**Short version:** the login *experience* is exactly what your league already knows -
type a code. What changed is that the code is no longer in the browser to compare
against.

---

## What was wrong (P2)

In the Artifact, `commissionerCode` and every team's `joinCode` were stored **inside the
league blob** and compared in the browser (legacy lines 2225-2247). That means:

- every visitor's browser downloaded **all** the codes;
- `isCommissioner` (line 2464) only decided what UI rendered;
- nothing stopped a client writing any state it liked.

Among friends on a private Artifact link that was a reasonable call. On a public domain
it isn't.

## What it is now

| | Before | Now |
|---|---|---|
| Where codes live | in the league blob, downloaded by everyone | hashed, in `league_secrets` / `team_secrets` |
| Who can read them | anyone who opened the app | nobody - no RLS policy, no grant, not even via the publishable key |
| Where they're checked | in the browser | in a Netlify Function holding the secret key |
| What a login returns | a boolean in React state | an opaque session token |
| What enforces the rules | UI conditionals | server-side checks on every privileged write |

### The flow

1. Someone types a code. The client POSTs it to `/api` (`loginCommissioner` or
   `loginManager`). The code is sent once, over HTTPS, and never stored client-side.
2. The function verifies it with **scrypt** against the stored hash
   (`server/auth.js`).
3. On success it creates a row in `sessions` and returns a 32-byte random token. Only
   `sha256(token)` is stored - the token itself exists solely in that browser.
4. The client keeps the token in `localStorage` and sends it as
   `Authorization: Bearer <token>` on every write.
5. Every privileged operation re-verifies the session and re-checks the role.

### What the browser can still see

Only `has_commissioner_code` and `teams.has_join_code` - booleans saying whether a code
*exists*. The login screen needs that to choose between "enter your code" and "create
the commissioner login", and the team picker needs it to show which teams are joinable.
"This league has a commissioner" is a public fact; the code is not.

### Authorization rules, now actually enforced

| Action | Who |
|---|---|
| Deal, process schemes, enter stats, lock rosters, finalize, start playoffs | commissioner only |
| Edit a lineup, submit a scheme | that team's manager (or the commissioner) |
| Everything else (read) | anyone with the link |

Asserted in `tests/server.test.js`: a manager cannot enter stats, cannot finalize, and
cannot touch another team's lineup - each returns 403 from the server, not a hidden
button.

---

## The consequence you should know about

**Join codes can no longer be read back.** They are hashed, and hashing is one-way. The
Commissioner -> Invite panel used to list every team's code; it now shows only whether a
code is set.

If someone loses their code, the commissioner sets a **new** one for that team and sends
it. That is the direct cost of taking codes out of every visitor's browser, and it is
the right trade - but it is a real workflow change, so it is called out in the UI rather
than left to be discovered.

---

## Why this landed in Phase 2 rather than Phase 3

Phase 2 needed manager writes authorized *somewhere*. The options were to trust the
client until Phase 3, or to bring the session mechanism forward. Shipping a
half-enforced write path and then hardening it later tends to mean the hardening never
quite happens, and in the meantime the app is on a public domain. So auth was done once,
properly.

---

## The path to real accounts

The schema was built so this is **additive**, not a migration.

### Already in place

- `auth.users` is Supabase's, and is **not** shadowed by a `users` table of our own -
  that is the mistake that makes real accounts a data migration later.
- Roles are a column on the session, not an inference from which code was typed.
- Every authorization decision goes through `isCommissioner()` / `canActForTeam()` in
  `server/auth.js`. Two functions, one file.

### What adding email or Google sign-in involves

1. **Turn the provider on** in the Supabase dashboard. No schema change.
2. **Add `profiles`**, keyed to `auth.users(id)`, for display name and anything else of
   ours. Never add columns to `auth.users`.
3. **Add `league_members`** - `(league_id, user_id, role, team_id)`. This is the table
   the current `sessions` row is standing in for.
4. **Accept either credential** in `verifySession()`: a Supabase JWT *or* a join-code
   session. Both resolve to the same `{leagueId, role, teamId}` shape, so nothing
   downstream changes.
5. **Migrate existing members** by invitation, not by force: a manager who is already
   holding a join code signs in with email, and the first time they do, their
   `league_members` row is created from the session they already had. Nobody is locked
   out mid-season, and the join code keeps working until they choose otherwise.

### What becomes possible afterwards

- **RLS-scoped direct writes.** Right now every write goes through the function because
  in Phase 2 there is no JWT for a policy to scope *by* - the publishable key is
  anonymous and identical for everyone. With real sessions, manager lineup and scheme
  edits could become direct writes governed by a policy like
  `team_id = (select team_id from league_members where user_id = auth.uid())`. That is
  an optimization, not a correctness fix - the function path stays correct either way.
- **Notifications.** "Rosters are dealt - submit your scheme before Sunday" needs an
  email address, which is the one thing join codes cannot give you. See OQ-6.

### What Phase 3a closed

Phase 2c shipped real authorization and left four gaps open on purpose. Phase 3a shuts
them. Each is asserted in `tests/server.test.js`, which **skips silently without a local
Supabase stack** - check the skip count before believing a pass.

- **Rate limiting on login** - `server/throttle.js`, backed by the `auth_throttle`
  table. Two buckets per attempt, and they are deliberately different controls: the
  **per-IP** bucket is a real lockout with exponential backoff (a minute, doubling,
  capped at an hour), while the **per-target** bucket (league or team) is a fixed
  few-second slowdown that never escalates. An escalating per-target lock would let
  anyone lock the real commissioner out of his own league by hammering the login - a
  denial of service an attacker would choose on purpose, and worse than a slow brute
  force. Ten failures are free; the eleventh attempt is refused with a 429 and a
  `Retry-After`. A successful login clears its buckets. The IP is hashed with a
  server-side pepper before storage, so the table is a counter and not a visitor log.

  **It fails open.** If the throttle table itself errors, login proceeds. A broken
  counter must not become an outage that locks the league out on a Sunday.

- **Rotating a team's join code now signs that team out.** `setTeamJoinCode` deletes
  that team's sessions, matching what commissioner code rotation already did. Without
  it the rotation was cosmetic: the person being removed kept a 30-day token.

- **Join code policy** - minimum 8 characters (matching `PIGSKIN_COMMISSIONER_CODE`),
  maximum 64, printable ASCII. Enforced **on set, never on verify**, so no existing code
  stops working: hashes are one-way, so there is no query that finds which live codes
  are short, and enforcing at login would sign those people out mid-season with no way
  to warn them first. The rule lives in `src/storage/codePolicy.js` because the browser
  and the server must not disagree about it. The UI states it inline rather than only
  enforcing it.

- **Session idle expiry** - 14 days, alongside the unchanged absolute 30-day cap, with
  `last_used_at` refreshed on use (coarsely, at most hourly, to avoid a write per
  request). An active manager is never signed out mid-season; an abandoned token dies
  well before the cap. A commissioner "sign out devices" action per team covers the lost
  phone, where the code is fine and only the live sessions are the problem.

### What is still deliberately weak

- **`sessions` is hand-rolled.** It is small - a hashed token, a role, an expiry, a last
  use - and it is confined to this phase. Phase 3b/3c replaces it with Supabase Auth
  rather than growing it. The idle expiry above is maintenance on a mechanism that is
  meant to be retired, not investment in it. Hand-rolled auth that quietly becomes
  permanent is a normal way for a project like this to end up with a security problem.

- **Short codes already in the database still work**, by design - see the on-set/on-verify
  note above. **Rotating them once is an operational step at cutover**, not something the
  code can do for you.

Neither is worse than the Artifact's position, where the codes were simply public, and
both are resolved by the accounts layer rather than by patching this one further.

---

## Operational notes

### Codes cannot be read back, only replaced

Hashing is one-way, so there is no "show me the code" anywhere, by design. That leaves
one real workflow gap: a forgotten or mistyped commissioner code would otherwise mean
hand-editing the database.

```bash
PIGSKIN_COMMISSIONER_CODE=the-new-code npm run set-code
```

It also **deletes existing commissioner sessions**. A code change usually means "someone
should no longer have this", and a 30-day token surviving the rotation would defeat the
point. It verifies the new code against the stored hash before reporting success - "the
write succeeded" and "this code will log you in" are not the same claim, and only the
second one is useful.

### Shell quoting is the most common way to lock yourself out

A code passed as `'mycode'` with the quotes intact hashes the quotes as part of it, and
then nothing typed at the login screen can ever match. Smart quotes from copy-paste are
worse because they are invisible in most terminals.

Both `bootstrap` and `set-code` now strip a matching surrounding quote pair, warn about
non-ASCII characters, and print the effective code between `>>> <<<` markers with a
character count. If that count is not what you expect, something is still mangling it.

### How the login screen knows a code exists

The browser cannot read `league_secrets` - that is the whole point of it. But the login
screen still has to choose between "enter your code" and "create the commissioner
login", and the team picker has to show which teams are joinable.

Two public boolean columns carry exactly that and nothing more:
`leagues.has_commissioner_code` and `teams.has_join_code`. Whether a code *exists* is a
public fact; the code is not. They are maintained server-side alongside the hash they
describe - if they drift, the login screen offers to create a commissioner for a league
that already has one.
