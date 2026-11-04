import { z } from "zod";

export const ProvenanceSchema = z.object({
  sourceUrl: z.string().url(),
  fetchedAt: z.string().datetime(),
  snapshotSha256: z.string().min(1),
  rowIndex: z.number().int().min(1),
  rowSha256: z.string().min(1),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;
