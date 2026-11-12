import { z } from "zod";

import { DiscrepancySchema } from "./discrepancy.js";
import { CheckLevelSchema, EvidenceResultSchema, LeiSchema } from "./evidence.js";
import { SignalSchema } from "./signal.js";

/** Why an issuer has no L2 result. */
export const L2ReasonSchema = z.enum([
  "no_automated_official_source",
  "national_id_missing",
  "ambiguous_match",
  "source_unavailable",
]);

/** Latest cross-check state of one issuer. Derived; never edited by hand. */
export const IssuerChecksSchema = z.object({
  lei: LeiSchema,
  /** Highest verification level reached, or null when none. */
  levelReached: CheckLevelSchema.nullable(),
  discrepancies: z.array(DiscrepancySchema),
  signals: z.array(SignalSchema),
  /** Combined L2 result (ADR 0003 §D4) and, when not_checked, why. Defaults keep pre-B6.3 files valid. */
  l2: z
    .object({
      result: EvidenceResultSchema,
      reason: L2ReasonSchema.nullable(),
    })
    .default({ result: "not_checked", reason: null }),
  /** Last run in which each source was actually checked (null if never). */
  lastCheckedAt: z.object({
    gleif: z.iso.datetime().nullable(),
    eba: z.iso.datetime().nullable().default(null),
    dnb: z.iso.datetime().nullable().default(null),
  }),
});

/** data/current/checks.json, rebuilt from evidence.jsonl + runs.jsonl on every run. */
export const ChecksFileSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  issuers: z.array(IssuerChecksSchema),
});

export type L2Reason = z.infer<typeof L2ReasonSchema>;
export type IssuerChecks = z.infer<typeof IssuerChecksSchema>;
export type ChecksFile = z.infer<typeof ChecksFileSchema>;
