/**
 * Column definitions for the ESMA interim MiCA register CSV files.
 *
 * Column order matters: parseEsmaCsv rejects the file with EsmaSchemaChangedError
 * if ESMA adds, removes, or reorders columns — better a loud failure than silent data corruption.
 *
 * EMTWP and ARTZZ share most columns but diverge in the authorisation-specific fields:
 *   - EMTWP has DTI/FFG columns and EMT-specific exemption flags.
 *   - ARTZZ has ae_credit_institution and wp_url_cou instead.
 */

// ---------------------------------------------------------------------------
// EMTWP — E-money Token White Papers
// One row per white paper; ae_lei is the stable key (not the name).
// ---------------------------------------------------------------------------

export const EMTWP_COLUMNS = [
  "ae_competentAuthority",
  "ae_homeMemberState",
  "ae_lei_name",
  "ae_lei",
  "ae_lei_cou_code",
  "ae_commercial_name",
  "ae_address",
  "ae_website",
  "ac_authorisationNotificationDate",
  "ac_authorisationEndDate", // non-empty = authorisation has ended; critical field
  "ae_exemption48_4",
  "ae_exemption48_5",
  "ae_authorisation_other_emt",
  "ae_DTI_FFG",
  "ae_DTI", // mixed separators; extract tokens with /\b[0-9A-Z]{9}\b/g
  "wp_url", // may be "EMT_NO_WP" or "EMT_CRIN"
  "wp_authorisationNotificationDate",
  "wp_comments",
  "wp_lastupdate",
] as const;

// ---------------------------------------------------------------------------
// ARTZZ — Asset-Referenced Tokens
// Same structure as EMTWP but with ART-specific fields.
// ---------------------------------------------------------------------------

export const ARTZZ_COLUMNS = [
  "ae_competentAuthority",
  "ae_homeMemberState",
  "ae_lei_name",
  "ae_lei",
  "ae_lei_cou_code",
  "ae_commercial_name",
  "ae_address",
  "ae_website",
  "ac_authorisationNotificationDate",
  "ac_authorisationEndDate",
  "ae_credit_institution", // present in ARTZZ, absent in EMTWP
  "wp_url",
  "wp_authorisationNotificationDate",
  "wp_url_cou", // present in ARTZZ, absent in EMTWP
  "wp_comments",
  "wp_lastupdate",
] as const;

// ---------------------------------------------------------------------------
// Derived types and lookup
// ---------------------------------------------------------------------------

export type EmtwpColumn = (typeof EMTWP_COLUMNS)[number];
export type ArtzzColumn = (typeof ARTZZ_COLUMNS)[number];
export type FileType = "EMTWP" | "ARTZZ";

export const COLUMNS_BY_TYPE: Record<FileType, readonly string[]> = {
  EMTWP: EMTWP_COLUMNS,
  ARTZZ: ARTZZ_COLUMNS,
};
