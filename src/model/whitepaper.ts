import { z } from "zod";

import { ProvenanceSchema } from "./provenance.js";
import { RegisterStatusSchema } from "./register-status.js";

/**
 * One ESMA CSV row normalised into a structured entity.
 * Key: wpKey = lei + ":" + wpUrlNormalized.
 * When multiple rows share the same wpKey, ":rowIndex" is appended to each.
 * See ADR 0002 §D1.
 */
export const WhitePaperSchema = z.object({
  wpKey: z.string(),
  lei: z.string(),

  /** Normalised URL (host lowercased), or null for EMT_NO_WP / EMT_CRIN. */
  wpUrl: z.url().nullable(),
  wpType: z.enum(["url", "EMT_NO_WP", "EMT_CRIN"]),

  /** ISO YYYY-MM-DD from ac_authorisationNotificationDate, or null. */
  authorisationDate: z.iso.date().nullable(),
  /** ISO YYYY-MM-DD from ac_authorisationEndDate, or null. */
  authorisationEndDate: z.iso.date().nullable(),

  /** DTI codes extracted with /\b[0-9A-Z]{9}\b/g, deduped and sorted. */
  dtis: z.array(z.string().regex(/^[0-9A-Z]{9}$/)),
  /** FFG code from ae_DTI_FFG, or null when absent. */
  ffg: z
    .string()
    .regex(/^[0-9A-Z]{9}$/)
    .nullable(),

  /** Extracted from wp_comments by conservative rules. Never a key. */
  tickerHint: z.string().nullable(),

  authorityRaw: z.string(),
  authorityCode: z.string().nullable(),

  registerStatus: RegisterStatusSchema,

  /**
   * Quality flags recorded by normalisation rules, e.g.:
   * "duplicate_row", "dti_ffg_swapped", "unknown_authority"
   */
  quality: z.array(z.string()),

  provenance: ProvenanceSchema,
});

export type WhitePaper = z.infer<typeof WhitePaperSchema>;
