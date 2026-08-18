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
Commissioner → Invite panel used to list every team's code; it now shows only whether a
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

### What is deliberately still weak

- **`sessions` is hand-rolled.** It is small - a hashed token, a role, an expiry - and
  it is confined to this phase. It should be replaced by real Supabase sessions in Phase
  3 rather than grown. Hand-rolled auth that quietly becomes permanent is a normal way
  for a project like this to end up with a security problem.
- **No rate limiting on login.** A short shared code plus unlimited attempts is
  brute-forceable. scrypt makes each guess cost ~20ms, which is meaningful but not a
  substitute. Worth adding a per-IP limit in the function before this is on a public
  domain with a real league on it.
- **Sessions never rotate.** A 30-day token is not revoked if a device is lost. The
  commissioner changing the team's join code does not invalidate existing sessions -
  it should, and that is a one-line delete in `setTeamJoinCode`.

Those three are the honest gaps. None of them are worse than the Artifact's position
(where the codes were simply public), but none should survive Phase 3.
