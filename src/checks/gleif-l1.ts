import { createHash } from "node:crypto";

import { SIGNAL_SEVERITY } from "../model/index.js";
import type {
  Discrepancy,
  Evidence,
  EvidenceResult,
  Issuer,
  IssuerChecks,
  Signal,
  SignalKind,
} from "../model/index.js";
import { gleifViewUrl } from "../sources/gleif.js";
import type { GleifRecord } from "../sources/gleif.js";

/** The GLEIF response a set of L1 evidence records was derived from. */
export interface GleifSnapshot {
  sourceUrl: string;
  retrievedAt: string;
  contentSha256: string;
}

const RETIRED_REGISTRATION = new Set(["RETIRED", "ANNULLED", "DUPLICATE", "MERGED"]);

export const OBSERVED = {
  legalName: "entity.legalName.name",
  country: "entity.legalAddress.country",
  entityStatus: "entity.status",
  registeredAs: "entity.registeredAs",
  registrationStatus: "registration.status",
  nextRenewalDate: "registration.nextRenewalDate",
} as const;

/** ISSUED + ACTIVE + legal name and country recorded (ADR 0003 §D4, amended). */
export function l1Result(record: GleifRecord | undefined): EvidenceResult {
  if (record === undefined) return "not_found";
  const confirmed =
    record.registrationStatus === "ISSUED" &&
    record.entityStatus === "ACTIVE" &&
    record.legalName.trim() !== "" &&
    (record.country ?? "").trim() !== "";
  return confirmed ? "confirmed" : "inactive";
}

/** Builds the L1 evidence for one issuer. Matching is by LEI only (ADR 0003 §D5). */
export function buildL1Evidence(
  lei: string,
  record: GleifRecord | undefined,
  snapshot: GleifSnapshot
): Evidence {
  const id = createHash("sha256")
    .update(`${lei}|L1|${snapshot.sourceUrl}|${snapshot.retrievedAt}`)
    .digest("hex");
  return {
    id,
    issuerLei: lei,
    check: "L1",
    sourceType: "gleif",
    sourceUrl: snapshot.sourceUrl,
    viewUrl: gleifViewUrl(lei),
    retrievedAt: snapshot.retrievedAt,
    method: "api",
    contentSha256: snapshot.contentSha256,
    matchedBy: "lei",
    ...(record?.registeredAs ? { nationalId: record.registeredAs } : {}),
    observed: {
      [OBSERVED.legalName]: record?.legalName ?? null,
      [OBSERVED.country]: record?.country ?? null,
      [OBSERVED.entityStatus]: record?.entityStatus ?? null,
      [OBSERVED.registeredAs]: record?.registeredAs ?? null,
      [OBSERVED.registrationStatus]: record?.registrationStatus ?? null,
      [OBSERVED.nextRenewalDate]: record?.nextRenewalDate ?? null,
    },
    result: l1Result(record),
  };
}

/**
 * Risk signals raised by a GLEIF L1 evidence record: at most one per kind, with every
 * cause in `observed`. None when the LEI was not found.
 */
export function deriveGleifSignals(evidence: Evidence): Signal[] {
  if (evidence.result === "not_found") return [];
  const causes = new Map<SignalKind, Record<string, string | null>>();
  const addCause = (kind: SignalKind, field: string) => {
    causes.set(kind, { ...causes.get(kind), [field]: evidence.observed[field] ?? null });
  };

  const registration = evidence.observed[OBSERVED.registrationStatus] ?? null;
  if (registration === "LAPSED") addCause("lei_lapsed", OBSERVED.registrationStatus);
  if (registration !== null && RETIRED_REGISTRATION.has(registration)) {
    addCause("lei_retired", OBSERVED.registrationStatus);
  }
  if (evidence.observed[OBSERVED.entityStatus] !== "ACTIVE") {
    addCause("lei_retired", OBSERVED.entityStatus);
  }

  return [...causes.entries()].map(([kind, observed]) => ({
    kind,
    severity: SIGNAL_SEVERITY[kind],
    observed,
    sourceType: evidence.sourceType,
    sourceUrl: evidence.sourceUrl,
    evidenceId: evidence.id,
  }));
}

/** Case, accents (NFKD without diacritics), punctuation and whitespace only. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\p{P}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Closed list of legal forms ignored when telling a format difference from a name mismatch. */
const LEGAL_FORMS = [
  "SA",
  "S.A.",
  "SAS",
  "SCA",
  "B.V.",
  "GmbH",
  "Ltd",
  "ehf",
  "hf.",
  "UAB",
  "SIA",
  "sp. z o.o.",
  "Oy",
  "ApS",
  "SE",
  "d.o.o.",
];

const LEGAL_FORM_RE = new RegExp(
  `(^| )(${[...new Set(LEGAL_FORMS.map(normalizeName))].join("|")})(?= |$)`,
  "g"
);

/** normalizeName, then removes the legal forms in LEGAL_FORMS as whole words. */
export function stripLegalForms(name: string): string {
  return normalizeName(name).replace(LEGAL_FORM_RE, " ").replace(/\s+/g, " ").trim();
}

/** Discrepancies between the ESMA issuer record and GLEIF. ESMA data is never modified. */
export function deriveGleifDiscrepancies(issuer: Issuer, evidence: Evidence): Discrepancy[] {
  if (evidence.result === "not_found") return [];
  const base = {
    otherSourceType: evidence.sourceType,
    otherSourceUrl: evidence.sourceUrl,
    evidenceId: evidence.id,
  };
  const discrepancies: Discrepancy[] = [];

  const esmaName = issuer.displayName ?? issuer.name;
  const legalName = evidence.observed[OBSERVED.legalName] ?? null;
  if (legalName === null || normalizeName(esmaName) !== normalizeName(legalName)) {
    const sameWithoutForms =
      legalName !== null &&
      stripLegalForms(esmaName) !== "" &&
      stripLegalForms(esmaName) === stripLegalForms(legalName);
    discrepancies.push({
      kind: sameWithoutForms ? "name_format" : "name_mismatch",
      field: "name",
      esmaValue: esmaName,
      otherValue: legalName,
      ...base,
    });
  }

  const country = evidence.observed[OBSERVED.country] ?? null;
  if (issuer.countryCode !== null && issuer.countryCode.trim().toUpperCase() !== country) {
    discrepancies.push({
      kind: "country_mismatch",
      field: "country",
      esmaValue: issuer.countryCode,
      otherValue: country,
      ...base,
    });
  }

  return discrepancies;
}

/** Derives one issuer's checks from its latest GLEIF L1 evidence. */
export function deriveIssuerChecks(
  issuer: Issuer,
  evidence: Evidence | undefined,
  gleifLastCheckedAt: string | null
): IssuerChecks {
  return {
    lei: issuer.lei,
    levelReached: evidence?.result === "confirmed" ? "L1" : null,
    discrepancies: evidence ? deriveGleifDiscrepancies(issuer, evidence) : [],
    signals: evidence ? deriveGleifSignals(evidence) : [],
    lastCheckedAt: { gleif: gleifLastCheckedAt },
  };
}
