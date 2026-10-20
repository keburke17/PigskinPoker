import { describe, expect, it } from "vitest";
import { shortPlayerName } from "../src/engine/index.js";

describe("shortPlayerName - first initial and the whole surname", () => {
  it("shortens an ordinary name", () => {
    expect(shortPlayerName("Jared Goff")).toBe("J. Goff");
    expect(shortPlayerName("Christian McCaffrey")).toBe("C. McCaffrey");
  });

  it("keeps every word after the first as the surname", () => {
    expect(shortPlayerName("Amon-Ra St. Brown")).toBe("A. St. Brown");
    expect(shortPlayerName("Marvin Harrison Jr.")).toBe("M. Harrison Jr.");
    expect(shortPlayerName("Jaxon Smith-Njigba")).toBe("J. Smith-Njigba");
  });

  it("leaves a first name that is already initials alone", () => {
    expect(shortPlayerName("A.J. Brown")).toBe("A.J. Brown");
    expect(shortPlayerName("DK Metcalf")).toBe("DK Metcalf");
    expect(shortPlayerName("CeeDee Lamb")).toBe("C. Lamb");
  });

  it("leaves a one-word or empty name as it is", () => {
    expect(shortPlayerName("Taysom")).toBe("Taysom");
    expect(shortPlayerName("")).toBe("");
    expect(shortPlayerName(null)).toBe("");
  });
});
