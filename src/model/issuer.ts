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
  lei: z.string(),
  name: z.string(),
  commercialName: z.string().nullable(),
  homeMemberState: z.string(),
  countryCode: z.string().nullable(),
  address: z.string().nullable(),
  website: z.string().nullable(),

  authorityRaw: z.string(),
  authorityCode: z.string().nullable(),

  /** Derived from the most critical status among the issuer's whitepapers. */
  registerStatus: RegisterStatusSchema,

  quality: z.array(z.string()),

  /** Provenance of the first (or only) row that contributed this issuer. */
  provenance: ProvenanceSchema,
});

export type Issuer = z.infer<typeof IssuerSchema>;
