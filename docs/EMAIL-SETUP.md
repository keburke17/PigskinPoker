# Email setup - making magic links actually arrive

Everything in this document is done in a **dashboard**, not in this repo. It is the one
part of Phase 3c that code cannot do for you, and until it is done, **email sign-in does
not work in production**. Join codes are unaffected and keep working throughout - which
is exactly why the accounts layer was built alongside them rather than instead of them.

Local development needs none of this. The local stack captures every message at
<http://127.0.0.1:54324> and never sends anything.

**Done once already, on 2026-08-19**, for the current deployment: sending domain
verified at Resend, SMTP configured, and a real magic link received. Keep this document
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

Authentication -> URL Configuration.

- **Site URL**: `https://pigskinpoker.netlify.app`
- **Redirect URLs**: `https://pigskinpoker.netlify.app/**` - **with the wildcard**, plus
  any Netlify deploy-preview domains you want to be able to sign in on.

**The wildcard is not optional.** A sign-in link returns people to the page they left,
and the one that matters is `/join/<code>`: without path matching, someone part-way
through redeeming an invite is dropped at the front door and has to go and find the text
message again. Registering only the bare origin makes every such link fail.

An address that is not on this list is **rejected outright**, and the failure looks like a
broken link rather than a misconfiguration - so it is worth being generous here.

`supabase/config.toml` configures only the LOCAL stack. It does not reach the hosted
project.

---

## 4. Supabase dashboard - the email template

The branded sign-in email lives at `supabase/templates/magic_link.html`, and the hosted
project **does not read it from the repo**.

Authentication -> Emails -> Magic Link. Set:

- **Subject**: `Sign in to Pigskin Poker`
- **Body**: paste the contents of `supabase/templates/magic_link.html`

If you skip this, sign-in still works - the email is just Supabase's generic default,
which is the kind of message people ignore or report as phishing.

Keep the two in step. If you edit the template in the repo, paste it again.

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

Then **go and look in the inbox**. The script can only prove the request was accepted, not
that mail was delivered. If nothing arrives in a minute or two, check Resend's logs for a
bounce, confirm DNS is verified, and check spam.

---

## Afterwards

Magic links work in production. Nothing else changes:

- join codes keep working, for everyone, exactly as before;
- people connect an email when they happen to, from the prompt inside the app;
- code-as-login is switched off only once everyone has an account, **at a season
  boundary, never mid-season**.

`docs/AUTH.md` covers how the two credentials coexist.
