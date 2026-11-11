import { z } from "zod";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const LeiSchema = z.string().regex(/^[A-Z0-9]{18}[0-9]{2}$/);

/** Official source types allowed as evidence. See ADR 0003 §D3. */
export const SourceTypeSchema = z.enum([
  "esma_register",
  "nca_register",
  "eba_register",
  "gleif",
  "issuer_official",
  "official_gazette_or_court",
]);

/** Verification levels. See ADR 0003 §D4. */
export const CheckLevelSchema = z.enum(["L1", "L2", "L3"]);

export const EvidenceResultSchema = z.enum([
  "confirmed",
  "not_found",
  "mismatch",
  "inactive",
  "not_checked",
]);

/** One line of data/evidence/evidence.jsonl. See ADR 0003 §D3. */
export const EvidenceSchema = z.object({
  /** sha256 of (issuerLei|check|sourceUrl|retrievedAt). */
  id: Sha256Schema,
  issuerLei: LeiSchema,
  check: CheckLevelSchema,
  sourceType: SourceTypeSchema,
  /** Exact URL whose response is hashed in contentSha256. */
  sourceUrl: z.url(),
  /** Human-readable public page for this entity at the source, when one exists. */
  viewUrl: z.url().optional(),
  retrievedAt: z.iso.datetime(),
  method: z.enum(["api", "download", "manual"]),
  contentSha256: Sha256Schema,
  matchedBy: z.enum(["lei", "national_id"]),
  nationalId: z.string().optional(),
  observed: z.record(z.string(), z.string().nullable()),
  result: EvidenceResultSchema,
});

export type Lei = z.infer<typeof LeiSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type CheckLevel = z.infer<typeof CheckLevelSchema>;
export type EvidenceResult = z.infer<typeof EvidenceResultSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
