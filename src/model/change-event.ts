import { z } from "zod";

export const ChangeKindSchema = z.enum([
  "baseline",
  "issuer_added",
  "issuer_delisted",
  "whitepaper_added",
  "whitepaper_delisted",
  "whitepaper_replaced",
  "status_changed",
  "field_changed",
  "art_register_non_empty",
]);

export type ChangeKind = z.infer<typeof ChangeKindSchema>;

export const SeveritySchema = z.enum(["info", "warning", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const ChangeEventSchema = z.object({
  at: z.iso.datetime(),
  entity: z.enum(["issuer", "whitepaper", "system"]),
  key: z.string(),
  kind: ChangeKindSchema,
  field: z.string().optional(),
  from: z.unknown().optional(),
  to: z.unknown().optional(),
  severity: SeveritySchema,
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ChangeEvent = z.infer<typeof ChangeEventSchema>;
