/**
 * The week's action - the card that moved onto the Week screen (2026-09-08, OQ-20).
 *
 * There is no React renderer in this project and adding one would be a dependency for a
 * hobbyist to maintain (CLAUDE.md, Conventions), so the parts worth asserting were
 * written as plain functions and are tested as plain functions: which events belong to
 * the open week, which chip a type gets, and whether a row counts as yours.
 *
 * The last of those is a heuristic and this file is where that is pinned. An activity
 * entry carries prose and nothing else - no team id - so "is this mine" is a name match.
 * That is a deliberate limit, not an oversight: adding a field to an entry is an engine
 * change that parity compares field for field, and decompose.js would drop it anyway.
 */

import { describe, it, expect } from "vitest";
import { chipFor, eventsForPeriod, mentionsTeam } from "../src/components/activity.jsx";

const ev = (id, type, text, period) => ({ id, type, text, period, periodLabel: "", ts: null });

const WEEK_1 = { type: "regular", number: 1 };
const WEEK_2 = { type: "regular", number: 2 };
const ROUND_2 = { type: "playoff", number: 2 };

describe("eventsForPeriod", () => {
  const log = [
    ev("a", "steal", "Pocket Aces stole WR X from Full House Flyers.", WEEK_1),
    ev("b", "block", "Gridiron Gamblers blocked Josh Allen (QB).", WEEK_2),
    ev("c", "redraw", "Dead Man's Hand redrew Y for Z.", WEEK_2),
  ];

  it("keeps only the open period's events", () => {
    expect(eventsForPeriod(log, WEEK_2).map((e) => e.id)).toEqual(["c", "b"]);
  });

  it("returns them newest first", () => {
    /* The log is appended to, so the last entry is the newest. The card leads with what
     * just happened; the full log on League -> Activity does the same. */
    expect(eventsForPeriod(log, WEEK_2)[0].id).toBe("c");
  });

  it("does not confuse Week 2 with Playoff Round 2", () => {
    /* Both are number 2. Matching on the number alone would put the whole regular
     * season's Week 2 into the second playoff round's card. */
    const withPlayoff = log.concat([ev("d", "result", "Playoff Round 2 final.", ROUND_2)]);
    expect(eventsForPeriod(withPlayoff, ROUND_2).map((e) => e.id)).toEqual(["d"]);
    expect(eventsForPeriod(withPlayoff, WEEK_2).map((e) => e.id)).toEqual(["c", "b"]);
  });

  it("survives a log that is missing, empty, or holds entries with no period", () => {
    expect(eventsForPeriod(undefined, WEEK_1)).toEqual([]);
    expect(eventsForPeriod([], WEEK_1)).toEqual([]);
    /* hydrate.js writes period: null for an event whose period row has gone. */
    expect(eventsForPeriod([ev("x", "warning", "orphan", null)], WEEK_1)).toEqual([]);
  });

  it("returns nothing rather than throwing when there is no open period", () => {
    expect(eventsForPeriod([ev("a", "steal", "s", WEEK_1)], null)).toEqual([]);
  });

  it("does not mutate the log it was given", () => {
    const original = log.map((e) => e.id);
    eventsForPeriod(log, WEEK_2);
    expect(log.map((e) => e.id)).toEqual(original);
  });
});

describe("chipFor", () => {
  it("gives each scheme its own chip", () => {
    expect(chipFor("block").label).toBe("Block");
    expect(chipFor("steal").label).toBe("Steal");
    expect(chipFor("redraw").label).toBe("Redraw");
    expect(chipFor("block").cls).not.toBe(chipFor("steal").cls);
    expect(chipFor("steal").cls).not.toBe(chipFor("redraw").cls);
  });

  it("covers every type the engine actually writes", () => {
    /* Lifted from the engine: schemes.js writes the first four, standings.js the rest,
     * and autoCycle marks its own as `auto`. A type with no chip still renders - the
     * row just loses the colour that makes the list scannable - so this is the list to
     * extend when a new event type is added. */
    const written = [
      "steal", "steal-failed", "redraw", "block",
      "result", "warning", "playoffs-start", "advance", "champion", "auto",
    ];
    for (const type of written) {
      expect(chipFor(type), "no chip for event type '" + type + "'").toBeTruthy();
    }
  });

  it("returns null for a type it does not know, rather than inventing one", () => {
    expect(chipFor("something-new")).toBe(null);
  });
});

describe("mentionsTeam", () => {
  const entry = ev("a", "steal", "Pocket Aces stole WR X from Full House Flyers.", WEEK_1);

  it("marks a row that names your team", () => {
    expect(mentionsTeam(entry, "Pocket Aces")).toBe(true);
    /* The victim's row is yours too - being robbed is the half you most want to see. */
    expect(mentionsTeam(entry, "Full House Flyers")).toBe(true);
  });

  it("leaves rows that do not name you alone", () => {
    expect(mentionsTeam(entry, "Gridiron Gamblers")).toBe(false);
  });

  it("is safely false with no team, no entry, or no text", () => {
    expect(mentionsTeam(entry, null)).toBe(false);
    expect(mentionsTeam(null, "Pocket Aces")).toBe(false);
    expect(mentionsTeam({ id: "x", type: "auto" }, "Pocket Aces")).toBe(false);
  });
});
