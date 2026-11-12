import type { CheckLevel, Evidence, Issuer, IssuerChecks, L2Reason } from "../model/index.js";
import { deriveGleifDiscrepancies, deriveGleifSignals } from "./gleif-l1.js";
import { deriveL2Signals, summarizeL2 } from "./l2.js";

/** Latest evidence of one issuer, per check. */
export interface IssuerEvidence {
  l1?: Evidence | undefined;
  /** One per source: EBA, DNB and each manual check. */
  l2: Evidence[];
  l3: Evidence[];
  /** Why there is no L2 evidence, when there is none. */
  l2Reason: L2Reason | null;
}

export type LastCheckedAt = IssuerChecks["lastCheckedAt"];

/** Highest level confirmed by at least one official source (ADR 0003 §D4). */
export function levelReached(ev: IssuerEvidence): CheckLevel | null {
  if (ev.l3.some((e) => e.result === "confirmed")) return "L3";
  if (ev.l2.some((e) => e.result === "confirmed")) return "L2";
  if (ev.l1?.result === "confirmed") return "L1";
  return null;
}

/** Derives one issuer's checks from its latest evidence. */
export function deriveIssuerChecks(
  issuer: Issuer,
  ev: IssuerEvidence,
  lastCheckedAt: LastCheckedAt
): IssuerChecks {
  return {
    lei: issuer.lei,
    levelReached: levelReached(ev),
    discrepancies: ev.l1 ? deriveGleifDiscrepancies(issuer, ev.l1) : [],
    signals: [...(ev.l1 ? deriveGleifSignals(ev.l1) : []), ...ev.l2.flatMap(deriveL2Signals)],
    l2: summarizeL2(ev.l2, ev.l2Reason),
    lastCheckedAt,
  };
}
