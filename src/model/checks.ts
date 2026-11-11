import { z } from "zod";

import { DiscrepancySchema } from "./discrepancy.js";
import { CheckLevelSchema, LeiSchema } from "./evidence.js";
import { SignalSchema } from "./signal.js";

/** Latest cross-check state of one issuer. Derived; never edited by hand. */
export const IssuerChecksSchema = z.object({
  lei: LeiSchema,
  /** Highest verification level reached, or null when none. */
  levelReached: CheckLevelSchema.nullable(),
  discrepancies: z.array(DiscrepancySchema),
  signals: z.array(SignalSchema),
  /** Last run in which each source was actually checked (null if never). */
  lastCheckedAt: z.object({
    gleif: z.iso.datetime().nullable(),
  }),
});

/** data/current/checks.json, rebuilt from evidence.jsonl + runs.jsonl on every run. */
export const ChecksFileSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  issuers: z.array(IssuerChecksSchema),
});

export type IssuerChecks = z.infer<typeof IssuerChecksSchema>;
export type ChecksFile = z.infer<typeof ChecksFileSchema>;
