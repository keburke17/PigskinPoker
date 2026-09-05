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
    const labels = [...nav.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);

    expect(labels.length).toBeGreaterThan(4);
    for (const label of labels) {
      /* Help itself is the one exemption: the screen you are already reading does not
       * need a line telling you what it is for. */
      if (label === "Help") continue;
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

describe("the Help prose tells the truth", () => {
  it("never promises a weekday or a kickoff deadline", () => {
    /* THE SAME REGRESSION GUARD tests/guidance.test.js carries, pointed at the other
     * half of the copy. Nothing in this app freezes on a clock - both locks are buttons
     * the commissioner presses - and guidance.test.js can only see nextStep()'s output.
     * The "When something locks" card is hand-written here and is precisely where a
     * plausible-sounding "by Thursday" would get typed in.
     *
     * DENYING a clock is the correct thing to say, and the shipped copy does exactly
     * that ("There is no Thursday cutoff and no kickoff timer"). So this cannot be a
     * substring ban - it checks per sentence, and a deadline word is only a failure in
     * a sentence that does not negate it. Crude, and deliberately so: the failure it is
     * built for is somebody adding a sentence that PROMISES a deadline, which will not
     * be phrased as a denial. */
    const prose = HELP.replace(/\/\*[\s\S]*?\*\//g, ""); // comments may discuss it freely
    const DEADLINE = /thursday|sunday night|by kickoff|deadline of|midnight|automatically lock/i;
    const NEGATED = /\b(no|not|never|nothing|neither|nor)\b/i;

    const offenders = prose
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => DEADLINE.test(sentence) && !NEGATED.test(sentence));
    expect(offenders).toEqual([]);
  });

  it("still says out loud that nothing locks on a clock", () => {
    /* The other direction, and the one that actually matters to a manager: the denial
     * has to BE there. Deleting the sentence would pass the check above trivially. */
    expect(HELP).toMatch(/Nothing locks automatically/i);
    expect(HELP).toMatch(/no kickoff timer/i);
  });

  it("is ASCII only, like the rest of the source", () => {
    // CLAUDE.md, Conventions. A smart quote pasted in from a document is how this breaks.
    const offenders = HELP.split("\n")
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => /[^\x00-\x7F]/.test(line)); // eslint-disable-line no-control-regex
    expect(offenders).toEqual([]);
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
    _meta: {},
  });
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
