import { z } from "zod";

/**
 * Written to data/current/meta.json after every normalisation run.
 * Provides a quick summary and links to the source files.
 */
export const MetaSchema = z.object({
  date: z.iso.date(),
  schemaVersion: z.literal(1),
  sources: z.array(
    z.object({
      url: z.url(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      fetchedAt: z.iso.datetime(),
    })
  ),
  issuerCount: z.number().int().min(0),
  whitepaperCount: z.number().int().min(0),
});

export type Meta = z.infer<typeof MetaSchema>;
