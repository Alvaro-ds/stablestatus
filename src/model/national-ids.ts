import { z } from "zod";

import { LeiSchema } from "./evidence.js";

/**
 * One national ID checked by hand in an official register, used to find an issuer in a
 * source that has no LEI (ADR 0003 §D5). Never derived from a name.
 */
export const NationalIdEntrySchema = z.object({
  lei: LeiSchema,
  /** EBA competent authority code, e.g. "LU_CSSF". */
  caOwnerId: z.string().regex(/^[A-Z]{2}_[A-Z0-9_-]+$/),
  nationalId: z.string().trim().min(1),
  checkedAt: z.iso.date(),
  /** Official register page where the ID was checked. */
  sourceUrl: z.url({ protocol: /^https$/ }),
});

/** data/manual/national-ids.json */
export const NationalIdsFileSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(NationalIdEntrySchema),
});

export type NationalIdEntry = z.infer<typeof NationalIdEntrySchema>;
export type NationalIdsFile = z.infer<typeof NationalIdsFileSchema>;
