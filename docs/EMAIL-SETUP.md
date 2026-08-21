# Email setup - making magic links actually arrive

Everything in this document is done in a **dashboard**, not in this repo. It is the one
part of Phase 3c that code cannot do for you, and until it is done, **email sign-in does
not work in production**. Join codes are unaffected and keep working throughout - which
is exactly why the accounts layer was built alongside them rather than instead of them.

Local development needs none of this. The local stack captures every message at
<http://127.0.0.1:54324> and never sends anything.

**Done once already, on 2026-08-19**, for the current deployment: sending domain
verified at Resend, SMTP configured, **both** email templates branded, and real mail
received on the signup path and the sign-in path. Keep this document
as the runbook - it has to be repeated for any new Supabase project or sending domain,
and the DNS half is the part that bites (see the note on nameservers in step 1).

---

## Why not just use Supabase's built-in sender

Because it is rate limited and explicitly not intended for production, and **it fails
silently**. It does not return an error you would notice; it simply stops delivering. The
symptom is a manager mentioning days later that they never got the email, with nothing in
any log to look at.

For a login, that is the worst possible failure mode - the person cannot get in and
cannot tell you why. So this is worth the twenty minutes.

Worth knowing: this same setup is what OQ-6 notifications would need. Doing it now makes
"rosters are dealt - submit your scheme before Sunday" a feature later rather than an
infrastructure project.

---

## What you need first: a domain, but NOT email hosting

This trips people up, so it is worth being exact.

**Sending and receiving are separate things.** You need a domain you control. You do
**not** need a mailbox, an email host, Google Workspace, or any monthly email fee.

| | Needs | You need it? |
|---|---|---|
| **Receiving** mail at `you@yourdomain` | MX records pointing at a mail host | **No** |
| **Sending** through Resend | SPF and DKIM records proving you own the domain | **Yes** |

So a domain that is parked, or just serving a website, is fine exactly as it is. Adding
Resend does not give the domain a mailbox and does not stop you setting one up later.

**The site's own address will not work.** `pigskinpoker.netlify.app` is a subdomain of
`netlify.app`, and verification means adding DNS records - which you cannot do to
someone else's domain. Use a domain you actually own.

### Use a subdomain for sending

Point Resend at `mail.yourdomain.com` (or `send.`), not the root. It costs nothing extra
and buys three things:

- the root domain's DNS stays clean, and free for real email later;
- sending reputation is isolated from the root domain;
- **no SPF collision.** A domain may only have ONE SPF record. If you ever add Google
  Workspace to the root, a sending SPF already sitting there has to be merged by hand -
  and a broken SPF record is a deliverability problem that is genuinely unpleasant to
  diagnose.

### About the MX record Resend asks for

Resend will ask you to add an **MX record on the sending subdomain**. That is not a
mailbox - it is where bounces and complaints are returned. It applies only to the
subdomain, so it does not touch the root domain or interfere with any email you set up
there later.

### Which domain to pick

Whichever one a recipient would recognise. A sign-in link from `noreply@` a domain that
looks nothing like the league is the kind of thing people delete or report. If one of
yours suits the league, use that - and consider pointing the site at it too, so the URL
and the email agree.

### The "from" address

An invented address at that domain: `noreply@mail.yourdomain.com`. **There is no inbox
behind it and no account to create.** It is a sending identity.

Replies to it will bounce, which is normal for sign-in mail. If you would rather they
did not, most registrars offer free forwarding to a real address.

And you cannot send from a personal Gmail even if you wanted to: Resend can only
authenticate domains you verify, and Gmail's own DMARC policy would have the message
rejected outright.

---

## 1. Resend, and the sending domain

1. Create a Resend account and add your sending subdomain (`mail.yourdomain.com`).
2. Resend shows you the exact DNS records to add - DKIM, SPF, and an MX for bounces. Add
   them wherever that domain's DNS lives. Copy them from Resend rather than from any
   guide, including this one: they differ by region and they do change.

   **Find out where the DNS actually lives first - the registrar is often not the
   answer.** A domain can be registered in one place and served from another, and the
   registrar will still show you a DNS panel that accepts records and does nothing with
   them. Ask the internet rather than a dashboard:

   ```
   dig +short NS yourdomain.com @8.8.8.8
   ```

   Whatever that prints is the only place records take effect. This exact trap cost an
   hour on 2026-08-19: correct values, entered at the registrar, while the nameservers
   pointed elsewhere. Resend reported `Failed` and gave no hint as to why.

   Verify the records resolve before asking Resend to check them:

   ```
   dig +short TXT resend._domainkey.mail.yourdomain.com
   dig +short TXT send.mail.yourdomain.com
   dig +short MX  send.mail.yourdomain.com
   ```

   Three empty answers means Resend will fail too, and the problem is not propagation.
3. Wait for Resend to show the domain **verified**. Minutes to hours - it is DNS, so it
   is not instant.
4. Create an **API key** (Resend -> API Keys -> Add). Give it **Sending access**, not
   full access: it only ever needs to send. Full access would also let that key manage
   your domains and other keys, which is not something to hand to a config field.

   Resend has no separate "SMTP credential" - **the API key is the SMTP password.**
   Copy it now; Resend shows it once and cannot show it again.

**Do not skip verification.** Unverified mail gets filed as spam, which looks exactly
like it was never sent.

---

## 2. Supabase dashboard - SMTP

Authentication -> Emails -> SMTP Settings. Enable custom SMTP and enter:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `587` |
| Username | `resend` - literally that word, not your address |
| Password | your Resend API key - the whole `re_...` string |
| Sender email | an address at your **verified** domain |
| Sender name | `Pigskin Poker` |

Raise the email rate limit while you are there (Authentication -> Rate Limits). The
default is tuned for the built-in sender and is far lower than Resend needs.

---

## 3. Supabase dashboard - URL configuration

Authentication -> URL Configuration. Two settings. They fail differently, and only one
of them announces itself.

### Site URL

The single canonical address people actually use. For this deployment, as of 2026-08-20:

- **Site URL**: `https://pigskin.ballsohard.org` - `https`, no trailing slash.

Three things consult it. Nothing else does:

1. **Where a REJECTED redirect lands.** An address that is not on the allow-list below is
   refused and the person is sent here instead. Note what that means for a real link: the
   token is still spent and they are still signed in - they just arrive somewhere they
   did not ask to be. It is not a link that fails, it is a link that succeeds somewhere
   useless, which is far harder to report and far harder to diagnose.
2. **The default for a link carrying no `redirect_to` at all.** The app never sends one -
   `signInWithEmail` always passes `location.href` - but `npm run verify:email` does,
   unless you set `VERIFY_EMAIL_REDIRECT`.
3. **It is implicitly an allowed redirect target**, with paths, without appearing in the
   list. So it must always be an address you control.

It does **not** affect the branded email. Supabase's stock templates use `{{ .SiteURL }}`;
ours uses only `{{ .ConfirmationURL }}`, and `tests/config.test.js` asserts it stays that
way.

**This is the setting that gets forgotten.** Supabase ships it as `http://localhost:3000`,
and because it is consulted only when a redirect is rejected, a project with a correct
allow-list looks entirely healthy while carrying a fallback pointing at a dead port on
somebody else's laptop. That was true here from the day auth went live (2026-08-19) until
2026-08-20, and nothing anywhere said so. It was caught only because a different sign-in
bug sent someone looking; on a longer-lived project it would sit there indefinitely.

### Redirect URLs

The allow-list. An address that is not on it is rejected outright, and the failure looks
like a broken link rather than a misconfiguration - so be generous.

- `https://pigskin.ballsohard.org/**`
- `https://pigskinpoker.netlify.app/**` - kept on purpose; see the domain move below

**The wildcard is not optional.** A sign-in link returns people to the page they left, and
the one that matters is `/join/<code>`: without path matching, someone part-way through
redeeming an invite is dropped at the front door and has to go and find the text message
again. Registering only the bare origin makes every such link fail.

Two things worth knowing before trying to tighten this:

- **`https://your-site` with no trailing slash does not match `https://your-site/**`.**
  Browsers normalise `location.href`, so the app never hits it and a hand-made link can.
  Adding the bare origin as a second entry costs nothing.
- **`http://localhost` and `http://127.0.0.1` are allowed on ANY port, always.** That is
  built into GoTrue, it is not your allow-list, and no dashboard setting turns it off.
  (`https://localhost` and `http://anything.localhost` are correctly refused.) Do not
  spend an evening trying to close it.

**Netlify deploy previews are deliberately NOT on this list**, and the question is not
really about the allow-list. Preview builds inherit production environment variables, so
a preview already points at the live Supabase project; today it can only read, because
the origin can hold no session. Allow-listing `deploy-preview-*--<site>.netlify.app`
would let any preview build act as a signed-in member of the real league, with whatever
code is on that branch. There is nothing it would buy: local development *is* the real
stack, magic links included (captured at <http://127.0.0.1:54324>), so every auth flow a
preview could exercise is already testable. Previews are for looking at the UI, and
looking at the UI does not need a session. A second Supabase project for previews would
isolate this properly and doubles every dashboard-only setting on this page - the exact
class of failure the rest of it is about. Decided 2026-08-20; revisit only for a
contributor who cannot run the stack locally.

`supabase/config.toml` configures only the LOCAL stack. It does not reach the hosted
project.

### Check both, without sending anything

```bash
npm run verify:redirects -- https://pigskin.ballsohard.org
```

It asks the auth server to verify a token that was never valid and reads where the
rejection is sent, which is the same decision it makes for a real link - so the answer is
real, and no email is spent finding it out.

**It checks whichever project `.env.local` names - which is the LOCAL stack whenever you
have run `npm run dev`.** Pointed at a hosted site it would otherwise probe 127.0.0.1 and
print a report that reads exactly like a production report: the local stack's own
`site_url` reported as WRONG, a correct hosted allow-list reported as missing, every line
of it true about the wrong project. The script now refuses that combination instead of
answering it. To aim it at the hosted project:

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co npm run verify:redirects -- https://pigskin.ballsohard.org
```

### Moving to a new domain

Done on 2026-08-20, from `pigskinpoker.netlify.app` to `pigskin.ballsohard.org`. The
order matters more than the values do.

1. **Set Site URL to the address that works TODAY**, before anything else. For the rest of
   the move, every mistake below produces exactly one symptom - the person lands on the
   Site URL - so it needs to be a working front door first. Pointing it at the new domain
   at this stage would aim the fallback at a hostname that does not resolve yet, which is
   the problem being fixed rather than the fix.
2. **Add the new domain's `/**` to Redirect URLs, before touching DNS.** An entry for a
   hostname that does not resolve is an inert string. There is no risk in it being early,
   and it removes any window where the domain is live but sign-in is not.
3. **Add the DNS record.** For a subdomain, a CNAME to `<site>.netlify.app`. If DNS is at
   Cloudflare it must be **DNS only (grey cloud)**: proxied, Cloudflare terminates TLS
   itself, Netlify's certificate challenge never completes, and a "Flexible" SSL mode adds
   a redirect loop that reads as an application bug.
4. **Add it in Netlify as a domain alias.** External DNS plus an alias - do not hand the
   zone over to Netlify.
5. **Wait for the certificate.** Netlify shows it. Going further first sends people to a
   TLS warning.
6. **Make it the primary domain** - then check what the old address actually does.
   Setting a primary domain did NOT redirect `pigskinpoker.netlify.app` here; it still
   answers 200, so two origins serve the same app against the same project. Nothing
   breaks - both are allow-listed - but `localStorage` is per-origin, so anyone arriving
   by an old bookmark holds a separate session and is never told the address moved. If
   Netlify will not do it, one host-scoped rule in `netlify.toml` will, placed **above**
   the SPA catch-all (`from = "/*"` matches every host and would win otherwise):

   ```toml
   [[redirects]]
     from = "https://pigskinpoker.netlify.app/*"
     to = "https://pigskin.ballsohard.org/:splat"
     status = 301
     force = true
   ```

   In-flight magic links survive it: the token is in the URL fragment, which never
   reaches Netlify at all - the browser reattaches it to the redirect target.
7. **Verify** with the hosted form of the command above, against the new domain. Site URL
   will still report WRONG - that is step 8, not a mistake.
8. **Now move Site URL to the new domain.** Verify again; expect four OKs.

**Keep the old domain in the allow-list for a season.** A magic link already sitting in
someone's inbox carries the old address inside it, and that address is checked at the auth
server before any browser redirect happens. Adding is not replacing. Tidying up early is
the one way to break somebody mid-flight.

**Tell the league first: everyone gets signed out, once.** The Supabase session lives in
`localStorage`, which is per-origin, so a manager signed in at the old address is simply
not signed in at the new one. No dashboard mentions this and no test can catch it - and
unannounced, "the site moved and now it wants your email again" is precisely what a
phishing message looks like.

Finally, check the sending domain still agrees with the site. Here it already did: mail
comes from `mail.ballsohard.org` (section 1), so the move made the URL and the
from-address match rather than pulling them apart. If yours would not, that is a separate
change with its own DNS wait - do not do both in one sitting.

---

## 4. Supabase dashboard - the email template

The branded sign-in email lives at `supabase/templates/magic_link.html`, and the hosted
project **does not read it from the repo**.

Authentication -> Emails. **Paste it into BOTH of these templates:**

| Template | Who gets it |
|---|---|
| **Magic Link** | someone whose address is already a user - signing in again |
| **Confirm signup** | someone whose address is NEW - every first-time member |

For each, set:

- **Subject**: `Sign in to Pigskin Poker`
- **Body**: paste the contents of `supabase/templates/magic_link.html`

The same file serves both. It uses only `{{ .ConfirmationURL }}`, which both templates
provide, and in a passwordless app confirming a signup is signing in.

**Doing only Magic Link is the easy mistake, and it fails in the worst direction.**
GoTrue picks the template by whether the address already exists, so the people who get
the unbranded default are precisely the first-timers - the ones with no reason yet to
trust an email from you. Everyone testing with their own already-registered address sees
the branded one and concludes it is fine.

It also makes testing lie to you. `npm run verify:email` sends `create_user: true`, so a
**fresh** address takes the signup path and receives Confirm signup. If the branded
template does not appear, check which of the two you configured before assuming the paste
did not save. To test Magic Link specifically, send twice to the same address: the second
send takes the sign-in path.

If you skip both, sign-in still works - the email is just Supabase's generic default,
which is the kind of message people ignore or report as phishing.

Keep them in step. If you edit the template in the repo, paste it again in both places.

---

## 5. Prove it works

```bash
npm run verify:email -- you@your-address.com
```

Sends **one real email** to the address you name and reports what the auth server said.
It refuses to run without an address, so it cannot go off by accident.

It tells you specifically about the two failures worth naming:

- **HTTP 429** - rate limited. If you have not configured Resend, this is the built-in
  sender throttling, and real sign-ins are already failing silently.
- **Redirect rejected** - the address is not in the allow-list from step 3.

For where links LAND rather than whether mail sends, use `npm run verify:redirects`
from step 3. It costs nothing, so it can be run against production any time.

Then **go and look in the inbox**. The script can only prove the request was accepted, not
that mail was delivered. If nothing arrives in a minute or two, check Resend's logs for a
bounce, confirm DNS is verified, and check spam.

---

## Afterwards

Magic links work in production - which, since 2026-08-20, is the ONLY way anybody signs
in. Join codes, the `sessions` table and our own login rate limiter are gone.

That raises the stakes on this page: **if email is broken, nobody can get in at all**,
including you. It is not a feature that degrades gracefully any more, so run
`npm run verify:email` after any change to the sender, the domain or the redirect
allow-list, and `npm run verify:redirects` after any change to URL Configuration.

- new members join with an invitation (Commissioner -> Invite), not a code;
- signing in proves who someone is, and nothing else - an account nobody invited is
  correctly nobody in your league.

`docs/AUTH.md` covers how this replaced codes, and what onboarding a real code-holding
league would have needed instead.
