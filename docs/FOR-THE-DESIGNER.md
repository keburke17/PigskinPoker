# Getting set up

For the person who designed and built Pigskin Poker, to run it on your own machine and
keep working on it with your own Claude.

You do not need to know how any of the porting worked. This is about 15 minutes, and
**nothing you do locally can affect the live league.**

---

## What changed, in one paragraph

Your app is the same game. It was moved out of the Claude Artifact into a normal website
so it can live at a real URL. The parts that ran the game - dealing, schemes, scoring,
tiebreaks, playoffs - were moved across unchanged, and there is an automated test that
runs your original code and the new code side by side on the same random seeds and
checks they produce identical results, including whole simulated seasons. If anyone ever
changes the game by accident, that test fails.

What actually changed: it saves to a real database instead of Claude's storage, two
people editing at once can no longer overwrite each other, and signing in is now an email
address and a link rather than a shared code. New members join by invitation.

---

## 1. Install the three things you need

**Node.js** - <https://nodejs.org> - take the LTS version. This runs the app.

**Docker Desktop** - <https://docker.com> - this runs the database. It is a big download
and it uses a fair amount of memory while it is open, but the app genuinely does not
start without it: there is one way to run this project and it is the real one, with a
real database and real sign-in. There used to be a no-database mode that started
instantly; it was removed, because it could not sign anybody in.

**Claude Code** - <https://claude.com/claude-code> - or, if you already have Node:

```bash
npm install -g @anthropic-ai/claude-code
```

You do not need any accounts to run it locally. GitHub comes up only if you want to send
changes back - see the end of this document.

---

## 2. Get the code

```bash
git clone https://github.com/keburke17/PigskinPoker.git
```

```bash
cd PigskinPoker && npm install
```

---

## 3. Run it

Start Docker Desktop first and wait for the whale in the menu bar to settle. Then:

```bash
npm run dev
```

Open <http://localhost:5173>.

That one command does everything: it starts a real database on your machine, sets up the
tables, fills it with a **demo league already populated** - six teams, a finished Week 1,
and a Week 2 in progress with some stats entered - creates the sign-in accounts, and
starts the app. It prints a list of what it made, including every address you can sign in
as.

### Signing in

There are no codes any more. You sign in with an email address and a link, the same as the
real site - except that no mail actually leaves your machine. It is caught by a fake
inbox, and the command window prints the link the moment it is sent, so you can just click
that.

| Sign in as | Who they are |
|---|---|
| `commish@pigskin.test` | The commissioner |
| `team1@pigskin.test` .. `team5@pigskin.test` | Managers of teams 1-5 |

Team 6 is deliberately left with nobody running it, so you can try what a **new member**
goes through: sign in as any address you like - `scott@pigskin.test`, anything - then
choose **I Have An Invite Code** and paste `PGSKN2-DEMTEAM234`. That puts you in charge of
the All-In Antlers.

### Starting over

```bash
npm run db:reset
```

That wipes your local database and rebuilds the demo league exactly as it was. Deal
weeks, finalize them, reset the league, break whatever you like - this is a copy on your
own machine and **it cannot reach the live site**. The credentials that would let it are
not in the repo.

Ordinary `npm run dev` does *not* wipe anything, so work you leave half-finished is still
there tomorrow.

---

## 4. Working with your Claude

Open Claude Code in the project folder:

```bash
claude
```

There is a file called `CLAUDE.md` in the repo, and **Claude reads it automatically** at
the start of every session. It explains the layout, which parts are load-bearing, what is
deliberately unfinished, and - most relevant to you - **which things look like bugs but
must not be changed without your say-so.**

That means you should not have to explain the project. You can open Claude and ask
directly:

- *"Where is the tiebreak logic?"*
- *"What happens if two teams tie on raw score in the same week?"*
- *"Add a bonus point for a 100-yard rushing game"*
- *"Why does the FLEX slot never get a TE?"*

Because `CLAUDE.md` lives in the repo, it stays current as the project changes, and
anyone who clones it gets the same briefing.

### One thing to be aware of

Claude is helpful, which is occasionally the problem. There is a genuine defect in the
tiebreak code - see **OQ-A** below - and a Claude that has not read `CLAUDE.md` would
spot it and fix it, quietly changing your league's standings. The file specifically warns
against that. If you ever work on this outside the repo, or paste code into a chat, that
protection is not there.

---

## 5. Things waiting on your decision

These are yours, not ours. They are written up in full in `docs/OPEN-QUESTIONS.md`; here
is what they are and why they matter.

### OQ-A - a real bug in the tiebreakers *(most important)*

The Rules page lists six tiebreakers. The code only ever applies **five**. The sixth -
best single-player score - never breaks a tie.

Worse: two teams level on the first five get *different* ranks anyway, decided by
whichever team was added to the league first. So they get different standings points for
what should be a tie.

It is rare, but it is real, and it silently changes standings when it happens. The fix is
one character. **It was left alone because it is your rule set and a live league.** Say
the word and it changes.

### OQ-B - what "Block" is allowed to protect

The submission form only ever offers your own starters, but the engine never re-checks
that. It has been made a real rule server-side - Block protects one of *your own
starters* - which matches what the app has always done in practice. Just confirm that is
what you intended.

### OQ-C, D, E - smaller behaviours, all preserved as-is

- Weekly ties are broken by season-to-date standing, so whoever is already ahead wins the
  tie.
- The Coach can count as your "best player" for the season record.
- Stats are attached to a lineup slot rather than a player.

None are changed. Each is a small yes/no.

### OQ-4b - is the player pool hand-curated on purpose?

The 32-team player list was typed out by hand. Was that because you wanted to control
exactly who is in the game, or just because the Artifact could not fetch a roster? The
answer decides whether a future stats feed *adds to* your list or *replaces* it.

### OQ-8 - the phone question

Checked on a phone: the layout holds up, nothing overflows, stat entry wraps properly.
But every button and input is smaller than the recommended minimum tap size - usable, but
fiddly one-handed on a Sunday. Making them bigger changes the look of every screen, so it
is a design call, not a technical one. **Leave it as you designed it, or make them
bigger?**

### OQ-10 - one league, or several? *(answered: several - already built)*

This one is no longer a question, and is here so you know what was decided in your
absence. The app creates leagues from a button, whoever creates one is its commissioner,
and a new league's data is readable only by its own members. It was built alongside the
accounts work because retrofitting it afterwards would have meant answering "who owns
this league" twice.

Your league is unaffected: it was set to be readable by anyone with the link, exactly as
it was before. New leagues default to members-only.

---

## What is not safe yet

The live site is real but not hardened. Before you run a league you care about on it:

- **Anyone with the URL can read a league that is set to public.** That matches the
  Artifact, but the URL is now guessable rather than a private link. New leagues default
  to members-only; the existing one was set public so nothing changed for it.
- **Email is the only way in.** If the mail provider breaks, nobody can sign in at all -
  including you. It is worth knowing that is the single point of failure.

Login guessing is no longer on this list: there is no code to guess, and Supabase rate
limits its own sign-in.

---

## About the test suite

There are 245 tests. Three of the sixteen files need the local database and **skip
themselves silently when it is not running** - 108 of them, getting on for half. They are
not incidental:

- every Row Level Security assertion (what a visitor's browser can read, and that it can
  write nothing, anywhere);
- every server-side authorization check (that a manager cannot enter stats, finalize a
  week, or touch another team's lineup);
- the regression guard for a bug that would have silently destroyed the league the first
  time anyone added a team.

Without the database, `npm test` prints a cheerful green pass having run **none** of
those. That is a bad way to find out you broke the security model.

Since `npm run dev` starts the database for you, the ordinary case is that they all run.
The thing to watch is the skip count: if the output mentions skipped files, Docker is not
running, and you have not tested what you think you have.

There used to be a second mode here - a no-database version that started instantly and
kept everything in memory. It was removed, because it could not sign anybody in, so the
fastest way to work was also the one that could not exercise accounts, invitations or
permissions at all. One mode, and it is the real one.

---

## What you need installed, in short

| Tool | Needed for | Required? |
|---|---|---|
| **Node.js** | Running the app at all | Yes |
| **Git** | Getting the code, and keeping it up to date | Yes |
| **Claude Code** | Working on it with Claude | Recommended |
| **Docker Desktop** | The database, and the 108 tests that need one | Yes - the app does not start without it |

### About Git and GitHub

**Git** is the tool; **GitHub** is where the code is stored. You need Git installed to
clone the repo.

You do **not** need a GitHub account just to get the code or to run it - the repo is
public, so `git clone` works with no account and no login.

You need an account only to **send changes back**:

- Create one free at <https://github.com>, then ask Kyle to add you as a collaborator on
  the repository. After that `git push` works.
- Alternatively, fork it to your own account and send pull requests - useful if you would
  rather propose changes than publish them directly.

Either way, pulling in later updates is:

```bash
git pull
```

If you are only trying things out locally and never pushing, you can skip the account
entirely - your changes just stay on your machine.

---

## A note on the demo league

The six-team league you see locally - Gridiron Gamblers, Pocket Aces and so on - is
fabricated test data, generated from a fixed random seed. It exists so that the moment
`npm run dev` finishes there is a populated league to play with rather than an empty
screen.

It lives in the database on your machine, so **whatever you do to it stays done** - deal
a week, finalize it, break something, and it is still that way tomorrow.
`npm run db:reset` puts it back exactly as it started. It is not connected to any real
league, and nothing on your machine can reach the live site.
