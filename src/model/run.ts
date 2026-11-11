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

/**
 * One line of data/runs.jsonl: an append-only record of every successful ingest run.
 * runner and trigger are optional so lines without them still validate (they never
 * count towards the phase 1 gate).
 */
export const RunRecordSchema = z.object({
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
  sources: z.object({ gleif: SourceRunSchema }).optional(),
});

export type SourceRun = z.infer<typeof SourceRunSchema>;
export type Runner = z.infer<typeof RunnerSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type RunRecord = z.infer<typeof RunRecordSchema>;
