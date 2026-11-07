import { describe, it, expect } from "vitest";

import { computeWpStatus, deriveIssuerStatus } from "../../src/normalize/status.js";

const NOW = new Date("2026-11-07T00:00:00Z");

// ---------------------------------------------------------------------------
// computeWpStatus
// ---------------------------------------------------------------------------

describe("computeWpStatus", () => {
  it("returns authorised when auth date present and no end date", () => {
    expect(computeWpStatus("2023-10-13", null, NOW)).toBe("authorised");
  });

  it("returns authorised when end date is in the future", () => {
    expect(computeWpStatus("2023-10-13", "2030-01-01", NOW)).toBe("authorised");
  });

  it("returns withdrawn when end date is in the past", () => {
    expect(computeWpStatus("2023-10-13", "2024-01-01", NOW)).toBe("withdrawn");
  });

  it("returns withdrawn when end date equals today", () => {
    expect(computeWpStatus("2023-10-13", "2026-11-07", NOW)).toBe("withdrawn");
  });

  it("returns authorisation_date_missing when auth date is null (Quantoz case)", () => {
    expect(computeWpStatus(null, null, NOW)).toBe("authorisation_date_missing");
  });
});

// ---------------------------------------------------------------------------
// deriveIssuerStatus
// ---------------------------------------------------------------------------

describe("deriveIssuerStatus", () => {
  it("returns authorised when all whitepapers are authorised", () => {
    expect(deriveIssuerStatus(["authorised", "authorised"])).toBe("authorised");
  });

  it("returns withdrawn if any whitepaper is withdrawn", () => {
    expect(deriveIssuerStatus(["authorised", "withdrawn"])).toBe("withdrawn");
  });

  it("returns authorised if at least one is authorised (others date_missing)", () => {
    // Quantoz: 3 authorised + 3 authorisation_date_missing → authorised
    expect(
      deriveIssuerStatus([
        "authorised",
        "authorised",
        "authorised",
        "authorisation_date_missing",
        "authorisation_date_missing",
        "authorisation_date_missing",
      ])
    ).toBe("authorised");
  });

  it("returns authorisation_date_missing when all whitepapers have missing date", () => {
    expect(deriveIssuerStatus(["authorisation_date_missing", "authorisation_date_missing"])).toBe(
      "authorisation_date_missing"
    );
  });

  it("withdrawn beats authorisation_date_missing", () => {
    expect(deriveIssuerStatus(["withdrawn", "authorisation_date_missing"])).toBe("withdrawn");
  });
});
