import { z } from "zod";

import { ProvenanceSchema } from "./provenance.js";
import { RegisterStatusSchema } from "./register-status.js";

/**
 * Authorised legal entity (one per LEI).
 * Static fields come from the ESMA row; registerStatus is derived
 * from the issuer's whitepapers. See ADR 0002 §D1.
 */
export const IssuerSchema = z.object({
  /** LEI (ISO 17442, 20 chars). Stable key — never the name or ticker. */
  lei: z.string().regex(/^[A-Z0-9]{18}[0-9]{2}$/),
  /** ae_lei_name exactly as published by ESMA (may contain several lines). */
  name: z.string(),
  /** First non-empty line of name, without extra spaces. Optional for files written before it existed. */
  displayName: z.string().optional(),
  commercialName: z.string().nullable(),
  homeMemberState: z.string(),
  countryCode: z.string().nullable(),
  address: z.string().nullable(),
  website: z.string().nullable(),

  authorityRaw: z.string(),
  authorityCode: z.string().nullable(),

  /** Derived from the most critical status among the issuer's whitepapers. */
  registerStatus: RegisterStatusSchema,

  /** ae_exemption48_4 / ae_exemption48_5 parsed from Yes/No. null when blank or N/A. */
  exemption48_4: z.boolean().nullable(),
  exemption48_5: z.boolean().nullable(),

  /** ae_authorisation_other_emt, e.g. "Electronic money institution". null when blank or N/A. */
  entityType: z.string().nullable(),

  quality: z.array(z.string()),

  /** Provenance of the first (or only) row that contributed this issuer. */
  provenance: ProvenanceSchema,
});

export type Issuer = z.infer<typeof IssuerSchema>;
