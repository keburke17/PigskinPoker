/**
 * The Help tab, checked against the app it describes.
 *
 * tests/guidance.test.js already pins the "what do I do next" COPY, because that copy is
 * a pure function. The Help tab's other four cards are not: they are hand-written prose
 * naming screens and panels by their button labels, and nothing connects the two. Rename
 * a nav pill or add a commissioner panel and Help goes stale silently - which is issue
 * #28's complaint (documentation restating what the code owns, with nothing checking it)
 * pointed at Help rather than at Rules.
 *
 * So both lists are READ OUT OF THE SOURCE rather than restated here. A copy of a list
 * proves nothing about the original; the point is to fail when the original moves.
 *
 * Runs anywhere - no DOM, no stack, no network.
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HelpTab } from "../src/components/HelpTab.jsx";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");

const HELP = read("src", "components", "HelpTab.jsx");

/* The "What each screen does" card, on its own. Checking against the whole file is too
 * loose to be worth anything - a nav label renamed to "Live" passed a whole-file
 * substring check because "Live scores" appears in a different sentence. */
const SCREENS_CARD = (() => {
  const start = HELP.indexOf('<RuleCard title="What each screen does">');
  const end = HELP.indexOf("</RuleCard>", start);
  return start === -1 ? "" : HELP.slice(start, end);
})();

describe("Help names every screen the app actually has", () => {
  it("has a card listing the screens at all", () => {
    expect(SCREENS_CARD, 'the "What each screen does" card is gone').not.toBe("");
  });

  it("describes every tab in the nav", () => {
    /* Lifted from App's NAV, which is the list of pills a person sees. The labels are
     * deliberately short ("Commish", "Scoreboard") and were renamed once already in
     * #31 - that rename is exactly what this catches.
     *
     * Matched as <strong>Label</strong>, the form the card writes them in, so a label
     * that merely happens to appear as a word in some other sentence does not count. */
    const app = read("src", "App.jsx");
    const nav = app.slice(app.indexOf("const NAV = ["), app.indexOf("];", app.indexOf("const NAV = [")));
    /* Line by line, because an entry may carry a `route` and that is what decides
     * whether it is a tab at all - see the exemption below. */
    const entries = nav.split("\n")
      .map((line) => ({ line, label: (line.match(/label:\s*"([^"]+)"/) || [])[1] }))
      .filter((e) => e.label);

    expect(entries.length).toBeGreaterThan(4);
    for (const { line, label } of entries) {
      /* Help itself is the one exemption: the screen you are already reading does not
       * need a line telling you what it is for. */
      if (label === "Help") continue;
      /* And a pill carrying a `route` is not a tab - it navigates OUT of the league.
       * "Admin" is the only one (issue #40), it is drawn for two people on the whole
       * deployment, and listing it in a card every manager reads would advertise a
       * screen nobody else can open. */
      if (/route:/.test(line)) continue;
      expect(SCREENS_CARD, "the screen list has no entry for the '" + label + "' tab")
        .toContain("<strong>" + label + "</strong>");
    }
  });

  it("accounts for every commissioner panel", () => {
    /* Eleven of them, presented flat, which was half of issue #24 - so the one line in
     * the card that sorts them into setup / weekly / escape hatches is load-bearing. It
     * is also the line most likely to be forgotten when a twelfth panel arrives. */
    const src = read("src", "components", "commissioner.jsx");
    const m = src.match(/const labels = \{([\s\S]*?)\};/);
    expect(m, "could not find the `labels` map in CommissionerTab").toBeTruthy();

    const labels = [...m[1].matchAll(/:\s*"([^"]+)"/g)].map((x) => x[1]);
    expect(labels.length).toBeGreaterThan(8);
    for (const label of labels) {
      expect(SCREENS_CARD, "the screen list never mentions the '" + label + "' panel")
        .toContain(label);
    }
  });
});

describe("the Help prose tells the truth about locking", () => {
  /* THE CARD THIS GUARDS WAS ALREADY WRONG when this test was written. #34 made lineup
   * lock a league option fired by real kickoffs (OQ-11) and updated RulesTab and
   * guidance.js; HelpTab was missed, and went on telling every manager "Nothing locks
   * automatically. There is no Thursday cutoff and no kickoff timer in this app." That
   * is the one fact a manager most needs right, and it was false in both modes.
   *
   * So this is not "never mention a kickoff" any more - the same correction #34 made to
   * tests/guidance.test.js. It is: never describe a rule this league is not playing,
   * and never claim the clock does not exist. */
  const prose = HELP.replace(/\/\*[\s\S]*?\*\//g, ""); // comments may discuss it freely

  it("never claims that nothing locks on a clock", () => {
    expect(prose).not.toMatch(/nothing locks automatically/i);
    expect(prose).not.toMatch(/no kickoff timer/i);
    expect(prose).not.toMatch(/both locks are buttons/i);
  });

  it("never invents a weekday or a clock of its own", () => {
    /* "Thursday" stays banned outright, for the reason #34 gives: `weekly` locks on the
     * week's FIRST kickoff, whatever weekday that lands on - the 2026 season opens on a
     * Wednesday. A named weekday in static prose is a rule nobody implemented.
     *
     * STILL TRUE AFTER #52, and worth saying why. A league CAN now have a real Thursday
     * deadline - but the day and the hour come from CYCLE_DEADLINES via
     * schemeDeadlineWords(), rendered per league, never typed into a sentence here. So
     * a literal weekday in this file is still a rule that has drifted from the code,
     * and moving the deadline would still leave this screen lying. */
    expect(prose).not.toMatch(/thursday|sunday night|deadline of|midnight/i);
  });

  it("points at Rules for the full statement rather than restating it", () => {
    // Two screens describing the same option is two places to get it wrong.
    expect(prose).toMatch(/Lineup Lock/i);
  });
});

describe("the tab renders", () => {
  /* Help is the tab nobody opens during development, so nothing else would notice it
   * throwing. Cheap to assert: it takes live state, so a shape change upstream lands
   * here as a blank screen at the moment somebody is already lost. */
  const stateWith = (over = {}) => ({
    leagueName: "Test League",
    teams: over.teams ?? [{ id: "t1", name: "Burke", roster: null }],
    schemes: over.schemes ?? {},
    rosterLocked: over.rosterLocked ?? false,
    currentPeriod: over.currentPeriod ?? { type: "week", number: 1, phase: "pre-deal" },
    _meta: over._meta ?? {},
  });
  const render = (state, role, t) =>
    renderToStaticMarkup(React.createElement(HelpTab, { state, role, team: t, onGoTo: () => {} }));
  const team = { id: "t1", name: "Burke", roster: { starters: {}, bench: [] } };

  const phases = ["pre-deal", "dealt", "schemes-processed"];
  for (const phase of phases) {
    for (const locked of [true, false]) {
      it("renders at " + phase + (locked ? " (locked)" : "") + " for both roles", () => {
        const state = stateWith({
          currentPeriod: { type: "week", number: 3, phase },
          rosterLocked: locked,
        });
        for (const [role, t] of [["commissioner", null], ["manager", team]]) {
          const html = renderToStaticMarkup(
            React.createElement(HelpTab, { state, role, team: t, onGoTo: () => {} })
          );
          expect(html).toContain("Start here");
          expect(html.length).toBeGreaterThan(1000);
        }
      });
    }
  }

  /* The mode-aware half, and the one that would actually have caught #34's miss: the
   * source can hold both branches and still render the wrong one. A league on
   * `gametime` must never be told its lineup closes at the first kickoff, and a league
   * on `weekly` must never be told it can keep swapping. */
  const KICKOFFS = {
    "Buffalo Bills": "2026-09-18T00:15:00.000Z",
    "Kansas City Chiefs": "2026-09-20T17:00:00.000Z",
  };

  it("tells a gametime league its own rule, and not the other one", () => {
    const state = stateWith({ _meta: { lineupLock: "gametime", kickoffs: KICKOFFS } });
    for (const [role, t] of [["commissioner", null], ["manager", team]]) {
      const html = render(state, role, t);
      expect(html).toMatch(/freezes when his own game kicks off/i);
      expect(html).not.toMatch(/whole lineup closes/i);
    }
  });

  it("tells a weekly league its own rule, and not the other one", () => {
    const state = stateWith({ _meta: { lineupLock: "weekly", kickoffs: KICKOFFS } });
    for (const [role, t] of [["commissioner", null], ["manager", team]]) {
      const html = render(state, role, t);
      expect(html).toMatch(/whole lineup closes/i);
      expect(html).not.toMatch(/freezes when his own game kicks off/i);
    }
  });

  it("defaults an unset league to gametime, the way the engine does", () => {
    // normalizeLineupLock() sends anything unrecognised to the default; the copy must
    // follow it rather than fall through to a blank card.
    for (const meta of [{}, { lineupLock: null }, { lineupLock: "nonsense" }]) {
      const html = render(stateWith({ _meta: meta }), "manager", team);
      expect(html).toMatch(/freezes when his own game kicks off/i);
    }
  });

  it("says so plainly when the kickoff times are not known yet", () => {
    /* A real state - a week whose schedule has not been fetched. Naming a deadline that
     * is not there would be worse than saying nothing. */
    const html = render(stateWith({ _meta: { lineupLock: "weekly" } }), "manager", team);
    expect(html).toMatch(/kickoff times have not been read/i);
    expect(html).not.toMatch(/which is .* this week/i);
  });

  it("shows the commissioner walkthrough only to the commissioner", () => {
    const state = stateWith();
    const asComm = renderToStaticMarkup(
      React.createElement(HelpTab, { state, role: "commissioner", team: null, onGoTo: () => {} })
    );
    const asManager = renderToStaticMarkup(
      React.createElement(HelpTab, { state, role: "manager", team, onGoTo: () => {} })
    );
    expect(asComm).toContain("Running a week, as commissioner");
    expect(asManager).not.toContain("Running a week, as commissioner");
    // The manager walkthrough is for everybody - a commissioner runs a team too.
    expect(asManager).toContain("Your week, as a manager");
    expect(asComm).toContain("Your week, as a manager");
  });
});

/* ========================== the clock (issue #52) ==========================
 *
 * The same trap #34 sprang, in two more places: this screen told every manager "there
 * is no clock" and told every commissioner he presses each button himself. Both are
 * false for a league that has opted in (OQ-14), and false in the direction that costs
 * somebody their week. The source can carry both branches and still render the wrong
 * one, so these render it.
 */
describe("the Help prose tells the truth about the clock", () => {
  const stateWith = (meta = {}) => ({
    leagueName: "Test League",
    teams: [{ id: "t1", name: "Burke", roster: null }],
    schemes: {},
    rosterLocked: false,
    weeklyResults: [{ id: "r1" }],
    currentPeriod: { type: "week", number: 3, phase: "dealt" },
    _meta: { tz: "America/New_York", ...meta },
  });
  const team = { id: "t1", name: "Burke", roster: { starters: {}, bench: [] } };
  const render = (state, role, t) =>
    renderToStaticMarkup(React.createElement(HelpTab, { state, role, team: t, onGoTo: () => {} }));

  it("has a card saying what moves without anybody pressing anything", () => {
    expect(HELP).toContain('<RuleCard title="What happens on its own">');
  });

  it("tells a league with nothing automated exactly that", () => {
    const html = render(stateWith(), "manager", team);
    expect(html).toMatch(/Nothing deals or finalizes on its own/i);
    expect(html).toMatch(/there is no clock/i);
    expect(html).not.toMatch(/Thursday 3am/);
  });

  it("names the scheme deadline for a league that has switched it on", () => {
    const html = render(stateWith({ autoProcessSchemes: true }), "manager", team);
    expect(html).toMatch(/Thursday 3am/);
    expect(html).toMatch(/No Action/);
    /* The sentence this replaces must be gone, not merely joined. */
    expect(html).not.toMatch(/there is no clock/i);
  });

  it("names the Tuesday rollover, and says the football has to be over first", () => {
    const html = render(stateWith({ autoAdvanceWeek: true }), "manager", team);
    expect(html).toMatch(/Tuesday 6am/);
    expect(html).toMatch(/postponed or still running/i);
    expect(html).not.toMatch(/Nothing deals or finalizes on its own/i);
  });

  /* The clock never deals the first week of a season, and never starts the playoffs.
   * Both are things a manager will otherwise sit and wait for. */
  it("says which weeks the clock will not deal", () => {
    const html = render(stateWith({ autoAdvanceWeek: true }), "manager", team);
    expect(html).toMatch(/first week of a season is never dealt automatically/i);
  });

  it("tells the commissioner where the switches are", () => {
    const html = render(stateWith(), "commissioner", null);
    expect(html).toMatch(/Run the week on a clock/);
  });

  it("says what to check when something automatic did not happen", () => {
    const html = render(stateWith({ autoAdvanceWeek: true }), "commissioner", null);
    expect(html).toMatch(/did not happen/i);
    expect(html).toMatch(/timezone/i);
  });

  it("reads the deadline in the league's own timezone", () => {
    const html = render(
      stateWith({ autoProcessSchemes: true, tz: "America/Los_Angeles" }), "manager", team
    );
    expect(html).toMatch(/Thursday 3am P[DS]T/);
  });

  it("renders in every combination of the two switches", () => {
    for (const autoProcessSchemes of [true, false]) {
      for (const autoAdvanceWeek of [true, false]) {
        for (const [role, t] of [["commissioner", null], ["manager", team]]) {
          const html = render(stateWith({ autoProcessSchemes, autoAdvanceWeek }), role, t);
          expect(html).toContain("What happens on its own");
        }
      }
    }
  });
});
