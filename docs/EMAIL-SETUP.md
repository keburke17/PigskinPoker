# Email setup - making magic links actually arrive

Everything in this document is done in a **dashboard**, not in this repo. It is the one
part of Phase 3c that code cannot do for you, and until it is done, **email sign-in does
not work in production**. Join codes are unaffected and keep working throughout - which
is exactly why the accounts layer was built alongside them rather than instead of them.

Local development needs none of this. The local stack captures every message at
<http://127.0.0.1:54324> and never sends anything.

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

## 1. Resend, and the sending domain

1. Create a Resend account and add the domain you will send from.
2. Resend gives you DNS records - typically SPF, DKIM and a return-path CNAME. Add them
   wherever the domain's DNS lives, the same way the site's records were added.
3. Wait for Resend to show the domain **verified**. This can take minutes or hours; it is
   DNS, so it is not instant.
4. Create an **SMTP credential** (not just an API key - Supabase speaks SMTP here).

**Do not skip domain verification.** Sending from an unverified domain gets the mail
filed as spam, which looks identical to it not being sent.

---

## 2. Supabase dashboard - SMTP

Authentication -> Emails -> SMTP Settings. Enable custom SMTP and enter:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `587` |
| Username | `resend` |
| Password | the Resend SMTP credential |
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
