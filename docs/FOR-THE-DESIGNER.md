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
people editing at once can no longer overwrite each other, and the join codes are no
longer sent to everyone's browser.

---

## 1. Install the two things you need

**Node.js** - <https://nodejs.org> - take the LTS version. This runs the app.

**Claude Code** - <https://claude.com/claude-code> - or, if you already have Node:

```bash
npm install -g @anthropic-ai/claude-code
```

You do not need Docker, a database, or any accounts to run the app locally.

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

```bash
npm run dev
```

Open <http://localhost:5173>.

It starts with a **demo league already populated** - six teams, a finished Week 1, and a
Week 2 in progress with some stats entered. Log in with:

| Role | Code |
|---|---|
| Commissioner | `DEMO-COMMISH` |
| Team manager | `DEMO-TEAM-1` through `DEMO-TEAM-6` |

Refresh the page to reset it. There is no database here - it all lives in memory, so you
can deal, finalize weeks, reset the league, and try anything at all without consequences.

**This is the safest way to test rule changes.** It is completely disconnected from the
live site.

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

### OQ-10 - one league, or several?

The database could hold several leagues; the app assumes one. If you ever want other
people running their own leagues, that is worth knowing now, because it is much simpler
to build alongside real user accounts than to retrofit afterwards.

---

## What is not safe yet

The live site is real but not hardened. Before you run a league you care about on it:

- **There is no limit on login attempts**, so a determined guesser gets unlimited tries
  at the commissioner code.
- **Anyone with the URL can read the league.** That matches the Artifact, but the URL is
  now guessable rather than a private link.

Both are on the list for the next phase.

---

## Optional: running a real database locally

Everything above needs no database. If you want to test the *full* stack - real logins
verified server-side, live updates, the actual write path - you can run a complete copy
of Supabase on your machine.

That needs **Docker Desktop** (<https://docker.com>), which is a large install and uses a
fair amount of memory while running. Then:

```bash
npx supabase start && npx supabase db reset
```

and create a `.env.local` file from the values `npx supabase status` prints - `README.md`
has the exact list.

**You almost certainly do not need this.** Rule changes, scoring tweaks, UI work and
anything about how the game plays are all better tested in the no-database mode, which
starts instantly and resets on refresh. Docker is only worth it if you are changing how
data is stored or how logins work.

Your local database and the live site are completely separate. Nothing you do locally can
reach the real league, and the credentials that would let it are not in the repo.

---

## What you need installed, in short

| Tool | Needed for | Required? |
|---|---|---|
| **Node.js** | Running the app at all | Yes |
| **Git** | Getting the code, and keeping it up to date | Yes |
| **Claude Code** | Working on it with Claude | Recommended |
| **Docker Desktop** | Running a real database locally | Only if you want the full stack |

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
fabricated test data, generated fresh from a fixed random seed. It exists so the app has
something to show without a database. It is not connected to any real league, and it
resets every time you refresh.
