import { describe, it, expect } from "vitest";

import { extractDtis, normalizeDtis } from "../../src/normalize/dti.js";

// ---------------------------------------------------------------------------
// extractDtis
// ---------------------------------------------------------------------------

describe("extractDtis", () => {
  it("extracts a single DTI token", () => {
    expect(extractDtis("TD3BGWM5Z")).toEqual(["TD3BGWM5Z"]);
  });

  it("extracts multiple tokens separated by pipe", () => {
    const result = extractDtis("81PTSP744|JVM0S87GB|3P9X6K6P2");
    expect(result).toEqual(["3P9X6K6P2", "81PTSP744", "JVM0S87GB"]); // sorted
  });

  it("ignores double-pipe — no empty token generated (Monerium case)", () => {
    // Raw from fixture: "81PTSP744|JVM0S87GB||3P9X6K6P2|..."
    const result = extractDtis("81PTSP744|JVM0S87GB||3P9X6K6P2|S45L7172C|ZHKQJ78VZ|6KL7TK20G|5LN265K07");
    expect(result.every((t) => t.length === 9)).toBe(true);
    expect(result).toHaveLength(7);
  });

  it("extracts tokens mixed with chain names (Bridge Building case)", () => {
    const raw = "TD3BGWM5Z (Ethereum)\n\tLP00X1Q54 (Arbitrum)\n\t9J1RXQWBK (Polygon)";
    const result = extractDtis(raw);
    expect(result).toContain("TD3BGWM5Z");
    expect(result).toContain("LP00X1Q54");
    expect(result).toContain("9J1RXQWBK");
  });

  it("extracts 8 unique DTIs from Bridge Building raw field", () => {
    const raw =
      "TD3BGWM5Z (Ethereum)\n\tLP00X1Q54 (Arbitrum)\n\t9J1RXQWBK (Polygon)\n\tGR77N4VQN (Solana)\n\tR79DN2VHD (Avalanche)\n\t8KV3CMVM5 (Optimism)\n\tKHWWMMF9T (TON)\nH81G32M97 (Injective)";
    expect(extractDtis(raw)).toHaveLength(8);
  });

  it("returns empty array for n/a", () => {
    expect(extractDtis("n/a")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(extractDtis("")).toEqual([]);
  });

  it("deduplicates repeated tokens", () => {
    expect(extractDtis("TD3BGWM5Z|TD3BGWM5Z")).toEqual(["TD3BGWM5Z"]);
  });
});

// ---------------------------------------------------------------------------
// normalizeDtis — normal rows
// ---------------------------------------------------------------------------

describe("normalizeDtis — normal rows", () => {
  it("extracts DTIs from ae_DTI and FFG from ae_DTI_FFG", () => {
    const result = normalizeDtis("N7B1L2FBK", "81PTSP744|JVM0S87GB", "2549003QDNZWASSSCY31");
    expect(result.ffg).toBe("N7B1L2FBK");
    expect(result.dtis).toContain("81PTSP744");
    expect(result.dtis).toContain("JVM0S87GB");
    expect(result.quality).toEqual([]);
  });

  it("sets ffg null when ae_DTI_FFG is empty", () => {
    const result = normalizeDtis("", "TD3BGWM5Z", "SOME00000000000000LEI01");
    expect(result.ffg).toBeNull();
    expect(result.dtis).toEqual(["TD3BGWM5Z"]);
    expect(result.quality).toEqual([]);
  });

  it("sets dtis empty when ae_DTI is n/a", () => {
    const result = normalizeDtis("N7B1L2FBK", "n/a", "SOME00000000000000LEI01");
    expect(result.dtis).toEqual([]);
    expect(result.ffg).toBe("N7B1L2FBK");
  });
});

// ---------------------------------------------------------------------------
// normalizeDtis — GR8.money swap (LEI 6488GKH17O8XT1326F66)
// ---------------------------------------------------------------------------

describe("normalizeDtis — GR8.money DTI/FFG swap", () => {
  const GR8_LEI = "6488GKH17O8XT1326F66";

  it("swaps DTI and FFG for GR8.money row 1", () => {
    // Raw: ae_DTI_FFG=9JDH8QBV2 (actually the DTI), ae_DTI=5X779H3M3 (actually the FFG)
    const result = normalizeDtis("9JDH8QBV2", "5X779H3M3", GR8_LEI);
    expect(result.dtis).toEqual(["9JDH8QBV2"]); // ae_DTI_FFG value is the real DTI
    expect(result.ffg).toBe("5X779H3M3"); // ae_DTI value is the real FFG
    expect(result.quality).toContain("dti_ffg_swapped");
  });

  it("swaps DTI and FFG for GR8.money row 2", () => {
    const result = normalizeDtis("FFBSF3LWN", "PJM1C1PM6", GR8_LEI);
    expect(result.dtis).toEqual(["FFBSF3LWN"]);
    expect(result.ffg).toBe("PJM1C1PM6");
    expect(result.quality).toContain("dti_ffg_swapped");
  });

  it("does NOT flag swap for other issuers with the same values", () => {
    const result = normalizeDtis("9JDH8QBV2", "5X779H3M3", "DIFFERENT00000000000LEI1");
    expect(result.quality).not.toContain("dti_ffg_swapped");
  });

  it("does NOT swap when GR8 LEI has unknown values — flags dti_ffg_check_needed instead", () => {
    // Simulates ESMA correcting the row: values no longer match the known pair.
    // Uses 9-char tokens to pass the DTI regex /\b[0-9A-Z]{9}\b/g.
    const result = normalizeDtis("NEWFFG001", "NEWDTI001", GR8_LEI);
    expect(result.quality).not.toContain("dti_ffg_swapped");
    expect(result.quality).toContain("dti_ffg_check_needed");
    // Values are taken as-is (no swap): ae_DTI_FFG → ffg, ae_DTI → dtis
    expect(result.ffg).toBe("NEWFFG001");
    expect(result.dtis).toEqual(["NEWDTI001"]);
  });

  it("does NOT add check_needed flag for other issuers with unknown values", () => {
    const result = normalizeDtis("SOMEFFG01", "SOMEDTI01", "DIFFERENT00000000000LEI1");
    expect(result.quality).not.toContain("dti_ffg_check_needed");
  });
});
