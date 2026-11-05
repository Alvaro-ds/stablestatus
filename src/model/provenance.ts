import { z } from "zod";

export const ProvenanceSchema = z.object({
  sourceUrl: z.url(),
  fetchedAt: z.iso.datetime(),
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
  rowIndex: z.number().int().min(1),
  rowSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;
