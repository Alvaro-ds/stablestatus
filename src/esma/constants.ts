/**
 * ESMA interim MiCA register CSV files.
 * Source page: https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica
 * Section: "Interim MiCA Register".
 */
export const ESMA_URLS = {
  /** E-money Token White Papers — one row per white paper, ~25 issuers as of Oct 2026. */
  EMTWP: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv" as const,
  /** Asset-Referenced Token register — currently header-only (no ARTs authorised yet). */
  ARTZZ: "https://www.esma.europa.eu/sites/default/files/2024-12/ARTZZ.csv" as const,
} as const;

/** Sent on every request so ESMA can identify the crawler. */
export const USER_AGENT = "StableStatus-ingest/0.1 (+https://github.com/Alvaro-ds/stablestatus)";

// Retry / timeout settings for fetchEsmaCsv.
export const FETCH_MAX_ATTEMPTS = 3;
export const FETCH_BASE_DELAY_MS = 1_000;
export const FETCH_TIMEOUT_MS = 30_000;
