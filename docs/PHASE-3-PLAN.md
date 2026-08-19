# Phase 3 - plan

Status: **scope agreed - 3a, 3b+3c and 3d are in; 3e is held for the designer.** Nothing
is built yet.

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

### 3b + 3c - Membership and real accounts (**agreed**)

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

### 3d - League ownership and multi-league (**agreed**)

Multi-league is on the roadmap, so league ownership lands *with* accounts rather than
after them. The landing page grows three doors:

1. **Sign in** - magic link or Google, then your leagues. One league, go straight in.
2. **I have an invite code** - type the code first (that is the texted-to-you flow, and it
   should not be gated behind a sign-in wall), then sign in to complete the redemption.
3. **Create a league** - sign in, name it, and you are its commissioner. From there: create
   teams, issue invite codes, share them.

What that requires:

- reads become league-scoped in RLS - today every read policy is `using (true)`, correct
  for one public league and wrong the moment there are two
- an `invites` table (below), replacing `team_secrets` as the way people get in
- league creation, with the creator inserted as commissioner - which retires the land-grab
  that `bootstrap-league.mjs` exists to prevent, and makes that script dev-only
- `VITE_LEAGUE_NAME` goes away
- routing, because leagues now need URLs - the one place Phase 3 justifies a dependency
- commissioner transfer, and more than one commissioner per league, so an account going
  away cannot strand a league

---

## The auth model after multi-league

This is the part worth being precise about, because it is a genuine inversion rather than
an addition.

### The inversion

**Today the code is the credential.** Type the team's join code, get a session, and that
session *is* the team. Identity is per-team and per-device; there is no person in the
system at all. That works exactly as long as there is one league and everyone in it is a
friend.

**Afterwards the account is the credential and the code is the invitation.** You sign in
as yourself, you redeem a code once, and that mints a membership. From then on your
account is how you get in; the code has done its job.

| | Today | After |
|---|---|---|
| Who you are | "whoever holds team 3's code" | a person, with an account, across leagues |
| How you log in | type the code, every device, forever | sign in - magic link or Google |
| What a code does | authenticates every session | authorizes one join, then is spent |
| Where the role lives | on the session row | on `league_members` |
| Rotating a code | signs that team out | affects only future joins |
| Can you be in two leagues? | no - the code *is* the identity | yes, with different roles in each |
| Codes readable back | no, and that is a real workflow cost today | moot - reissue freely, it locks nobody out |

The last three rows are the payoff. Sharing a code stops being account sharing; rotating a
code stops being a lockout; and "commissioner of one league, manager in another" becomes
expressible, which single-code auth literally cannot represent.

### What the pieces are

**Authentication: Supabase Auth.** Email magic link as the primary route - nothing to
store, no password reset flow to build, and it suits a dozen people who sign in a few
times a season. Google is one dashboard toggle on top. Sessions, refresh and revocation
all become Supabase's problem rather than the hand-rolled `sessions` table's.

**Authorization: `league_members`.** `(league_id, user_id, role, team_id)`, one row per
person per league. Commissioner is a role on that row, not a different kind of login.
Creating a league inserts your row with `role = 'commissioner'`.

**Invitation: an `invites` table**, which is what `team_secrets` becomes:

```
invites(id, league_id, team_id null, role, code_hash, created_by,
        expires_at null, max_uses null, uses, revoked_at null)
```

- still hashed - a code is shown once when issued and reissued freely afterwards, which is
  safe precisely because it no longer grants standing access
- `team_id` nullable, so the same mechanism issues "join team 3" and "help me run this
  league" invites
- multi-use by default, because the social flow is pasting one code into a group chat;
  revocable, and optionally expiring

**Redemption** is the only new flow: verify the code, require a signed-in user, insert
`league_members`, increment `uses`. Idempotent - redeeming twice is a no-op, not a second
membership.

### What this does to the existing league

Nothing, until each person chooses. `verifySession()` accepts **either** credential and
resolves both to the same `{leagueId, role, teamId}`, so:

1. 3b/3c ship, and the league carries on typing codes exactly as now.
2. Each manager, next time they log in, is offered "sign in with your email so this
   sticks". Their existing join-code session mints their `league_members` row - the
   invitation migration `docs/AUTH.md` already commits to.
3. Code-as-login is switched off only once everyone has an account, **at a season
   boundary, never mid-season**.

The commissioner code is the one piece that simply retires: you said it is really a
testing artefact, and with league creation the commissioner is whoever made the league. It
stays for local development and the demo seed, and Scott's existing league gets its
commissioner row set by a one-off script at cutover.

### Reads, and who can see a league

Scoping reads is the actual multi-league change, and it forces a question that single
league never had to ask. Today every read policy is `using (true)` - anyone with the link
sees the standings. Proposed:

```sql
using (
  league_id in (select league_id from league_members where user_id = auth.uid())
  or exists (select 1 from leagues l where l.id = league_id and l.visibility = 'public')
)
```

**Decided:** `leagues.visibility` is a per-league setting, defaulting to `'members'` for
new leagues, with the existing league set to `'public'` so nothing changes for it.

One thing to get right now rather than later. A future landing-page door - **"browse and
join a public league"** - needs a *directory*, and being listed in a directory is not the
same claim as being readable by link. A league might happily let a spouse read the
standings from a shared URL while having no interest in appearing in a public list.

So `visibility` is a **checked text column, not a boolean**:

```sql
visibility text not null default 'members'
  check (visibility in ('members', 'public'))
```

A later migration adds `'listed'` for leagues that opt into the directory, and the read
policy above needs no change - it already tests for membership or non-`members`
visibility. A boolean would have forced a column swap and a backfill to say the same
thing.

The directory itself is out of scope this phase, but it brings its own questions when it
lands: open join or commissioner approval, whether a listed league exposes team names
before you join, and how a full league is shown. Worth answering then, not now.

**Writes still go through the Netlify function.** Direct RLS-governed writes become
possible once there are real JWTs, but that is an optimization, not a correctness fix, and
it is not Phase 3's business.

### The operational dependency

Magic links need email that actually arrives. **Supabase's built-in sender is rate limited
and is not intended for production** - it will silently throttle, which is the worst
possible failure mode for a login. **Resend is being set up**, and its SMTP credentials go
into the Supabase dashboard; the sending domain needs its DNS records verified the same way
the site's did. Google sign-in has no such dependency but needs a Google Cloud OAuth client
instead, and is worth adding beside magic links rather than instead of them.

Worth noting: that same SMTP setup is exactly what OQ-6 notifications would need. Doing it
here means "rosters are dealt - submit your scheme before Sunday" is later a feature rather
than an infrastructure project.

---

### 3e - Season archive (**held for the designer** - not this phase)

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
| 2 | 3b + 3c accounts | Resend account and verified sending domain | ~2-3 sessions |
| 3 | 3d multi-league | 3c | ~3-4 sessions - it grew: invites, redemption, landing page, routing, RLS rewrite |
| - | 3e season archive | **held for the designer** | not this phase |

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
