export const ESMA_URLS = {
  EMTWP:
    "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv" as const,
  ARTZZ:
    "https://www.esma.europa.eu/sites/default/files/2024-12/ARTZZ.csv" as const,
} as const;

export const USER_AGENT =
  "StableStatus-ingest/0.1 (+https://github.com/Alvaro-ds/stablestatus)";

export const FETCH_MAX_ATTEMPTS = 3;
export const FETCH_BASE_DELAY_MS = 1_000;
export const FETCH_TIMEOUT_MS = 30_000;
