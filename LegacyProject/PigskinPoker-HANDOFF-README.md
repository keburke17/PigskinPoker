# Pigskin Poker — Handoff Notes

This document is for whoever is going to take `PigskinPoker.jsx` and turn it into a
real, standalone website. It explains what the code is, what will work as-is, and
the one thing that has to be replaced before it'll run outside of Claude.

## What this is

A single-file React app (~2,500 lines) implementing a custom fantasy-football
league game called "Pigskin Poker." One file, one default-exported component
(`App`), no build config, no external state library — just React function
components and hooks (`useState`, `useEffect`, `useCallback`, `useRef`).

It covers the whole game: weekly random roster deals, a scheme system
(block/steal/redraw), configurable scoring, standings with tiebreakers, a
playoff bracket, a commissioner control panel, and manager-facing team pages.
All game logic (dealing, scheme resolution, scoring, ranking, playoff
advancement) is implemented as plain, framework-independent JS functions near
the top of the file — those are fully portable and don't need to change.

## The one thing that won't work outside Claude: `window.storage`

This app was built to run as a **Claude.ai published Artifact**, which exposes a
special browser API called `window.storage` for reading/writing persisted data
(`window.storage.get(key, shared)`, `.set(key, value, shared)`, `.delete(...)`,
`.list(...)`). That API **only exists inside Claude's artifact environment** —
it is not a real web standard, and there is nothing at that name in a normal
browser. If you drop this file into a plain webpage as-is, every save/load call
will throw immediately.

Everywhere the app calls `window.storage`, it needs to be swapped for a real
backend. The good news: the storage surface is small and centralized. Search
the file for `window.storage` and you'll find it used in exactly these places:

- `LEAGUE_KEY = "pigskin_league_state_v1"` — the shared league data (rosters,
  teams, standings, activity log, etc.) — currently stored with `shared: true`.
- `IDENTITY_KEY = "pigskin_my_identity_v1"` — which team/role is logged in on
  this device — currently stored with `shared: false` (per-user).
- The `loadLeague()` function (initial load on mount).
- The `doSave()` function (fires on every state change, no debounce).
- The identity-save `useEffect` right after `doSave`.

To port this, replace those calls with real persistence, for example:

- **Simplest**: a small backend (Node/Express, Firebase, Supabase, etc.) with
  two endpoints/collections — one shared "league" document all clients read
  and write, one per-device "identity" value (could just live in
  `localStorage` on a real site instead of a backend call, since it's only
  used to remember *this browser's* login).
- **Realtime option**: if you want live updates across everyone's screens
  without polling (nice for a live-stats page during game day), Firebase
  Realtime Database / Firestore or Supabase's realtime subscriptions are a
  natural fit — swap the shared-storage calls for reads/writes to one
  document, and subscribe to it instead of only loading once.
- Keep the same shape: `state` is one big JSON-serializable object. Whatever
  you swap in just needs `get()` → returns that JSON (or null if empty) and
  `set()` → persists it. The rest of the app doesn't care how that happens.

Everything else — all the UI, the CSS (plain CSS in a `<style>` tag, no
Tailwind or other framework dependency), the game logic — should work in any
standard React setup (Create React App, Vite, Next.js, etc.) with no changes
beyond swapping that storage layer.

## Other notes for whoever picks this up

- No routing library is used — navigation is just local component state
  (`tab`, `sub`, etc.), so it'll behave the same in any React setup.
- No external icon libraries — icons/suit symbols are built from real Unicode
  code points via a small `CP()` / `String.fromCodePoint` helper near the top,
  specifically to avoid encoding issues. Leave that pattern alone rather than
  swapping in raw unicode characters or `\u` escapes in JSX text — escapes in
  JSX text render literally instead of being interpreted, which caused bugs
  during development.
- Save behavior is intentionally aggressive: it saves on every state change,
  immediately, no debounce, with visible save-status UI and a manual "Save
  Now" button — this was a deliberate design choice (not a default to
  "optimize away"), since the person running this league wants a strong
  guarantee that nothing gets lost.
- There's a built-in JSON export/import (Commissioner → Backup) that dumps
  the entire `state` object. That's useful for migrating data if/when you
  switch backends — export from the Claude version, import into the new one,
  as long as the new backend stores the same JSON shape.

## Files

- `PigskinPoker.jsx` — the full app, as currently running in Claude.
