import { describe, it, expect } from "vitest";

import { parseEsmaDate } from "../../src/normalize/dates.js";

describe("parseEsmaDate", () => {
  it("converts dd/mm/yyyy to YYYY-MM-DD", () => {
    expect(parseEsmaDate("13/10/2023")).toBe("2023-10-13");
  });

  it("converts a date with leading zeros", () => {
    expect(parseEsmaDate("01/01/2025")).toBe("2025-01-01");
  });

  it("returns null for empty string", () => {
    expect(parseEsmaDate("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseEsmaDate("   ")).toBeNull();
  });

  it("throws for an invalid format", () => {
    expect(() => parseEsmaDate("2025-10-13")).toThrow();
  });

  it("throws for a partial date", () => {
    expect(() => parseEsmaDate("13/10")).toThrow();
  });
});
