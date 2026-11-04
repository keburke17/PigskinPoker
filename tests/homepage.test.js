/**
 * The homepage (Scott, 2026-11-04): your leagues with what each is doing this week, then
 * every game the site offers, two of them coming soon.
 *
 * Three layers, each pinned on its own: the server's facts about a league
 * (`leagueHomeFacts`, pure, no database), the words made from them (homeStatus.js), and
 * the screen (rendered to markup - this suite has no DOM, like leagueSwitch.test.js).
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { leagueHomeFacts } from "../server/operations.js";
import { leagueStatus, leagueSubtitle } from "../src/components/homeStatus.js";
import { GAMES } from "../src/components/games.jsx";
import { LandingScreen } from "../src/components/LandingScreen.jsx";

const SEASON = { id: "s1", league_id: "L", year: 2026, status: "active", playoff_completed: false };

describe("leagueHomeFacts - which week the homepage talks about", () => {
  const periods = [
    { season_id: "s1", type: "week", number: 1, phase: "finalized" },
    { season_id: "s1", type: "week", number: 2, phase: "dealt" },
    { season_id: "s1", type: "week", number: 3, phase: "pre-deal" },
  ];

  it("picks the first week not yet finalized, as the league's own screens do", () => {
    const f = leagueHomeFacts({ league: { mode: "season" }, seasons: [SEASON], periods });
    expect(f.period).toEqual({ type: "week", number: 2, phase: "dealt" });
    expect(f.game).toBe("season");
    expect(f.seats).toBe(null);
  });

  it("falls back to the last period when every one is finalized, playoffs after weeks", () => {
    const done = [
      { season_id: "s1", type: "playoff", number: 1, phase: "finalized" },
      { season_id: "s1", type: "week", number: 18, phase: "finalized" },
    ];
    const f = leagueHomeFacts({ league: { mode: "season" }, seasons: [SEASON], periods: done });
    expect(f.period).toEqual({ type: "playoff", number: 1, phase: "finalized" });
  });

  it("ignores another season's periods, and prefers the active season", () => {
    const old = { id: "s0", league_id: "L", year: 2025, status: "complete", playoff_completed: true };
    const f = leagueHomeFacts({
      league: { mode: "season" },
      seasons: [old, SEASON],
      periods: [{ season_id: "s0", type: "week", number: 9, phase: "dealt" }, ...periods],
    });
    expect(f.period.number).toBe(2);
    expect(f.seasonOver).toBe(false);
  });

  it("reports a table's seats, and carries the scheme clock and timezone", () => {
    const f = leagueHomeFacts({
      league: { mode: "table", table_seats: 8, auto_process_schemes: true, tz: "America/Chicago" },
      seasons: [SEASON],
      periods,
      seated: 6,
    });
    expect(f).toMatchObject({ game: "table", seats: 8, seated: 6, autoProcessSchemes: true, tz: "America/Chicago" });
  });

  it("has no period at all for a league with no season yet", () => {
    expect(leagueHomeFacts({ league: { mode: "season" } }).period).toBe(null);
  });
});

describe("the status line", () => {
  const base = { game: "season", period: { type: "week", number: 9, phase: "dealt" } };

  it("names the deadline only when the league's scheme clock is on", () => {
    const at = Date.UTC(2026, 10, 4, 12);
    expect(leagueStatus({ ...base, autoProcessSchemes: true, tz: "America/New_York" }, at))
      .toBe("Week 9 - Schemes due Thursday 3am EST");
    expect(leagueStatus({ ...base, autoProcessSchemes: false }, at)).toBe("Week 9 - Schemes open");
  });

  it("says Hand for a table and names the playoff round", () => {
    expect(leagueStatus({ game: "table", period: { type: "week", number: 4, phase: "pre-deal" } }))
      .toBe("Hand 4 - Waiting on the deal");
    expect(leagueStatus({ game: "season", period: { type: "playoff", number: 2, phase: "stats" } }))
      .toBe("Playoffs round 2 - Scores coming in");
  });

  it("says the season is over once there is a champion", () => {
    expect(leagueStatus({ ...base, seasonOver: true })).toBe("Season over");
  });

  it("says nothing rather than something wrong when the facts did not arrive", () => {
    expect(leagueStatus({ name: "Old server row" })).toBe(null);
  });

  it("subtitles a league by game, role and team, and a table by its seats", () => {
    expect(leagueSubtitle({ game: "season", role: "manager", teamName: "Gridiron Gang" }))
      .toBe("Season League - Gridiron Gang");
    expect(leagueSubtitle({ game: "table", role: "commissioner", teamName: "The House", seats: 8, seated: 6 }))
      .toBe("Weekly Table - Dealer - The House - 6 of 8 seated");
  });
});

describe("the homepage screen", () => {
  const props = {
    leaguesLoading: false,
    onSignInWithEmail: () => {},
    onRedeemInvite: () => {},
    onCreateLeague: () => {},
    onOpenLeague: () => {},
    onSignOut: () => {},
    error: null,
    setError: () => {},
  };

  it("lists each league with its status line", () => {
    const html = renderToStaticMarkup(
      React.createElement(LandingScreen, {
        ...props,
        account: { email: "scott@example.com" },
        leagues: [{ id: "a", name: "Sunday Crew", role: "manager", teamName: "Gridiron Gang", ...{ game: "season", period: { type: "week", number: 9, phase: "schemes-processed" } } }],
      }),
    );
    expect(html).toContain("Sunday Crew");
    expect(html).toContain("Week 9 - Schemes are in");
    expect(html).toContain("Log Out");
  });

  it("offers every live game with a PLAY button, and coming-soon games without one", () => {
    const html = renderToStaticMarkup(React.createElement(LandingScreen, { ...props, account: null, leagues: [] }));
    const live = GAMES.filter((g) => !g.comingSoon);
    const soon = GAMES.filter((g) => g.comingSoon);
    for (const g of live) expect(html).toContain('aria-label="Play ' + g.name + '"');
    expect((html.match(/>PLAY</g) || []).length).toBe(live.length);
    expect((html.match(/>Coming soon</g) || []).length).toBe(soon.length);
    // Signed out, the games are still there - looking around needs no email.
    expect(html).toContain("Start a Game");
    expect(html).not.toContain("Log Out");
  });

  it("puts the football on the title, not the card suits", () => {
    const html = renderToStaticMarkup(React.createElement(LandingScreen, { ...props, account: null, leagues: [] }));
    expect(html).toContain("Pigskin Poker");
    expect(html).not.toMatch(/[♠♦]/);
  });
});
