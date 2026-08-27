---
description: Summarize the changes Scott has made to the repo
argument-hint: "[since] - a date or git ref, default: 7 days ago"
allowed-tools: Bash(git fetch:*), Bash(git log:*), Bash(git show:*), Bash(git diff:*), Bash(git branch:*)
---

Summarize what Scott has changed in this repository since $1 (default: 7 days ago).

## Finding his work

Scott's changes land two ways, and both count:

- commits authored by `scottylew33` (`git log --author=scottylew33`)
- anything merged from a `scott/*` branch, whoever the commit is attributed to -
  a Claude session driving git on his behalf may be the author

Kyle (`keburke17`) owns the plumbing; his commits and the `claude/*` and `docs/*`
branches are not Scott's work. Mention them only if they collide with something
Scott did.

Start with `git fetch origin main`, then read `origin/main` - not the local
checkout, which may be stale or on a working branch.

## What to say

Write it for Kyle: what changed, and whether anything needs his attention.

1. **One line per change**, in league terms first and code second - "the
   commissioner now sees schemes managers submitted, not just his own
   (`src/components/`)". Read the diff, do not just restate the commit subject.
2. **Flag anything that touched the game rules.** `src/engine/` is behaviour the
   original designer owns. If `tests/parity.test.js` changed, say so loudly and
   quote the reason recorded there - that is a deliberate rules change and should
   have his sign-off.
3. **Flag a migration in `supabase/migrations/`.** That is the one thing merging
   does not finish: `npm run db:push` is Kyle's and has to be run by hand, or `main`
   describes a schema the live database does not have. Server-side code in `server/`
   and `netlify/` is ordinary repository code and Scott's to change - report it as
   work he did, not as something waiting on Kyle.
4. **Note new entries or answers in `docs/OPEN-QUESTIONS.md`** - that is where a
   decision Scott made gets recorded.
5. **Note work in flight**: `git branch -r --no-merged origin/main` for `scott/*`
   branches that have not landed, with their newest commit and its date. A branch
   quiet for more than a week is worth calling out as stalled. Add pull request
   state if `gh` happens to be signed in; do not go hunting for it if not.

If nothing changed in the window, say exactly that in one line. Do not pad it.

Do not change any files. This is a read-only report.
