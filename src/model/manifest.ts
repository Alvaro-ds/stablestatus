import { z } from "zod";

import { SourceSnapshotSchema } from "./snapshot.js";

/**
 * Written to data/raw/YYYY-MM-DD/manifest.json after every ingest run.
 * Records what was downloaded on a given day regardless of whether the files changed.
 */
export const ManifestSchema = z.object({
  /** ISO-8601 calendar date of the ingest run (YYYY-MM-DD). */
  date: z.iso.date(),
  /** Bump this when the manifest structure changes in a breaking way. */
  schemaVersion: z.literal(1),
  /** One entry per ESMA CSV file processed. */
  files: z.array(SourceSnapshotSchema),
});

export type Manifest = z.infer<typeof ManifestSchema>;
