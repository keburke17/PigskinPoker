/**
 * Guards against JS-template-literal escapes leaking into the real stylesheet.
 *
 * GLOBAL_CSS originally lived inside a JS template literal, where a CSS unicode escape
 * had to be written with a DOUBLE backslash ("\\2666") to survive JS string parsing.
 * Copied verbatim into a .css file, that same text is an escaped backslash followed by
 * literal digits - so every rule bullet rendered as `\2666` instead of a diamond.
 *
 * The extraction was "byte-for-byte identical", which was true and still wrong: the
 * bytes needed unescaping when they moved out of JavaScript. Cheap to assert, and the
 * failure is purely visual so no other test would catch it.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CSS = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "global.css"),
  "utf8"
);

/* Ignore the header comment, which describes the problem and necessarily contains
 * examples of the very pattern being banned. */
const body = CSS.replace(/^\/\*[\s\S]*?\*\//, "");

describe("global.css", () => {
  it("has no double-backslash escapes left over from the template literal", () => {
    const offenders = body.split("\n").filter((l) => l.includes("\\\\"));
    expect(offenders).toEqual([]);
  });

  it("has no template-literal interpolation or escaped backticks", () => {
    expect(body).not.toMatch(/\$\{/);
    expect(body).not.toMatch(/\\`/);
  });

  it("still renders the rule bullet as a real unicode escape", () => {
    // Single backslash + 2666 = the diamond the rules list uses.
    expect(body).toMatch(/content:"\\2666"/);
  });
});
