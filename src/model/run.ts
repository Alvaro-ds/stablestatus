import { z } from "zod";

/** Where an ingest run executed. */
export const RunnerSchema = z.enum(["github-actions", "local"]);

/** What started an ingest run. Local runs are always "manual". */
export const TriggerSchema = z.enum(["schedule", "workflow_dispatch", "manual"]);

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
});

export type Runner = z.infer<typeof RunnerSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type RunRecord = z.infer<typeof RunRecordSchema>;
