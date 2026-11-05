import { z } from "zod";

export const SourceSnapshotSchema = z.object({
  url: z.url(),
  fetchedAt: z.iso.datetime(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().min(0),
  rowCount: z.number().int().min(0),
});

export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;
