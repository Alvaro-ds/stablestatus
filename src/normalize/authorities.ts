export interface AuthorityResult {
  authorityRaw: string;
  authorityCode: string | null;
  quality: string[];
}

// All authority strings observed in the ESMA register as of Oct 2026,
// including the known "De Nederlansche" typo (missing 'd').
const AUTHORITY_MAP: Record<string, string> = {
  "Autorité de Contrôle Prudentiel et de Resolution (ACPR)": "FR-ACPR",
  "Banco de Portugal (BdP)": "PT-BDP",
  "Bank of Lithuania": "LT-BOL",
  "Bank of Lithuania (LSC)": "LT-BOL",
  "Bank of Slovenia": "SI-BS",
  "Central Bank of Iceland": "IS-CBI",
  "Commission de Surveillance du Secteur Financier (CSSF)": "LU-CSSF",
  "Czech National Bank (CNB)": "CZ-CNB",
  "De Nederlandsche Bank (DNB)": "NL-DNB",
  "De Nederlansche Bank (DNB)": "NL-DNB",
  "Federal Financial Supervisory Authority (BaFin)": "DE-BAFIN",
  "Finanssivalvonta (FIN-FSA)": "FI-FINFSA",
  Finanstilsynet: "DK-FT",
  "Latvijas Banka": "LV-LB",
  "Malta Financial Services Authority": "MT-MFSA",
  "Polish Financial Supervision Authority (KNF)": "PL-KNF",
};

/** Maps ae_competentAuthority to a canonical code, tolerating known typos. */
export function normalizeAuthority(raw: string): AuthorityResult {
  const code = AUTHORITY_MAP[raw] ?? null;
  return {
    authorityRaw: raw,
    authorityCode: code,
    quality: code === null ? ["unknown_authority"] : [],
  };
}
