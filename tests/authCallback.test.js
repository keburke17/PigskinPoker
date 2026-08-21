/**
 * The sign-in loop.
 *
 * THE BUG THIS EXISTS FOR. Tap the link in your email, land back on the sign-in
 * screen, and be asked for your email again. Nothing said, nothing to click but the
 * same box - so you ask for another link, which cancels the one you were about to try,
 * and round you go. It survived because every part of it works: GoTrue issues the
 * link, the redirect is allowed, the app loads. The only thing missing was anyone
 * reading the reason, which arrives in the URL fragment and was being thrown away.
 *
 * These assert the reading. The fragments below are verbatim from a local GoTrue.
 */

import { describe, it, expect } from "vitest";
import {
  parseAuthCallbackError,
  authCallbackErrorMessage,
} from "../src/storage/authCallback.js";

const EXPIRED =
  "http://localhost:5173/#error=access_denied&error_code=otp_expired" +
  "&error_description=Email+link+is+invalid+or+has+expired&sb=";

describe("parseAuthCallbackError", () => {
  it("reads the reason a magic link failed out of the fragment", () => {
    expect(parseAuthCallbackError(EXPIRED)).toEqual({
      code: "otp_expired",
      description: "Email link is invalid or has expired",
    });
  });

  it("reads it out of the query string too - not every flow uses the fragment", () => {
    expect(parseAuthCallbackError("https://x/?error=server_error&error_code=unexpected_failure"))
      .toMatchObject({ code: "unexpected_failure" });
  });

  /* The success case MUST come back null. A link that worked carries an access_token
     and nothing else; mistaking it for a failure would put an error banner in front of
     somebody who had just been signed in successfully. */
  it("says nothing about a link that worked", () => {
    expect(parseAuthCallbackError("http://localhost:5173/#access_token=abc&type=magiclink")).toBe(null);
    expect(parseAuthCallbackError("http://localhost:5173/l/abc")).toBe(null);
    expect(parseAuthCallbackError("")).toBe(null);
    expect(parseAuthCallbackError(null)).toBe(null);
  });

  it("keeps a league path out of the way - the error is in the fragment, not the path", () => {
    const url = "http://localhost:5173/l/8ea81188#error=access_denied&error_code=otp_expired";
    expect(parseAuthCallbackError(url)).toMatchObject({ code: "otp_expired" });
  });
});

describe("authCallbackErrorMessage", () => {
  it("explains an expired or spent link, and says what to do about it", () => {
    const m = authCallbackErrorMessage(parseAuthCallbackError(EXPIRED));
    expect(m.headline).toMatch(/expired|already used/i);
    /* The two things nobody guesses: links are single-use, and asking again cancels
       the last one. Someone stuck in the loop is usually holding an older email. */
    expect(m.detail).toMatch(/once/i);
    expect(m.detail).toMatch(/newest|cancels/i);
  });

  it("still says something useful about a reason it has never seen", () => {
    const m = authCallbackErrorMessage({ code: "some_new_code", description: "Whatever" });
    expect(m.headline).toBeTruthy();
    expect(m.detail).toBe("Whatever");
  });

  it("stays silent when there is nothing wrong", () => {
    expect(authCallbackErrorMessage(null)).toBe(null);
  });
});
