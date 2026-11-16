/**
 * Your Colors (Scott, 2026-11-16) - the Full Season colour picker.
 *
 * The list lives in src/components/colorSchemes.jsx and the colours in global.css, so the
 * one thing that can quietly go wrong is the two drifting apart: a scheme in the picker
 * with no CSS block shows Pylon Orange and says it is something else. These pin them
 * together, pin the default, and pin the injury tags to fixed colours in every scheme.
 */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLOR_SCHEMES, DEFAULT_COLOR_SCHEME, colorSchemeClasses, findColorScheme } from "../src/components/colorSchemes.jsx";
import { readColorScheme, saveColorScheme } from "../src/storage/colorScheme.js";

const CSS = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "global.css"),
  "utf8"
);

describe("colour schemes", () => {
  it("offers ten, with Pylon Orange as the default", () => {
    expect(COLOR_SCHEMES).toHaveLength(10);
    expect(DEFAULT_COLOR_SCHEME).toBe("pylon");
    expect(new Set(COLOR_SCHEMES.map((s) => s.id)).size).toBe(10);
  });

  it("has a CSS block for every scheme except the default", () => {
    for (const s of COLOR_SCHEMES) {
      if (s.id === DEFAULT_COLOR_SCHEME) continue;
      expect(CSS, s.id).toContain(".pp-root.sn-theme.sn-c-" + s.id + "{");
    }
  });

  it("adds no class for the default, and the light class only to light schemes", () => {
    expect(colorSchemeClasses("pylon")).toBe("");
    expect(colorSchemeClasses(null)).toBe("");
    expect(colorSchemeClasses("midnight")).toBe(" sn-c-midnight");
    expect(colorSchemeClasses("game-day")).toBe(" sn-c-game-day sn-light");
  });

  it("falls back to the default for an id that no longer exists", () => {
    expect(findColorScheme("a-removed-scheme").id).toBe("pylon");
    expect(colorSchemeClasses("a-removed-scheme")).toBe("");
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

  it("round-trips, and clears", () => {
    expect(readColorScheme()).toBe(null);
    saveColorScheme("snow-day");
    expect(readColorScheme()).toBe("snow-day");
    saveColorScheme(null);
    expect(readColorScheme()).toBe(null);
  });

  it("survives storage that throws", () => {
    globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    expect(readColorScheme()).toBe(null);
    expect(() => saveColorScheme("midnight")).not.toThrow();
  });
});
