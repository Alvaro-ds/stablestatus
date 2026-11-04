import { z } from "zod";

export const SourceSnapshotSchema = z.object({
  url: z.string().url(),
  fetchedAt: z.string().datetime({ offset: false }),
  sha256: z.string().min(1),
  sizeBytes: z.number().int().min(0),
  rowCount: z.number().int().min(0),
});

export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;
