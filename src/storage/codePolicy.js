/* What makes a valid join or commissioner code, and how codes are normalized.
 *
 * WHY THIS IS ITS OWN FILE, IN src/ RATHER THAN server/. Three places need to agree
 * about this and cannot be allowed to drift:
 *
 *   - server/auth.js hashes codes, and must normalize identically at hash time and at
 *     verify time or a code will simply stop working;
 *   - server/operations.js rejects a bad code on set;
 *   - the in-memory adapter and the commissioner UI, in the browser, which must not
 *     accept a code the deployed server would refuse.
 *
 * server/ may import from src/; src/ may NEVER import from server/, which holds the
 * secret key (tests/bundle.test.js fails if it ever does). So the shared rule lives on
 * this side of the boundary. There is nothing secret in it - it is a length and a
 * character range - and having one copy is worth more than the tidiness of two.
 */

export const CODE_POLICY = { minLength: 8, maxLength: 64 };

/* Codes are shared, spoken aloud and typed on phones. Trim and case-fold so
 * "demo-commish " logs in the same as "DEMO-COMMISH". This is a usability decision, and
 * it is applied identically at hash time, at verify time and at validation time - which
 * is the entire reason it lives in one place. */
export function normalizeCode(code) {
  return String(code ?? "").trim().toUpperCase();
}

/**
 * @returns {string|null} a message fit to show a commissioner, or null if the code is fine.
 */
export function validateCode(code) {
  if (typeof code !== "string") return "A code is required.";
  // Validate what will actually be STORED. Validating the raw string would let
  // "  ab  " pass an 8-character rule and then be hashed as a 2-character code.
  const normalized = normalizeCode(code);
  if (normalized.length === 0) return "A code is required.";
  if (normalized.length < CODE_POLICY.minLength) {
    return "Codes must be at least " + CODE_POLICY.minLength + " characters.";
  }
  if (normalized.length > CODE_POLICY.maxLength) {
    return "Codes must be at most " + CODE_POLICY.maxLength + " characters.";
  }
  /* Printable ASCII only (0x20 space .. 0x7E tilde), and this is not pedantry: these
   * codes get spoken aloud, texted, and retyped on phone keyboards. A code holding a
   * non-breaking space or a smart quote is one the recipient cannot type, and the
   * failure looks exactly like a wrong code.
   *
   * Built from code points rather than a literal character class, per the ASCII-source
   * rule in CLAUDE.md. */
  for (const ch of normalized) {
    const cp = ch.codePointAt(0);
    if (cp < 0x20 || cp > 0x7e) {
      return "Codes can only use ordinary keyboard characters - no accents, emoji or curly quotes.";
    }
  }
  return null;
}

/** The rule as a single line, for the UI to state inline rather than only enforce. */
export const CODE_RULE_HINT =
  "At least " + CODE_POLICY.minLength + " characters, ordinary keyboard characters only.";
