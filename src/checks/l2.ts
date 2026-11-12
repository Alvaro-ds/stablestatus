import { createHash } from "node:crypto";

import { SIGNAL_SEVERITY } from "../model/index.js";
import type {
  Evidence,
  EvidenceResult,
  Issuer,
  L2Reason,
  NationalIdEntry,
  Signal,
  SignalKind,
} from "../model/index.js";
import type { DnbRecord } from "../sources/dnb.js";
import type { EbaRecord } from "../sources/eba.js";

/** The download a set of L2 evidence records was derived from. */
export interface L2Snapshot {
  sourceUrl: string;
  retrievedAt: string;
  contentSha256: string;
}

/** IDs that may identify an issuer in a register without LEIs. Never a name. */
export interface IdentityKeys {
  /** GLEIF entity.registeredAs (national company register number). */
  registeredAs: string | null;
  /** DNB relation numbers of the issuer's licence, found in DNB by LEI. */
  dnbRelationNumbers: string[];
  /** IDs checked by hand in an official register (data/manual/national-ids.json). */
  manual: Pick<NationalIdEntry, "caOwnerId" | "nationalId">[];
  /** EntityCode matched in an earlier run, so a known entity is never lost. */
  previousEntityCode: string | null;
}

export type EbaMatch =
  | {
      kind: "found";
      record: EbaRecord;
      matchedBy: "lei" | "national_id";
      nationalId: string | null;
    }
  | { kind: "not_found"; nationalId: string | null }
  | { kind: "unmatched"; reason: Extract<L2Reason, "national_id_missing" | "ambiguous_match"> };

const DNB_LICENCE = "Vergunning";
/** Shorter IDs are too likely to collide across numbering systems. */
const MIN_ID_LENGTH = 6;

/** Upper case, letters and digits only: "3236886-2" and "32368862" compare equal. */
export function normalizeId(id: string): string {
  return id.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Credit institutions are not in the PSD2 register (they are licensed under CRD). */
export function isCreditInstitution(issuer: Issuer): boolean {
  return /credit\s+institution/i.test(issuer.entityType ?? "");
}

function codeSuffix(entityCode: string): string {
  return entityCode.split("!").pop() ?? entityCode;
}

/**
 * Finds the issuer in the EBA register (ADR 0003 §D5): by LEI, then by national ID within
 * the issuer's home country. An ID that does not match is not proof of absence, so the
 * result is not_found only when a known entity disappeared or a hand-checked ID is missing.
 */
export function matchEba(issuer: Issuer, keys: IdentityKeys, records: EbaRecord[]): EbaMatch {
  const byLei = records.find((r) => r.entityCode === issuer.lei);
  if (byLei)
    return { kind: "found", record: byLei, matchedBy: "lei", nationalId: byLei.nationalId };

  if (keys.previousEntityCode !== null) {
    const known = records.find((r) => r.entityCode === keys.previousEntityCode);
    return known
      ? { kind: "found", record: known, matchedBy: "national_id", nationalId: known.nationalId }
      : { kind: "not_found", nationalId: null };
  }

  const country = issuer.homeMemberState.toUpperCase();
  const inCountry = records.filter((r) => r.caOwnerId.split("_")[0] === country);
  const ids = new Set(
    [keys.registeredAs, ...keys.dnbRelationNumbers]
      .filter((id): id is string => id !== null)
      .map(normalizeId)
      .filter((id) => id.length >= MIN_ID_LENGTH)
  );
  const matchesId = (r: EbaRecord, id: string) =>
    normalizeId(r.nationalId ?? "") === id || normalizeId(codeSuffix(r.entityCode)) === id;

  const found = new Map<string, EbaRecord>();
  for (const r of inCountry) {
    if ([...ids].some((id) => matchesId(r, id))) found.set(r.entityCode, r);
  }
  for (const m of keys.manual) {
    const id = normalizeId(m.nationalId);
    for (const r of records) {
      if (r.caOwnerId === m.caOwnerId && matchesId(r, id)) found.set(r.entityCode, r);
    }
  }

  if (found.size > 1) return { kind: "unmatched", reason: "ambiguous_match" };
  const [only] = found.values();
  if (only)
    return { kind: "found", record: only, matchedBy: "national_id", nationalId: only.nationalId };
  if (keys.manual.length > 0) return { kind: "not_found", nationalId: keys.manual[0]!.nationalId };
  return { kind: "unmatched", reason: "national_id_missing" };
}

/** The issuer's current DNB licence row, matched by LEI; undefined when absent. */
export function matchDnb(lei: string, records: DnbRecord[]): DnbRecord | undefined {
  return records
    .filter((r) => r.lei === lei && r.registrationType === DNB_LICENCE)
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))
    .pop();
}

/** Odd number of Authorised/Withdrawn dates: authorised. PSD_EEMI is registered, not licensed. */
export function ebaResult(record: EbaRecord | undefined): EvidenceResult {
  if (!record) return "not_found";
  if (record.authDates.length % 2 === 0) return "inactive";
  return record.entityType === "PSD_EMI" ? "confirmed" : "not_licensed";
}

export function dnbResult(record: DnbRecord | undefined, today: string): EvidenceResult {
  if (!record) return "not_found";
  if ((record.endDate !== null && record.endDate <= today) || record.inLiquidation)
    return "inactive";
  return "confirmed";
}

function evidenceId(lei: string, snapshot: L2Snapshot): string {
  return createHash("sha256")
    .update(`${lei}|L2|${snapshot.sourceUrl}|${snapshot.retrievedAt}`)
    .digest("hex");
}

/** L2 evidence from the EBA register. Callers skip "unmatched" issuers (no evidence line). */
export function buildEbaEvidence(
  lei: string,
  match: Exclude<EbaMatch, { kind: "unmatched" }>,
  snapshot: L2Snapshot
): Evidence {
  const record = match.kind === "found" ? match.record : undefined;
  return {
    id: evidenceId(lei, snapshot),
    issuerLei: lei,
    check: "L2",
    sourceType: "eba_register",
    sourceUrl: snapshot.sourceUrl,
    retrievedAt: snapshot.retrievedAt,
    method: "download",
    contentSha256: snapshot.contentSha256,
    matchedBy: match.kind === "found" ? match.matchedBy : "national_id",
    ...(match.nationalId ? { nationalId: match.nationalId } : {}),
    observed: record
      ? {
          EntityCode: record.entityCode,
          EntityType: record.entityType,
          CA_OwnerID: record.caOwnerId,
          ENT_NAT_REF_COD: record.nationalId,
          ENT_NAM: record.name,
          ENT_AUT: record.authDates.join(", "),
        }
      : {},
    result: ebaResult(record),
  };
}

/** L2 evidence from the DNB register, matched by LEI. */
export function buildDnbEvidence(
  lei: string,
  record: DnbRecord | undefined,
  snapshot: L2Snapshot
): Evidence {
  return {
    id: evidenceId(lei, snapshot),
    issuerLei: lei,
    check: "L2",
    sourceType: "nca_register",
    sourceUrl: snapshot.sourceUrl,
    retrievedAt: snapshot.retrievedAt,
    method: "download",
    contentSha256: snapshot.contentSha256,
    matchedBy: "lei",
    ...(record ? { nationalId: record.relationNumber } : {}),
    observed: record
      ? {
          Relatienummer: record.relationNumber,
          StatutaireNaam: record.name,
          KvK: record.kvk,
          LEI: record.lei,
          RegistratieType: record.registrationType,
          Begindatum: record.startDate,
          Einddatum: record.endDate,
          Inliquidatie: record.inLiquidation ? "Ja" : "Nee",
          DatumInLiquidatie: record.liquidationDate,
        }
      : {},
    result: dnbResult(record, snapshot.retrievedAt.slice(0, 10)),
  };
}

/** Signals raised by one L2 evidence record: withdrawal or another kind of inactivity. */
export function deriveL2Signals(evidence: Evidence): Signal[] {
  if (evidence.check !== "L2" || evidence.result !== "inactive") return [];
  const o = evidence.observed;
  let kind: SignalKind;
  let observed: Record<string, string | null>;
  if (evidence.method === "manual") {
    if (Object.keys(o).length === 0) return [];
    kind = "nca_licence_inactive";
    observed = o;
  } else if (evidence.sourceType === "eba_register") {
    kind = "nca_licence_withdrawn";
    observed = { ENT_AUT: o["ENT_AUT"] ?? null };
  } else if (o["Einddatum"]) {
    kind = "nca_licence_withdrawn";
    observed = { Einddatum: o["Einddatum"] };
  } else {
    kind = "nca_licence_inactive";
    observed = {
      Inliquidatie: o["Inliquidatie"] ?? null,
      DatumInLiquidatie: o["DatumInLiquidatie"] ?? null,
    };
  }
  return [
    {
      kind,
      severity: SIGNAL_SEVERITY[kind],
      observed,
      sourceType: evidence.sourceType,
      sourceUrl: evidence.sourceUrl,
      evidenceId: evidence.id,
    },
  ];
}

const RESULT_PRIORITY: EvidenceResult[] = [
  "confirmed",
  "inactive",
  "not_licensed",
  "mismatch",
  "not_found",
];

/** Fixed, neutral public text per reason (ADR 0003 §D7). */
export const L2_REASON_NOTE: Partial<Record<L2Reason, string>> = {
  exempt_institution:
    "Registered as an exempt e-money institution in the EBA PSD2 register; not counted as a licence (L2)",
};

/**
 * Combined L2 result: one official source confirming is enough; otherwise the most
 * informative result. An exempt institution is not_licensed (exempt_institution). With no
 * evidence, the result is not_checked with its reason.
 */
export function summarizeL2(
  evidence: Evidence[],
  reason: L2Reason | null
): { result: EvidenceResult; reason: L2Reason | null; note: string | null } {
  const results = new Set(evidence.map((e) => e.result));
  const best = RESULT_PRIORITY.find((r) => results.has(r));
  const finalReason = best === "not_licensed" ? "exempt_institution" : best ? null : reason;
  return {
    result: best ?? "not_checked",
    reason: finalReason,
    note: finalReason ? (L2_REASON_NOTE[finalReason] ?? null) : null,
  };
}
