/**
 * BUNDLE SAFETY.
 *
 * "Holding the publishable key gets you nothing you couldn't get through the UI" is a
 * claim about what ships to the browser. This is what makes it checkable.
 *
 * The secret key bypasses RLS entirely, so the single most damaging mistake available
 * in this project is letting it reach the client bundle - which Vite will do happily
 * and silently for anything prefixed VITE_. Server code lives OUTSIDE src/ so it
 * cannot be pulled in by an import, and this test proves the result.
 *
 * Builds the app if dist/ is missing, so it is meaningful on a clean checkout.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist", "assets");

let bundle = "";

beforeAll(() => {
  if (!fs.existsSync(DIST)) {
    execSync("npx vite build", { cwd: ROOT, stdio: "ignore" });
  }
  bundle = fs
    .readdirSync(DIST)
    .filter((f) => f.endsWith(".js"))
    .map((f) => fs.readFileSync(path.join(DIST, f), "utf8"))
    .join("\n");
  expect(bundle.length).toBeGreaterThan(1000); // sanity: we really read a bundle
}, 120000);

describe("the client bundle", () => {
  it("contains no actual secret key", () => {
    // A real key is the prefix followed by key material. supabase-js contains the bare
    // prefix as a string literal for its own format detection, which is harmless - so
    // match only a prefix that is actually followed by a key.
    expect(bundle).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}/);
  });

  it("never references the secret environment variable", () => {
    expect(bundle).not.toContain("SUPABASE_SECRET_KEY");
  });

  it("does not pull in the server-side modules", () => {
    // These names only exist in server/, which src/ must never import.
    for (const marker of ["createSecretClient", "verifySession", "createSession", "scryptSync"]) {
      expect(bundle).not.toContain(marker);
    }
  });

  it("contains no scrypt hash material from the seed", () => {
    expect(bundle).not.toMatch(/scrypt\$\d+\$\d+\$\d+\$[0-9a-f]{16,}/);
  });

  it("does not embed the demo join codes as verifiable secrets", () => {
    // The demo league ships in the bundle by design (it is the no-backend dev mode),
    // so the codes appear - but they are obviously-fake local credentials, and this
    // asserts they are the ONLY thing code-shaped in there.
    const realish = bundle.match(/[A-Z0-9]{20,}-[A-Z0-9]{20,}/g) || [];
    expect(realish).toEqual([]);
  });

  it("src/ contains no import of the server directory", () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(js|jsx)$/.test(entry.name)) {
          const text = fs.readFileSync(p, "utf8");
          if (/from\s+["'][^"']*\/server\//.test(text) || /from\s+["']\.\.\/\.\.\/server/.test(text)) {
            offenders.push(path.relative(ROOT, p));
          }
        }
      }
    };
    walk(path.join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });
});
