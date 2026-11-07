import { describe, it, expect } from "vitest";

import { normalizeAuthority } from "../../src/normalize/authorities.js";

describe("normalizeAuthority", () => {
  // --- Known mappings ---

  it("maps ACPR", () => {
    const r = normalizeAuthority("Autorité de Contrôle Prudentiel et de Resolution (ACPR)");
    expect(r.authorityCode).toBe("FR-ACPR");
    expect(r.quality).toEqual([]);
  });

  it("maps BaFin", () => {
    const r = normalizeAuthority("Federal Financial Supervisory Authority (BaFin)");
    expect(r.authorityCode).toBe("DE-BAFIN");
  });

  it("maps CSSF (Luxembourg)", () => {
    const r = normalizeAuthority("Commission de Surveillance du Secteur Financier (CSSF)");
    expect(r.authorityCode).toBe("LU-CSSF");
  });

  it("maps correctly-spelled DNB", () => {
    const r = normalizeAuthority("De Nederlandsche Bank (DNB)");
    expect(r.authorityCode).toBe("NL-DNB");
    expect(r.quality).toEqual([]);
  });

  it("maps the DNB errata spelling to the same NL-DNB code", () => {
    // 'De Nederlansche Bank' — missing 'd' — appears in real ESMA fixture
    const r = normalizeAuthority("De Nederlansche Bank (DNB)");
    expect(r.authorityCode).toBe("NL-DNB");
    expect(r.quality).toEqual([]); // errata is a known alias, not flagged as unknown
  });

  it("maps Bank of Lithuania (plain)", () => {
    expect(normalizeAuthority("Bank of Lithuania").authorityCode).toBe("LT-BOL");
  });

  it("maps Bank of Lithuania (LSC) to same code", () => {
    expect(normalizeAuthority("Bank of Lithuania (LSC)").authorityCode).toBe("LT-BOL");
  });

  it("maps Finanstilsynet (Denmark)", () => {
    expect(normalizeAuthority("Finanstilsynet").authorityCode).toBe("DK-FT");
  });

  it("maps Latvijas Banka", () => {
    expect(normalizeAuthority("Latvijas Banka").authorityCode).toBe("LV-LB");
  });

  it("maps Malta Financial Services Authority", () => {
    expect(normalizeAuthority("Malta Financial Services Authority").authorityCode).toBe("MT-MFSA");
  });

  it("maps Polish Financial Supervision Authority (KNF)", () => {
    expect(normalizeAuthority("Polish Financial Supervision Authority (KNF)").authorityCode).toBe(
      "PL-KNF",
    );
  });

  // --- Unknown authority ---

  it("returns authorityCode null for unknown authority", () => {
    const r = normalizeAuthority("Some Unknown Regulator");
    expect(r.authorityCode).toBeNull();
    expect(r.quality).toContain("unknown_authority");
  });

  it("preserves the raw authority string", () => {
    const raw = "De Nederlansche Bank (DNB)";
    expect(normalizeAuthority(raw).authorityRaw).toBe(raw);
  });
});
