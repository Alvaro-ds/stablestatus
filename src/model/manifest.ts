import { z } from "zod";
import { SourceSnapshotSchema } from "./snapshot.js";

export const ManifestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  schemaVersion: z.literal(1),
  files: z.array(SourceSnapshotSchema),
});

export type Manifest = z.infer<typeof ManifestSchema>;
