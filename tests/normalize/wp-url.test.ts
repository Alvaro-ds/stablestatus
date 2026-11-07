import { describe, it, expect } from "vitest";

import { extractTickerHint, normalizeWpUrl } from "../../src/normalize/wp-url.js";

// ---------------------------------------------------------------------------
// normalizeWpUrl
// ---------------------------------------------------------------------------

describe("normalizeWpUrl", () => {
  it("returns wpType url with lowercased host for a normal URL", () => {
    const r = normalizeWpUrl("https://www.Circle.com/fr/legal/mica-eurc-whitepaper");
    expect(r.wpType).toBe("url");
    expect(r.wpUrl).toMatch(/^https:\/\/www\.circle\.com\//);
  });

  it("preserves path as-is (only host is lowercased)", () => {
    const r = normalizeWpUrl("https://SG.example.com/Path/To/WP");
    expect(r.wpUrl).toBe("https://sg.example.com/Path/To/WP");
  });

  it("handles EMT_NO_WP", () => {
    const r = normalizeWpUrl("EMT_NO_WP");
    expect(r.wpType).toBe("EMT_NO_WP");
    expect(r.wpUrl).toBeNull();
  });

  it("handles EMT_CRIN", () => {
    const r = normalizeWpUrl("EMT_CRIN");
    expect(r.wpType).toBe("EMT_CRIN");
    expect(r.wpUrl).toBeNull();
  });

  it("trims whitespace before classifying", () => {
    expect(normalizeWpUrl("  EMT_NO_WP  ").wpType).toBe("EMT_NO_WP");
  });
});

// ---------------------------------------------------------------------------
// extractTickerHint
// ---------------------------------------------------------------------------

describe("extractTickerHint", () => {
  it("extracts plain ticker from AllUnity style comments", () => {
    expect(extractTickerHint("EURAU")).toBe("EURAU");
    expect(extractTickerHint("CHFAU")).toBe("CHFAU");
  });

  it("extracts ticker followed by version suffix", () => {
    expect(extractTickerHint("CHFAU, V1.2")).toBe("CHFAU");
    expect(extractTickerHint("USDAU, V.1.0")).toBe("USDAU");
  });

  it("extracts ticker followed by descriptive text", () => {
    expect(extractTickerHint("ENEUR white paper")).toBe("ENEUR");
    expect(extractTickerHint("EURQ white paper")).toBe("EURQ");
    expect(extractTickerHint("USDQ white paper")).toBe("USDQ");
  });

  it("extracts 4-char tickers (GBPQ, RONQ)", () => {
    expect(extractTickerHint("GBPQ white paper")).toBe("GBPQ");
    expect(extractTickerHint("RONQ white paper")).toBe("RONQ");
  });

  it("returns null for EMT prefix — 3 chars is too short", () => {
    // 'EMT is issued...' starts with EMT (3 chars) → null by 4-char rule
    expect(extractTickerHint("EMT is issued under the limited network exception.")).toBeNull();
  });

  it("returns null for prose comments", () => {
    expect(extractTickerHint("No comment. Ongoing additional review...")).toBeNull();
    expect(extractTickerHint("machine-readable version made available")).toBeNull();
    expect(extractTickerHint("Added the functionality to use USDG on X layer")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractTickerHint("")).toBeNull();
  });
});
