import { z } from "zod";

import { RunnerSchema, TriggerSchema } from "./run.js";

/**
 * Describes a single downloaded CSV file.
 * One entry per file in each day's manifest.json.
 */
export const SourceSnapshotSchema = z.object({
  /** URL the file was downloaded from. */
  url: z.url(),
  /** ISO-8601 UTC timestamp of when the file was actually retrieved from ESMA. */
  fetchedAt: z.iso.datetime(),
  /** SHA-256 of the raw downloaded bytes (BOM and CRLF preserved). */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Size of the downloaded file in bytes. */
  sizeBytes: z.number().int().min(0),
  /** Number of data rows (header excluded). Zero for a header-only file. */
  rowCount: z.number().int().min(0),
  /** How the file was obtained: "http" for a live download, "file" for a local copy. */
  retrieval: z.enum(["http", "file"]),
  /** Where the ingest ran. Optional: manifests written before it existed lack it. */
  runner: RunnerSchema.optional(),
  /** What started the ingest. Optional: manifests written before it existed lack it. */
  trigger: TriggerSchema.optional(),
});

export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;
