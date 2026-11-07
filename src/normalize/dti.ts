// GR8.money (LEI 6488GKH17O8XT1326F66) has ae_DTI_FFG and ae_DTI swapped in
// the ESMA register. Detected via DTIF lookup (unavailable in Phase 1), so
// hardcoded here until DTIF integration lands in a later phase.
const KNOWN_SWAPPED_LEIS = new Set(["6488GKH17O8XT1326F66"]);

const DTI_REGEX = /\b[0-9A-Z]{9}\b/g;

export interface DtiResult {
  dtis: string[];
  ffg: string | null;
  quality: string[];
}

/** Extracts DTI tokens from a raw ae_DTI field value. */
export function extractDtis(raw: string): string[] {
  const tokens = [...new Set(raw.match(DTI_REGEX) ?? [])];
  return tokens.sort();
}

/** Normalises DTI + FFG fields for one row, detecting the GR8.money swap. */
export function normalizeDtis(dtiFFGRaw: string, dtiRaw: string, lei: string): DtiResult {
  if (KNOWN_SWAPPED_LEIS.has(lei)) {
    // For GR8.money the columns are swapped: ae_DTI_FFG holds the real DTI,
    // ae_DTI holds the real FFG.
    const ffgTokens = extractDtis(dtiRaw);
    return {
      dtis: extractDtis(dtiFFGRaw),
      ffg: ffgTokens[0] ?? null,
      quality: ["dti_ffg_swapped"],
    };
  }

  const ffgTokens = extractDtis(dtiFFGRaw);
  return {
    dtis: extractDtis(dtiRaw),
    ffg: ffgTokens[0] ?? null,
    quality: [],
  };
}
