import { z } from "zod";

/**
 * Tracks the exact origin of every data row.
 * Every row parsed from an ESMA CSV carries one of these so the data can always be
 * traced back to the specific file download that produced it.
 */
export const ProvenanceSchema = z.object({
  /** URL of the ESMA CSV file this row came from. */
  sourceUrl: z.url(),
  /** ISO-8601 UTC timestamp of when the file was downloaded. */
  fetchedAt: z.iso.datetime(),
  /** SHA-256 of the downloaded file (the whole snapshot, not just this row). */
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** 1-based index of this row within the parsed CSV (header row excluded). */
  rowIndex: z.number().int().min(1),
  /** SHA-256 of the raw UTF-8 bytes of this row as they appear in the downloaded file. */
  rowSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;
