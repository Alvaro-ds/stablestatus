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

function signal(kind: SignalKind, field: string, evidence: Evidence): Signal {
  return {
    kind,
    severity: SIGNAL_SEVERITY[kind],
    field,
    value: evidence.observed[field] ?? null,
    sourceType: evidence.sourceType,
    sourceUrl: evidence.sourceUrl,
    evidenceId: evidence.id,
  };
}

/** Risk signals raised by a GLEIF L1 evidence record. None when the LEI was not found. */
export function deriveGleifSignals(evidence: Evidence): Signal[] {
  if (evidence.result === "not_found") return [];
  const signals: Signal[] = [];
  const registration = evidence.observed[OBSERVED.registrationStatus] ?? null;
  if (registration === "LAPSED") {
    signals.push(signal("lei_lapsed", OBSERVED.registrationStatus, evidence));
  } else if (registration !== null && RETIRED_REGISTRATION.has(registration)) {
    signals.push(signal("lei_retired", OBSERVED.registrationStatus, evidence));
  }
  if (evidence.observed[OBSERVED.entityStatus] !== "ACTIVE") {
    signals.push(signal("lei_retired", OBSERVED.entityStatus, evidence));
  }
  return signals;
}

/**
 * Case, whitespace and punctuation only. Legal forms are NOT equated:
 * "ehf" and "hf." are different company forms in Iceland.
 */
export function normalizeName(name: string): string {
  return name.toUpperCase().replace(/\p{P}/gu, " ").replace(/\s+/g, " ").trim();
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

  const legalName = evidence.observed[OBSERVED.legalName] ?? null;
  if (legalName === null || normalizeName(issuer.name) !== normalizeName(legalName)) {
    discrepancies.push({
      kind: "name_mismatch",
      field: "name",
      esmaValue: issuer.name,
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
