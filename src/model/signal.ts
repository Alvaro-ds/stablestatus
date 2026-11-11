import { z } from "zod";

import { SeveritySchema } from "./change-event.js";
import { SourceTypeSchema } from "./evidence.js";
import type { Severity } from "./change-event.js";

/** Risk signals that do not change registerStatus. See ADR 0003 §D2. */
export const SignalKindSchema = z.enum([
  "lei_lapsed",
  "lei_retired",
  "nca_licence_inactive",
  "nca_licence_withdrawn",
  "liquidation_announced",
  "insolvency_proceedings",
]);

export type SignalKind = z.infer<typeof SignalKindSchema>;

export const SIGNAL_SEVERITY: Record<SignalKind, Severity> = {
  lei_lapsed: "warning",
  lei_retired: "critical",
  nca_licence_inactive: "critical",
  nca_licence_withdrawn: "critical",
  liquidation_announced: "critical",
  insolvency_proceedings: "critical",
};

export const SignalSchema = z
  .object({
    kind: SignalKindSchema,
    severity: SeveritySchema,
    /** Every source field and value that raised this signal, e.g. { "registration.status": "LAPSED" }. */
    observed: z
      .record(z.string(), z.string().nullable())
      .refine((o) => Object.keys(o).length > 0, "a signal needs at least one cause"),
    sourceType: SourceTypeSchema,
    sourceUrl: z.url(),
    evidenceId: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .refine((s) => s.severity === SIGNAL_SEVERITY[s.kind], {
    message: "severity does not match the fixed severity of this signal kind",
    path: ["severity"],
  });

export type Signal = z.infer<typeof SignalSchema>;
