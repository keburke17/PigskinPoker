/**
 * Your Colors (Scott, 2026-11-16) - the colour picker for both poker games.
 *
 * The list lives in src/components/colorSchemes.jsx and the colours in global.css, so the
 * one thing that can quietly go wrong is the two drifting apart: a scheme in the picker
 * with no CSS block shows the default and says it is something else. These pin them
 * together, pin each game's default, and pin the injury tags to fixed colours.
 */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLOR_SCHEMES, DEFAULT_COLOR_SCHEME, PARKED_COLOR_SCHEMES, colorSchemeClasses, findColorScheme } from "../src/components/colorSchemes.jsx";
import { readColorScheme, saveColorScheme } from "../src/storage/colorScheme.js";

const CSS = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "global.css"),
  "utf8"
);

describe("colour schemes", () => {
  it("offers nine, and both games open in the Classic Felt", () => {
    expect(COLOR_SCHEMES).toHaveLength(9);
    expect(new Set(COLOR_SCHEMES.map((s) => s.id)).size).toBe(9);
    expect(DEFAULT_COLOR_SCHEME).toEqual({ season: "felt", weekly: "felt" });
  });

  it("has a CSS block for every scheme except the two built-in looks - parked ones too", () => {
    for (const s of [...COLOR_SCHEMES, ...PARKED_COLOR_SCHEMES]) {
      if (s.id === "felt" || s.id === "pylon") continue;
      expect(CSS, s.id).toContain(".pp-root.sn-theme.sn-c-" + s.id + "{");
    }
  });

  it("does not offer a parked scheme, and draws the felt for one saved before it was parked", () => {
    const offered = new Set(COLOR_SCHEMES.map((s) => s.id));
    for (const s of PARKED_COLOR_SCHEMES) {
      expect(offered.has(s.id), s.id).toBe(false);
      expect(colorSchemeClasses(s.id, "season")).toBe("");
    }
  });

  it("draws an unpicked league of either game in the felt", () => {
    expect(colorSchemeClasses(null, "season")).toBe("");
    expect(colorSchemeClasses(null, "weekly")).toBe("");
  });

  it("lets either game wear Pylon Orange or the felt", () => {
    expect(colorSchemeClasses("felt", "season")).toBe("");
    expect(colorSchemeClasses("pylon", "weekly")).toBe(" sn-theme");
  });

  it("builds every other scheme on sn-theme, and marks the light ones", () => {
    expect(colorSchemeClasses("midnight", "weekly")).toBe(" sn-theme sn-c-midnight");
    expect(colorSchemeClasses("game-day", "season")).toBe(" sn-theme sn-c-game-day sn-light");
  });

  it("falls back to the game's default for an id that no longer exists", () => {
    expect(findColorScheme("a-removed-scheme", "season").id).toBe("felt");
    expect(findColorScheme("a-removed-scheme", "weekly").id).toBe("felt");
  });

  it("keeps the injury tags off the accent, so no scheme can recolour QUES", () => {
    expect(CSS).toMatch(/\.pp-inj-ques\{ background:#e8c25a;/);
    expect(CSS).not.toMatch(/\.pp-inj-ques\{[^}]*var\(--gold\)/);
    expect(CSS).not.toMatch(/\.sn-theme \.pp-inj-ques/);
  });
});

describe("the saved choice", () => {
  let store;
  beforeEach(() => {
    store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
  });

  it("is kept separately for each game, and clears", () => {
    expect(readColorScheme("season")).toBe(null);
    saveColorScheme("season", "snow-day");
    saveColorScheme("weekly", "blackout");
    expect(readColorScheme("season")).toBe("snow-day");
    expect(readColorScheme("weekly")).toBe("blackout");
    saveColorScheme("season", null);
    expect(readColorScheme("season")).toBe(null);
    expect(readColorScheme("weekly")).toBe("blackout");
  });

  it("survives storage that throws", () => {
    globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    expect(readColorScheme("weekly")).toBe(null);
    expect(() => saveColorScheme("weekly", "midnight")).not.toThrow();
  });
});
