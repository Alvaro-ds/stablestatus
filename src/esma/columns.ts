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
  "ac_authorisationEndDate",
  "ae_exemption48_4",
  "ae_exemption48_5",
  "ae_authorisation_other_emt",
  "ae_DTI_FFG",
  "ae_DTI",
  "wp_url",
  "wp_authorisationNotificationDate",
  "wp_comments",
  "wp_lastupdate",
] as const;

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
  "ae_credit_institution",
  "wp_url",
  "wp_authorisationNotificationDate",
  "wp_url_cou",
  "wp_comments",
  "wp_lastupdate",
] as const;

export type EmtwpColumn = (typeof EMTWP_COLUMNS)[number];
export type ArtzzColumn = (typeof ARTZZ_COLUMNS)[number];
export type FileType = "EMTWP" | "ARTZZ";

export const COLUMNS_BY_TYPE: Record<FileType, readonly string[]> = {
  EMTWP: EMTWP_COLUMNS,
  ARTZZ: ARTZZ_COLUMNS,
};
