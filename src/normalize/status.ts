import type { RegisterStatus } from "../model/index.js";

/** Computes registerStatus for one whitepaper row given its auth dates and now. */
export function computeWpStatus(
  authorisationDate: string | null,
  authorisationEndDate: string | null,
  now: Date,
): RegisterStatus {
  if (authorisationDate === null) return "authorisation_date_missing";

  if (authorisationEndDate !== null) {
    const endDate = new Date(`${authorisationEndDate}T00:00:00Z`);
    if (endDate <= now) return "withdrawn";
  }

  return "authorised";
}

/**
 * Derives issuer registerStatus from its whitepapers' statuses.
 * withdrawn > authorised (≥1 authorised) > authorisation_date_missing (all missing)
 */
export function deriveIssuerStatus(wpStatuses: RegisterStatus[]): RegisterStatus {
  if (wpStatuses.includes("withdrawn")) return "withdrawn";
  if (wpStatuses.includes("authorised")) return "authorised";
  return "authorisation_date_missing";
}
