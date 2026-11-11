import { z } from "zod";

import { SourceTypeSchema } from "./evidence.js";

/** Disagreements between ESMA and another official source. See ADR 0003 §D1. */
export const DiscrepancyKindSchema = z.enum([
  "date_mismatch",
  "name_mismatch",
  "country_mismatch",
  "authority_mismatch",
  "status_mismatch",
  "missing_in_nca",
  "missing_in_esma",
]);

export const DiscrepancySchema = z.object({
  kind: DiscrepancyKindSchema,
  field: z.string(),
  esmaValue: z.string().nullable(),
  otherValue: z.string().nullable(),
  otherSourceType: SourceTypeSchema,
  otherSourceUrl: z.url(),
  evidenceId: z.string().regex(/^[0-9a-f]{64}$/),
});

export type DiscrepancyKind = z.infer<typeof DiscrepancyKindSchema>;
export type Discrepancy = z.infer<typeof DiscrepancySchema>;
