-- ============================================================================
--  Telling people what happened. Issue #57, OQ-6.
--
--  The clock (issue #52) moved the week without anybody being told: rosters are dealt
--  at 6am Tuesday and schemes close at 3am Thursday, and a manager finds out by
--  remembering to open the app. The step automation removed is the commissioner's post
--  in the group chat, and this is what puts it back.
--
--  THREE KINDS, and no more. Each one is a thing that HAPPENED to your team and that
--  you may need to act on:
--
--    week_dealt         a week ended and your new roster is waiting
--    scheme_reminder    the scheme deadline is close and you have nothing on file
--    schemes_processed  the schemes ran; your lineup is yours to set
--
--  ---------------------------------------------------------------------------
--  WHY THE SEND LOG IS A TABLE AND NOT A LOG LINE.
--
--  `run-cycle-scheduled` runs every hour and is designed so that a retried, duplicated
--  or replayed run is harmless: every guard in server/autoCycle.js asks a question about
--  stored state rather than about the current minute, so acting twice is impossible
--  because acting moves the phase. Email does not have that property. An email that has
--  been sent cannot be un-sent, and nothing in `periods` records that it went out.
--
--  So the row is the record: one per (period, kind, person), created BEFORE the send is
--  attempted, unique so a second attempt collides rather than duplicating. Its id is the
--  Idempotency-Key handed to Resend, which closes the last gap - a send that succeeded
--  but whose response we never saw is recognised by the provider and not sent twice.
--
--  It is also the retry queue and the place a failure is visible. A mail failure must
--  not fail the week (the deal already happened; the standings already moved), but it
--  must not vanish either, which is exactly what a caught exception in a cron does.
--  ---------------------------------------------------------------------------
--
--  WHAT IS STORED, AND WHAT IS NOT. The row holds the RENDERED email in `payload` -
--  subject, text, html - not the facts to render it from. Two reasons: a retry an hour
--  later must send what the first attempt would have sent rather than re-reading a
--  league that has moved on, and a message somebody says they never received can be read
--  back exactly as it was sent. The address is NOT stored: it is resolved from
--  auth.users at send time, so a person who corrects their address gets the retry.
--
--  NOBODY'S EMAIL LIVES IN THIS SCHEMA. auth.users owns addresses, the same way
--  `profiles` deliberately does not duplicate them.
-- ============================================================================

-- ----------------------------------------------------- leagues.notify_members --
-- The commissioner's switch, DEFAULT FALSE like every other automation switch here
-- (auto_pull_stats, auto_process_schemes, auto_advance_week) and for the same reason:
-- a league that is already being played must never start emailing its members because
-- we deployed something. Turning it on is a decision made on his own screen.
--
-- Per LEAGUE rather than per season: it says how this league talks to its members, not
-- how it plays. Same shelf as `visibility`.
alter table leagues
  add column notify_members boolean not null default false;

comment on column leagues.notify_members is
  'Issue #57. Send league email (roster dealt, scheme reminder, schemes processed) to this league''s managers. Default false; each member can still opt out per kind in notification_prefs.';

-- ------------------------------------------------------------ notifications --
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references leagues(id) on delete cascade,
  -- The week this is about. Every kind is about a week, which is what makes
  -- (period, kind, person) a complete identity for "this message".
  period_id  uuid not null references periods(id) on delete cascade,
  kind       text not null check (kind in ('week_dealt','scheme_reminder','schemes_processed')),
  -- The PERSON, not the team. A team with two managers is two rows, and a manager who
  -- runs teams in two leagues gets one row per league. On delete cascade because a
  -- deleted account has no unsent mail.
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Which team this is about, for a subject line and for reading the table later. Set
  -- null rather than cascade: losing the team must not lose the record of the send.
  team_id    uuid references teams(id) on delete set null,

  --   pending  enqueued, not yet accepted by the provider
  --   sent     the provider accepted it
  --   failed   attempts exhausted; `last_error` says what happened
  --   skipped  deliberately not sent - no key configured (local development), the
  --            member opted out between enqueue and send, or no address on file.
  --            A skip is a SUCCESS, the same way a league the cycle passed over is.
  status     text not null default 'pending'
               check (status in ('pending','sent','failed','skipped')),
  attempts   int  not null default 0,
  last_error text,
  -- The rendered message: { subject, text, html }.
  payload    jsonb not null,
  -- The provider's id for the accepted message, for matching against Resend's own logs.
  provider_id text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,

  -- THE WHOLE POINT. One message per person per week per kind, enforced by the
  -- database rather than by the job being careful.
  unique (period_id, kind, user_id)
);

-- The drain's only query: everything still owed, oldest first.
create index notifications_pending on notifications (status, created_at)
  where status in ('pending','failed');

comment on table notifications is
  'Issue #57 / OQ-6. The send log AND the outbox: one row per (period, kind, person), created before the send and used as the provider idempotency key. Server-only.';

-- ------------------------------------------------------- notification_prefs --
-- One row per person, three switches, all true by default - a member of a league whose
-- commissioner turned email on gets it until they say otherwise.
--
-- PER PERSON, NOT PER LEAGUE-MEMBERSHIP, and that is a deliberate simplification. The
-- unsubscribe link in an email arrives with no session behind it, and "stop sending me
-- this kind of email" is what somebody clicking it means - not "stop for this league
-- but keep going for the other one". A person in two leagues who wants one of them
-- quiet is a case nobody has yet; when they do, this table grows a league_id and the
-- link grows a scope.
--
-- ABSENCE MEANS YES. Nothing writes a row when somebody joins; a missing row reads as
-- all three true (server/notify.js). That keeps the opt-out path the only writer, so
-- the table only ever contains decisions people actually made.
create table notification_prefs (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  week_dealt        boolean not null default true,
  scheme_reminder   boolean not null default true,
  schemes_processed boolean not null default true,
  updated_at        timestamptz not null default now()
);

comment on table notification_prefs is
  'Issue #57. Per-person email opt-outs, one column per notification kind. A missing row means all three are on. Written by the unsubscribe endpoint and by the account screen; read by server/notify.js.';

-- ============================================================================
--  ROW LEVEL SECURITY
--
--  `notifications` has NO POLICY, which denies everything: RLS on with no policy is how
--  site_admins and invites are locked down, and this table deserves the same treatment.
--  It is a list of who is in which league and what they were told and when, and nothing
--  in the browser needs it. It is listed in SECRETS in scripts/verify-grants.mjs in this
--  same change, so the hosted GRANT ALL default that 20260818020000 exists because of is
--  actually checked on it.
--
--  `notification_prefs` follows `profiles`: you may READ YOUR OWN ROW and nothing else,
--  so the account screen can show the three switches without a round trip. Every WRITE
--  goes through the Netlify function on the secret key, because the unsubscribe path has
--  no session at all - it is authorized by a signed token, not by auth.uid().
-- ============================================================================
alter table notifications       enable row level security;
alter table notification_prefs  enable row level security;

create policy read_own_notification_prefs on notification_prefs
  for select to authenticated
  using (user_id = auth.uid());

revoke all privileges on notifications      from anon, authenticated;
revoke all privileges on notification_prefs from anon, authenticated;

grant select on notification_prefs to authenticated;

grant all privileges on notifications      to service_role;
grant all privileges on notification_prefs to service_role;
