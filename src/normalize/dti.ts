const GR8_LEI = "6488GKH17O8XT1326F66";

// Exact raw-value pairs observed in the 2026-10-30 fixture where GR8.money's
// ae_DTI_FFG and ae_DTI columns are definitively swapped. If ESMA corrects
// those rows the values will no longer match and the pipeline will flag them
// for review instead of silently re-swapping corrected data.
const GR8_KNOWN_SWAP_PAIRS = new Set(["9JDH8QBV2|5X779H3M3", "FFBSF3LWN|PJM1C1PM6"]);

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
  if (lei === GR8_LEI) {
    const pairKey = `${dtiFFGRaw.trim()}|${dtiRaw.trim()}`;
    if (GR8_KNOWN_SWAP_PAIRS.has(pairKey)) {
      // ae_DTI_FFG holds the real DTI; ae_DTI holds the real FFG.
      const ffgTokens = extractDtis(dtiRaw);
      return {
        dtis: extractDtis(dtiFFGRaw),
        ffg: ffgTokens[0] ?? null,
        quality: ["dti_ffg_swapped"],
      };
    }
    // GR8 LEI but unknown values — ESMA may have corrected the row.
    // Fall through with normal logic and flag for manual review.
    const ffgTokens = extractDtis(dtiFFGRaw);
    return {
      dtis: extractDtis(dtiRaw),
      ffg: ffgTokens[0] ?? null,
      quality: ["dti_ffg_check_needed"],
    };
  }

  const ffgTokens = extractDtis(dtiFFGRaw);
  return {
    dtis: extractDtis(dtiRaw),
    ffg: ffgTokens[0] ?? null,
    quality: [],
  };
}
