import { createHash } from "node:crypto";

import { z } from "zod";

import { LeiSchema } from "../model/index.js";
import type { Evidence } from "../model/index.js";

/**
 * Official domains accepted for manual evidence, with the source type each one proves.
 * Mirrors the list in docs/sources.md ("Official domains for manual evidence"); a test
 * keeps both in sync. Subdomains are accepted (e.g. financialservices.mfsa.mt).
 */
export const OFFICIAL_DOMAINS: Record<string, "nca_register" | "eba_register"> = {
  "eba.europa.eu": "eba_register",
  "acpr.banque-france.fr": "nca_register",
  "regafi.fr": "nca_register",
  "bafin.de": "nca_register",
  "bank.lv": "nca_register",
  "bportugal.pt": "nca_register",
  "bsi.si": "nca_register",
  "cb.is": "nca_register",
  "cnb.cz": "nca_register",
  "cssf.lu": "nca_register",
  "dnb.nl": "nca_register",
  "finanssivalvonta.fi": "nca_register",
  "finanstilsynet.dk": "nca_register",
  "knf.gov.pl": "nca_register",
  "lb.lt": "nca_register",
  "mfsa.mt": "nca_register",
};

/** The official domain `url` belongs to, or null. */
export function officialDomain(url: string): string | null {
  const { hostname } = new URL(url);
  const host = hostname.toLowerCase();
  return Object.keys(OFFICIAL_DOMAINS).find((d) => host === d || host.endsWith(`.${d}`)) ?? null;
}

/** Input of `pnpm evidence:add`. contentSha256 is the hash of the saved PDF of the page. */
export const ManualEvidenceInputSchema = z
  .object({
    issuerLei: LeiSchema,
    check: z.enum(["L2", "L3"]),
    sourceType: z.enum(["nca_register", "eba_register"]),
    sourceUrl: z.url({ protocol: /^https$/ }),
    retrievedAt: z.iso.datetime(),
    contentSha256: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/)
      .transform((s) => s.toLowerCase()),
    matchedBy: z.enum(["lei", "national_id"]),
    nationalId: z.string().trim().min(1).optional(),
    observed: z
      .record(z.string(), z.string().nullable())
      .refine((o) => Object.keys(o).length > 0, "observed needs at least one field"),
    result: z.enum(["confirmed", "not_found", "mismatch", "inactive"]),
  })
  .strict()
  .refine((i) => i.matchedBy !== "national_id" || i.nationalId !== undefined, {
    message: "nationalId is required when matchedBy is national_id",
    path: ["nationalId"],
  })
  .refine((i) => !new URL(i.sourceUrl).username && !new URL(i.sourceUrl).password, {
    message: "sourceUrl must not contain credentials",
    path: ["sourceUrl"],
  })
  .refine(
    (i) => {
      const domain = officialDomain(i.sourceUrl);
      return domain !== null && OFFICIAL_DOMAINS[domain] === i.sourceType;
    },
    {
      message: "sourceUrl is not on an official domain for this sourceType (see docs/sources.md)",
      path: ["sourceUrl"],
    }
  );

export type ManualEvidenceInput = z.input<typeof ManualEvidenceInputSchema>;

/** Validates the input and builds the evidence record (method "manual"). */
export function buildManualEvidence(input: unknown, now: Date): Evidence {
  const i = ManualEvidenceInputSchema.parse(input);
  if (Date.parse(i.retrievedAt) > now.getTime()) {
    throw new Error("retrievedAt is in the future");
  }
  return {
    id: createHash("sha256")
      .update(`${i.issuerLei}|${i.check}|${i.sourceUrl}|${i.retrievedAt}`)
      .digest("hex"),
    issuerLei: i.issuerLei,
    check: i.check,
    sourceType: i.sourceType,
    sourceUrl: i.sourceUrl,
    retrievedAt: i.retrievedAt,
    method: "manual",
    contentSha256: i.contentSha256,
    matchedBy: i.matchedBy,
    ...(i.nationalId !== undefined ? { nationalId: i.nationalId } : {}),
    observed: i.observed,
    result: i.result,
  };
}
