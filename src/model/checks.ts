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
  "exempt_institution",
]);

/** Latest cross-check state of one issuer. Derived; never edited by hand. */
export const IssuerChecksSchema = z.object({
  lei: LeiSchema,
  /**
   * Result of each level on its own, or null without evidence. A higher level never
   * implies the lower ones (e.g. L2 confirmed with L1 inactive for a lapsed LEI).
   */
  levels: z
    .object({
      L1: EvidenceResultSchema.nullable(),
      L2: EvidenceResultSchema.nullable(),
      L3: EvidenceResultSchema.nullable(),
    })
    .default({ L1: null, L2: null, L3: null }),
  /** Highest verification level reached, or null when none. */
  levelReached: CheckLevelSchema.nullable(),
  discrepancies: z.array(DiscrepancySchema),
  signals: z.array(SignalSchema),
  /** Combined L2 result (ADR 0003 §D4) and, when not_checked, why. Defaults keep pre-B6.3 files valid. */
  l2: z
    .object({
      result: EvidenceResultSchema,
      reason: L2ReasonSchema.nullable(),
      /** Fixed public text for the reason, when it has one (ADR 0003 §D7). */
      note: z.string().nullable().default(null),
    })
    .default({ result: "not_checked", reason: null, note: null }),
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
