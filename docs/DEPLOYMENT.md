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

- Site: <https://pigskinpoker.netlify.app>
- Supabase project ref: `wzzrxoslcwpyopdvvxmn`
- Repo: <https://github.com/keburke17/PigskinPoker>

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
npx supabase db push
```

This applies everything in `supabase/migrations/` and records what it applied, so next
time only new files run. It creates the tables and **no data**.

`supabase/seed.sql` is *not* run by `db push`. That file is the local demo league, and
it refuses to run against a database holding real data.

Then confirm the security posture actually landed:

```bash
npm run verify:grants
```

This matters more than it sounds - see "Hosted defaults differ from local" below.

### 3. Create the league

The database now has tables but no league, and the app will say *"No league here yet"*.
Create a blank league, choosing your commissioner code now:

```bash
PIGSKIN_COMMISSIONER_CODE=choose-a-good-code SUPABASE_URL=https://YOUR_REF.supabase.co SUPABASE_SECRET_KEY=YOUR_SECRET_KEY npm run bootstrap -- --name "Pigskin Poker"
```

**Do not put quotes around the values** unless they contain spaces. Shell quoting
leaking into the code is a real failure that has happened - see troubleshooting.

That creates one league, one season, the full 223-player pool, week 1 in `pre-deal`, and
zero teams. You add teams through the app.

The code is set here rather than claimed in the app on purpose: the original Artifact
let the first person to type a code become commissioner, which was fine behind a private
link and is a land-grab on a public URL.

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
3. **Log in** with the commissioner code. This is the real test: it exercises the
   function, the secret key, and password hashing together.
4. **Add a team.** This exercises the privileged write path.

An attacker's-eye check, using the public key from your own shipped bundle:

```bash
curl -s "https://YOUR_REF.supabase.co/rest/v1/league_secrets?select=*" -H "apikey: YOUR_PUBLISHABLE_KEY"
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
npx supabase db push && npm run verify:grants
```

**Migrations are forward-only.** Never edit one that has already been applied - add a
new one. And always run `verify:grants` afterwards; a newly created table is born with
permissive grants on hosted Supabase.

### Changing the commissioner code

Codes are stored as one-way hashes and cannot be read back, only replaced:

```bash
PIGSKIN_COMMISSIONER_CODE=the-new-code SUPABASE_URL=https://YOUR_REF.supabase.co SUPABASE_SECRET_KEY=YOUR_SECRET_KEY npm run set-code
```

This signs out existing commissioner sessions, and verifies the new code works before
reporting success.

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

The database is reachable and empty. Run the bootstrap (step 3).

### "Pigskin Poker is not configured: ... is missing"

A Netlify environment variable is missing or misspelled. The message names it. Fix it
and **redeploy** - environment variables are read at build time for `VITE_` ones.

Production deliberately refuses to start rather than falling back to the demo league.
That fallback would have deployed a site that looked completely healthy - six teams,
standings, a week in progress - but was a throwaway copy in each visitor's tab that
saved nothing.

### The login screen says "Create & Log In" instead of "Log In"

The app thinks no commissioner code is set. It cannot read `league_secrets` (correctly),
so it relies on a public `has_commissioner_code` flag on the league. If bootstrap did not
finish, that flag is false. Re-run `npm run set-code`, which sets both.

### The commissioner code will not work

Almost always shell quoting. If the code was passed as `'mycode'` with quotes, the quotes
were hashed as part of it and nothing typed at the login screen can ever match.

`npm run set-code` now strips a surrounding quote pair, warns about non-ASCII characters
(smart quotes from copy-paste are invisible in most terminals), and prints the effective
code between `>>> <<<` markers with a character count. If that count is not what you
expect, something is still mangling the value.

### Re-running bootstrap "worked" but nothing changed

`bootstrap` refuses to run against a database that already has a league, so it does not
touch the commissioner code. Use `npm run set-code` for that. The refusal message now
says so.

### Hosted defaults differ from local

A hosted Supabase project grants `ALL` on every newly created table to `anon` - the role
the public key uses. The local stack does not, so this is invisible until the first
`db push`.

Row Level Security still denied every row, so nothing was exposed - but the second layer
of defence was gone. Migration `20260818020000` revokes those grants explicitly.

**This is why `npm run verify:grants` exists and why it must be run after every
`db push`.** Unit tests cannot catch it: the environment with the problem is not the
environment the tests run in.

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

- **Login has no rate limiting.** A determined guesser gets unlimited attempts at the
  commissioner code. Password hashing makes each guess cost ~20ms, which helps but is
  not a substitute. See `docs/AUTH.md`.
- **Team join codes have no minimum length.** A commissioner can set a two-character one.
- **Anyone with the URL can read the league** - by design, matching the original, but the
  URL is now guessable rather than a private link.
