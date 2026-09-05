# Getting set up

For Scott - the person who designed and built Pigskin Poker - to run it on his own
machine and keep working on it with his own Claude.

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

## 1. Install what you need

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

**The GitHub CLI** - <https://cli.github.com> - the piece that lets Claude save and
publish your work for you instead of handing you commands. Install it, then once:

```bash
gh auth login
```

Pick **GitHub.com**, **HTTPS**, and **log in with a web browser**. It prints a code, you
paste it into the page it opens, and that is the last time you have to think about it.

You do not need any accounts to run the app locally. GitHub comes up only when you want
to send changes back - see the end of this document.

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
anyone who clones it gets the same briefing. It also says who you are and how you like to
work, so you should not have to re-explain that either.

### Let Claude do the git bits

You do not need to learn git commands. Claude has the same terminal you do, and
`CLAUDE.md` tells it to run them for you. Ask in plain English:

| Say | What Claude does |
|---|---|
| *"save this"* | Starts a branch if needed, runs the tests, commits with a sensible message |
| *"what have I changed?"* | Shows you the difference in words, not code |
| *"undo that last change"* | Puts the file back the way it was |
| *"put this up for review"* | Pushes the branch and opens a pull request, and gives you the link |
| *"put it live"* | Merges it, which publishes to the real site |

The one habit worth having: **ask it to save whenever something works.** A commit is a
point you can always come back to, and they are free. If an afternoon of changes turns out
to be a mistake, "go back to how it was this morning" is a real instruction and Claude can
do it - but only if there is a saved point to go back to.

### Saving is not publishing

Three different things, in order:

1. **Saving (commit).** On your machine only. Nobody sees it. Costs nothing, do it often.
2. **Pushing / a pull request.** Uploads the branch to GitHub so it exists somewhere other
   than your laptop, and Kyle can look at it. Still not live.
3. **Merging.** *This publishes.* A minute or two later
   <https://pigskin.ballsohard.org> is running your change, for everybody.

Claude has been told to tell you which of the three it is about to do, and to say out loud
when something is going live. If you are ever unsure, ask "is this live?" - it can check.

Nothing on your machine can touch the real site by accident. The keys that would allow it
are not in the repo; publishing only ever happens through step 3.

**Claude will ask permission before running some commands.** The everyday ones - looking
at changes, saving, running the tests - are pre-approved in the repo, so it just gets on
with them. The ones that leave your laptop, or touch a database, ask first. When you see a
prompt, that is the point to read what it says.

### What Claude will hand back to Kyle

Some of the project is plumbing rather than game, and a little of it is Kyle's alone: the
hosting, the email service, the domain, the secrets, and *applying* a database change to
the live site. Those are the ones with no undo.

That list is smaller than it sounds, and it is about the live services rather than the
code. The server-side code in `server/` and `netlify/` is ordinary repository code and it
is yours to change - you have already done it, in the fix that made the submitted-scheme
count work. Claude should write server-side code with you rather than stopping and
forwarding it.

If something you ask for genuinely needs the live database or a hosting setting changed,
Claude will say so and stop rather than quietly reaching into it. Forward that part to
Kyle and carry on.

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

### OQ-11 - when lineups lock *(built 2026-09-05; the choice is yours)*

Your league now has a switch on the **Commissioner -> Weeks** screen, and it is worth two
minutes of your time because the two settings play like different games:

- **Each player at his own kickoff** *(what your league is set to, and what it has always
  done)*. You can keep changing your lineup all Sunday, as long as the player coming in
  has not kicked off yet. Watching the injury news at 11:30 is worth something.
- **Everyone at the week's first kickoff**. Thursday night, usually. Whatever is in your
  lineup then is what plays, inactives and all - the way most fantasy leagues run.

Nothing changed for you unless you change it: the first one is the default and it is the
rule your Rules page has always described. What is new is that **the computer enforces
it now** - it reads the real NFL kickoff times, so you no longer have to sit there
pressing Lock on twelve players through the afternoon. You still can, for a late scratch,
and your own lock always wins.

**If you switch it, tell the league before the week starts.** Someone who thinks he has
until Sunday, in a league that locked on Thursday, finds out by losing a week.

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

### OQ-4b and OQ-4c *(answered 2026-08-28 - both built and live)*

You answered these in a session on 28 August, and they are here so the record is in one
place rather than only in the commit log.

**The player pool was typed out of necessity, so it is rebuilt from real rosters.** Each
NFL team's 1 QB, 2 RB, 2 WR, 1 TE and head coach - 224 players - read off the live depth
charts. **Refresh Player Pool** on your commissioner screen brings it up to date, and it
only ever runs before a week is dealt: a player who stops being a starter finishes his
week and is simply not in the next deal. Anything you set by hand is never overwritten -
if you have someone OUT and the feed thinks he is starting, it tells you the two of you
disagree rather than quietly changing it.

**Yards and touchdowns now count in three categories.** Passing 1 point per 25 yards and
4 per touchdown; rushing and receiving 1 per 10 and 6 per touchdown - all six editable in
Scoring Settings. This was a real rules change and it is the reason a quarterback no
longer decides the week on his own.

**The weekly stats now fill themselves in.** On the Live Stats screen there is a **Pull
Stats** button beside Lock Rosters. Press it after the games and every starter's boxes
fill in from that week's real NFL numbers - including each coach's Win or Loss, read off
his team's game.

Three things about it are worth knowing, because they are all deliberate:

- **It never overwrites a number you typed.** If you have already entered 84 and the feed
  says 91, yours stands and it tells you the two of you disagree - the same way Refresh
  Player Pool does about a player you marked OUT. Correcting a number is still yours to
  do, and pressing Pull again will not undo it.
- **It leaves a player blank when the feed has nothing for him**, and says who and why -
  a bye week, a game that has not finished yet, or a player it does not recognise. A blank
  scores zero, which is the same as a starter who did not play. If a late game was still
  going when you pressed it, press it again afterwards.
- **Nothing finalizes itself.** The week still ends when you press Finalize, exactly as
  before. The button fills boxes in; every decision is still yours.

It needs two things to be true first, and it will say so if they are not: the rosters have
to be locked, and the week has to know which NFL week it is (that lives on your
commissioner screen, and you normally set it once a season rather than weekly).

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

## 6. Things waiting to be fixed

Not decisions - actual bugs, found on 2026-08-27 while working out why the submitted-scheme
count was stuck. All four are the same root cause wearing different hats, and all four are
in code you can change. None of them needs the database schema touched.

**The one thing to avoid until the first is fixed:** do not use the commissioner's Teams,
Player Pool, Scoring or Standings Cfg tabs while a week is in progress. Renaming a team or
marking a player OUT mid-week throws work away. Between weeks it is safe.

### 1. Commissioner admin tools throw away schemes and past weeks *(most important)*

Rename a team, add a player, mark someone OUT, or edit the scoring, and the app quietly
deletes every scheme managers have submitted for the current week - plus every scheme from
every past week, and every past week's rosters and stat lines. The standings survive; the
detail behind them does not.

Why: those buttons send the *whole league* back to the server, rebuilt from what your
browser can see. Your browser deliberately cannot see a pending scheme, and it never holds
past weeks' rosters at all. The server treats anything missing from that picture as
something you deleted, and removes it.

The fix is in `server/league.js`, in `persistBlob`: its delete pass should only remove rows
the picture can actually speak for, rather than everything absent from it. It also wants a
test - `replaceLeague` has none, which is why this went unnoticed.

### 2. A manager's own scheme disappears when they reload

Submit a scheme, refresh the page, and the form says No Action and the confirmation line is
gone - as if nothing was submitted. It *was*; the screen just cannot see it, for the same
reason your count could not. A manager who resubmits at that point overwrites their
original with no warning.

Same shape as the fix you already wrote for the count: the browser has to ask the server,
because it cannot read this for itself. `src/components/scheme.jsx` is where it shows.

### 3. Changing a scheme has no safety check

Every other action in the app checks that nobody else changed the same thing first.
Submitting a scheme is the exception - the check is skipped, because the browser never has
the information it would compare. Combined with (2), a double submission is silent.

### 4. Your downloaded backups are missing things

The Backup tab tells you to treat manual backups as your primary safety net. A backup taken
mid-week does not contain the schemes managers have submitted, and no backup contains past
weeks' rosters or stat lines. Restoring one would not bring them back, because they were
never in the file. Worth knowing before you rely on one, and worth fixing alongside (1) -
it is the same missing picture.

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

There are 317 tests. Three of the nineteen files need the local database and **skip
themselves silently when it is not running** - 114 of them, getting on for half. They are
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
| **Claude Code** | Working on it with Claude | Yes, in practice |
| **Docker Desktop** | The database, and the 108 tests that need one | Yes - the app does not start without it |
| **GitHub CLI** (`gh`) | Letting Claude save and publish for you | Recommended |

### About Git and GitHub

**Git** is the tool that tracks changes; **GitHub** is the website the code is stored on;
**`gh`** is the command that connects the two without a browser. You do not have to use
any of them directly - Claude does - but three facts are worth carrying:

- The repo is public, so `git clone` needs no account at all.
- **Sending changes back needs your account added as a collaborator** on
  <https://github.com/keburke17/PigskinPoker>. Ask Kyle once; after that `git push`
  works, and so does everything Claude does on your behalf.
- Once `gh auth login` has been run, it stays logged in. You should not see it again.

To pick up changes Kyle has made, say *"pull the latest"* - or run it yourself:

```bash
git pull
```

Do that before starting something new. It is the one habit that avoids the tangle of two
people editing the same file from different starting points - and if it does tangle,
"sort out this merge" is a thing you can hand straight to Claude.

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
