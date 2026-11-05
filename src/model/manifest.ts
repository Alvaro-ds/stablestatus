import { z } from "zod";
import { SourceSnapshotSchema } from "./snapshot.js";

export const ManifestSchema = z.object({
  date: z.iso.date(),
  schemaVersion: z.literal(1),
  files: z.array(SourceSnapshotSchema),
});

export type Manifest = z.infer<typeof ManifestSchema>;
