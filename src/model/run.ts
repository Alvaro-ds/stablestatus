import { z } from "zod";

/** Where an ingest run executed. */
export const RunnerSchema = z.enum(["github-actions", "local"]);

/** What started an ingest run. Local runs are always "manual". */
export const TriggerSchema = z.enum(["schedule", "workflow_dispatch", "manual"]);

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/** Outcome of a secondary source in one run. Hashes are null when not_checked. */
export const SourceRunSchema = z.object({
  status: z.enum(["ok", "not_checked"]),
  /** sha256 of the full response bytes. */
  contentSha256: Sha256Schema.nullable(),
  /** sha256 of the fields we use, sorted by LEI, without volatile metadata. */
  recordsSha256: Sha256Schema.nullable(),
});

const StateFilesSchema = z.array(z.object({ path: z.string().min(1), sha256: Sha256Schema }));

/**
 * An ingest line of data/runs.jsonl: an append-only record of every successful ingest run.
 * runner and trigger are optional so lines without them still validate (they never
 * count towards the phase 1 gate).
 */
export const IngestRunRecordSchema = z
  .object({
    kind: z.undefined().optional(),
    at: z.iso.datetime(),
    runner: RunnerSchema.optional(),
    trigger: TriggerSchema.optional(),
    runId: z.string().nullable(),
    emtwpSha256: z.string().regex(/^[0-9a-f]{64}$/),
    artzzSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    events: z.number().int().min(0),
    critical: z.number().int().min(0),
    /** Secondary sources checked in this run. Absent on runs before B6. */
    sources: z
      .object({
        gleif: SourceRunSchema,
        eba: SourceRunSchema.optional(),
        dnb: SourceRunSchema.optional(),
      })
      .optional(),
    /** Integrity chain fields (ADR 0005). Absent on lines before the chain started. */
    stateFiles: StateFilesSchema.optional(),
    stateSha256: Sha256Schema.optional(),
    prevEntrySha256: Sha256Schema.optional(),
    chainGenesis: z.literal(true).optional(),
    entrySha256: Sha256Schema.optional(),
  })
  .refine(
    (r) =>
      r.entrySha256 === undefined ||
      (r.prevEntrySha256 !== undefined &&
        r.stateSha256 !== undefined &&
        r.stateFiles !== undefined),
    { message: "chained lines need prevEntrySha256, stateSha256 and stateFiles" }
  );

/**
 * A manual evidence line of data/runs.jsonl (ADR 0005, amendment 2026-11-21): chains the
 * published state after `pnpm evidence:add`. It is never an ingest run.
 */
export const ManualEvidenceRunRecordSchema = z.object({
  kind: z.literal("manual_evidence"),
  at: z.iso.datetime(),
  evidenceIds: z.array(Sha256Schema).min(1),
  events: z.number().int().min(0),
  critical: z.number().int().min(0),
  stateFiles: StateFilesSchema,
  stateSha256: Sha256Schema,
  prevEntrySha256: Sha256Schema,
  chainGenesis: z.literal(true).optional(),
  entrySha256: Sha256Schema,
});

/** One line of data/runs.jsonl: an ingest run or a manual evidence record. */
export const RunRecordSchema = z.union([IngestRunRecordSchema, ManualEvidenceRunRecordSchema]);

export type SourceRun = z.infer<typeof SourceRunSchema>;
export type Runner = z.infer<typeof RunnerSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type IngestRunRecord = z.infer<typeof IngestRunRecordSchema>;
export type ManualEvidenceRunRecord = z.infer<typeof ManualEvidenceRunRecordSchema>;
export type RunRecord = z.infer<typeof RunRecordSchema>;

export function isIngestRun(run: RunRecord): run is IngestRunRecord {
  return run.kind === undefined;
}
