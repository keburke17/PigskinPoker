# Deployment

How Pigskin Poker gets from this repo onto the internet, written for someone who has
never deployed a site before. Every step below has actually been run, and the
troubleshooting section lists the things that really went wrong rather than a guess at
what might.

---

## What the live setup is

Three services, each doing one job:

| Service | Holds | Costs |
|---|---|---|
| **GitHub** | The code | Free |
| **Netlify** | The website, plus one server-side function | Free tier |
| **Supabase** | The database | Free tier |

Netlify watches GitHub. Push to `main` and it rebuilds and republishes automatically.
Supabase is separate - **pushing code never changes the database**, and that is
deliberate.

Current deployment:

- Site: <https://pigskin.ballsohard.org>
- Supabase project ref: `wzzrxoslcwpyopdvvxmn`
- Repo: <https://github.com/keburke17/PigskinPoker>

The domain moved from `pigskinpoker.netlify.app` on 2026-08-20. Two things about it are
worth knowing before touching DNS:

- **`ballsohard.org` is served by Cloudflare** (`sunny`/`gabriel.ns.cloudflare.com`),
  whatever any registrar panel shows you. `dig +short NS ballsohard.org @8.8.8.8` is the
  only authority on that. The site is a CNAME on `pigskin` pointing at
  `pigskinpoker.netlify.app`, and it must stay **DNS only (grey cloud)**: proxied,
  Cloudflare terminates TLS itself, Netlify's certificate challenge never completes, and
  a "Flexible" SSL mode adds a redirect loop that reads as an application bug.
- **`pigskinpoker.netlify.app` still serves the app** - 200, not a redirect. Both origins
  are live and both are in the auth allow-list, so nothing is broken, but sessions live
  in `localStorage` and are per-origin: somebody arriving by an old bookmark is signed in
  there, separately, and is never told the address changed. `docs/EMAIL-SETUP.md` section
  3 has the host-scoped redirect that would close it.

---

## The one thing to understand first

**The browser and the server use different keys, and mixing them up is the one mistake
that matters.**

- The **publishable key** ships inside the JavaScript every visitor downloads. It is
  public on purpose. Row Level Security is what makes that safe: with it, a visitor can
  read what the league is meant to see and write *nothing*, anywhere.
- The **secret key** bypasses Row Level Security completely. It lives only in Netlify's
  environment variables, is read only by the server-side function, and must never reach
  a browser.

Vite (the build tool) will copy any environment variable starting with `VITE_` into the
browser bundle. That is why the secret key is named `SUPABASE_SECRET_KEY` with **no**
prefix. Renaming it to `VITE_SUPABASE_SECRET_KEY` would silently publish full
read/write access to your database to every visitor, and the app would keep working
perfectly, so nothing would look wrong.

`tests/bundle.test.js` fails the build if any secret reaches the client.

---

## First-time setup

### 1. Supabase project

Create one at <https://supabase.com/dashboard>. Note the **project ref** - the random
string in the project URL, e.g. `wzzrxoslcwpyopdvvxmn`.

Connect this repo to it:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

Linking writes `supabase/.temp/project-ref`, which is git-ignored - so linking is
per-machine and never travels through GitHub.

### 2. Create the tables

```bash
npm run db:push
```

**Use `npm run db:push`, not `npx supabase db push`.** It runs the push and then
`verify:grants`, because the check afterwards is not optional and must not depend on
anyone remembering it - see "Hosted defaults differ from local" below. If it reports a
problem, the push still happened; fix it with a follow-up migration.

This applies everything in `supabase/migrations/` and records what it applied, so next
time only new files run. It creates the tables and **no data**.

`supabase/seed.sql` is *not* run by `db push`. That file is the local demo league, and
it refuses to run against a database holding real data.

### 2b. Email - REQUIRED, it is the only way anybody signs in

Magic-link sign-in needs SMTP configured on the hosted project, and it is a dashboard
job rather than a migration. **`docs/EMAIL-SETUP.md` has the steps.**

This is not optional, and it is not a feature that degrades gracefully: without working
email **nobody can get in at all**, including you. The built-in sender throttles silently
rather than erroring, which fails in the way nobody notices until someone is locked out.

Do it before step 3 - you cannot create a league without signing in first. Then prove it
rather than assuming:

```bash
npm run verify:email -- you@your-address.com
```

### 3. Create the league - in the app, not from a script

The database now has tables but no leagues. **There is no bootstrap step any more.**

Open the deployed site, sign in with your email, and press **Create A League**. Whoever
creates it is its commissioner, and everybody else joins through
**Commissioner -> Invite**.

There used to be a `npm run bootstrap` script here, which created the league and set a
commissioner code before anyone could claim it. That existed to close a land-grab: the
Artifact let the first person to type a code become commissioner, which is fine behind a
private link and a free-for-all on a public URL. With league creation tied to an account
there is no window to close - the creator is the owner, and an account nobody invited is
nobody in anyone else's league.

### 4. Netlify

New site -> import from GitHub -> pick the repo. **Take the build settings as offered**;
they come from `netlify.toml`:

| Setting | Value |
|---|---|
| Branch | `main` |
| Base directory | *(empty)* |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |

Node 22 is pinned in `netlify.toml`, so it does not need to be set here.

Then add four environment variables (Site configuration -> Environment variables):

| Variable | Value | In the browser? |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://YOUR_REF.supabase.co` | Yes - fine |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | Yes - fine |
| `SUPABASE_URL` | the same URL again | No |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | **No - never add `VITE_`** |

Both keys are in the Supabase dashboard under **Settings -> API Keys**.

`VITE_LEAGUE_NAME` is optional and usually best left unset. With one league the app
finds it automatically; setting it creates a string that has to match exactly.

Deploy. The build works even with no environment variables set, so a first build that
runs before you have saved them will not fail - the site would just refuse to start at
runtime until they are there.

---

## Verifying a deploy

In this order, because each failure looks different:

1. **The build log.** The likeliest failure is the function, which imports from
   `../../server` and `../../src` - outside its own directory.
2. **Load the site.**
   - Login screen -> working.
   - *"No league here yet"* -> the database is fine, step 3 was not run.
   - *"...is not configured"* -> an environment variable is missing; the message names it.
3. **Sign in** with your email and open the link. This is the real test: it exercises
   the mail provider, Supabase Auth, the function and the secret key together.
4. **Add a team.** This exercises the privileged write path.

An attacker's-eye check, using the public key from your own shipped bundle:

```bash
curl -s "https://YOUR_REF.supabase.co/rest/v1/invites?select=*" -H "apikey: YOUR_PUBLISHABLE_KEY"
```

That must return a `42501` permission error. If it returns data, stop and fix it before
anyone uses the site.

---

## Routine operations

### Changing the code (frontend or function)

```bash
git push origin main
```

Netlify rebuilds automatically. Nothing happens to the database.

### Changing the database schema

Write a new migration in `supabase/migrations/`, test it locally, then:

```bash
npx supabase db reset && npm test
```

```bash
npm run db:push
```

**Migrations are forward-only.** Never edit one that has already been applied - add a
new one. `db:push` runs `verify:grants` for you, because a newly created table is born
with permissive grants on hosted Supabase and that is not a thing to leave to memory.

**If your migration adds a table that must be unreachable from a browser**, add its name
to `SECRETS` in `scripts/verify-grants.mjs` in the same change. The verifier only checks
the tables it is told about, so a new secret table it does not know about passes
silently - which is the one case where a green check would be actively misleading.

### Changing who the commissioner is

There is no commissioner code to change. Commissioner is a `league_members` row:
**Commissioner -> Members** promotes a second one, and demotes the first. Transfer is
promote-then-demote, and the server refuses to remove the last commissioner - a league
without one could not deal a week, add a team, or issue an invite, and no screen in the
app could repair it.

### Rolling back

- **The site:** Netlify -> Deploys -> pick a previous deploy -> "Publish deploy".
  Instant, no rebuild.
- **The database:** there is no undo. Restore from Supabase's backups
  (Database -> Backups), which is why schema changes get tested locally first.

Rolling the site back does **not** roll the database back. If a deploy included a
migration, rolling back the site leaves the new schema in place - usually fine, since
the schema only ever adds things.

---

## Troubleshooting

These all actually happened.

### "No league here yet"

The database is reachable and empty. Sign in and press **Create A League** (step 3).

### "Pigskin Poker is not configured: ... is missing"

A Netlify environment variable is missing or misspelled. The message names it. Fix it
and **redeploy** - environment variables are read at build time for `VITE_` ones.

The app deliberately refuses to start unconfigured, in every build. There used to be an
in-memory demo league to fall back on, which would have deployed a site that looked
completely healthy - six teams, standings, a week in progress - but was a throwaway copy
in each visitor's tab that saved nothing.

### Nobody can sign in, and no email arrives

Email IS the login now, so this is a total outage rather than an inconvenience. Work
through `docs/EMAIL-SETUP.md`, then prove it:

```bash
npm run verify:email -- you@your-address.com
```

That names the two failures that are otherwise silent - a 429 from the built-in sender's
throttle, and a rejected redirect URL.

### Someone signed in but sees "no leagues"

Signing in proves who they are; it does not make them a member of anything. They need an
invite from **Commissioner -> Invite**. An account nobody invited being nobody is the
behaviour, not a bug.

### Hosted defaults differ from local

A hosted Supabase project grants `ALL` on every newly created table to `anon` - the role
the public key uses. The local stack does not, so this is invisible until the first
`db push`.

Row Level Security still denied every row, so nothing was exposed - but the second layer
of defence was gone. Migration `20260818020000` revokes those grants explicitly.

**This is why `npm run verify:grants` exists, and why `npm run db:push` runs it for
you.** Unit tests cannot catch it: the environment with the problem is not the
environment the tests run in. Pushing with `npx supabase db push` directly skips the
only check that would notice - which is exactly how it got missed the first time.

---

## Free tier notes

- **Projects pause after about a week of inactivity.** Invisible during the season,
  relevant in March. Resuming is one click in the dashboard. The first person back gets
  an error rather than a spinner, so do not panic - no data is lost.
- Netlify free tier is generous for a dozen people. Function cold starts add roughly a
  second to the first request after a quiet period, which is why the app updates the
  screen optimistically and saves in the background.

---

## Not safe yet

Read before running a league you care about on a public URL:

- **Sign-in rate limiting is Supabase's**, not ours. `[auth.rate_limit]` in
  `supabase/config.toml` documents the local values; the hosted project's live in the
  dashboard. Our own login endpoint and its throttle were retired with join codes.
- **Anyone with the URL can read the league** - by design, matching the original, but the
  URL is now guessable rather than a private link.
