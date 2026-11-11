import type { ChangeEvent, Discrepancy, Evidence, IssuerChecks, Signal } from "../model/index.js";
import { OBSERVED } from "./gleif-l1.js";

const FIELD_LABEL: Record<string, string> = {
  [OBSERVED.registrationStatus]: "LEI registration status",
  [OBSERVED.entityStatus]: "entity status",
  name: "legal name",
  country: "legal address country",
};

const label = (field: string) => FIELD_LABEL[field] ?? field;
const show = (value: string | null) => (value === null ? "not available" : `"${value}"`);
const signalKey = (s: Signal) => `${s.kind}|${JSON.stringify(s.observed)}`;
const causes = (s: Signal) => Object.entries(s.observed);
const discrepancyKey = (d: Discrepancy) =>
  `${d.kind}|${d.field}|${d.esmaValue ?? ""}|${d.otherValue ?? ""}`;

function sourceSuffix(evidence: Evidence | undefined): string {
  if (!evidence) return "";
  return ` Source: ${evidence.viewUrl ?? evidence.sourceUrl} (checked ${evidence.retrievedAt.slice(0, 10)}).`;
}

/** Fixed, neutral templates (ADR 0003 §D7). No adjectives, no conclusions. */
export function signalAddedMessage(signal: Signal, evidence: Evidence | undefined): string {
  const renewal =
    OBSERVED.registrationStatus in signal.observed
      ? ` (next renewal date ${(evidence?.observed[OBSERVED.nextRenewalDate] ?? "not available").slice(0, 10)})`
      : "";
  const text = causes(signal)
    .map(([field, value]) => `${label(field)} ${value ?? "not available"}`)
    .join("; ");
  return `GLEIF: ${text}${renewal}.${sourceSuffix(evidence)}`;
}

export function signalClearedMessage(signal: Signal, evidence: Evidence | undefined): string {
  const text = causes(signal)
    .map(
      ([field, value]) =>
        `${label(field)} ${evidence?.observed[field] ?? "not available"} (previously ${value ?? "not available"})`
    )
    .join("; ");
  return `GLEIF: ${text}.${sourceSuffix(evidence)}`;
}

export function discrepancyAddedMessage(d: Discrepancy, evidence: Evidence | undefined): string {
  return `ESMA register: ${label(d.field)} ${show(d.esmaValue)}. GLEIF: ${show(d.otherValue)}.${sourceSuffix(evidence)}`;
}

export function discrepancyResolvedMessage(d: Discrepancy, evidence: Evidence | undefined): string {
  return `No longer recorded as a discrepancy: ${label(d.field)}. Previously ESMA register: ${show(d.esmaValue)}. GLEIF: ${show(d.otherValue)}.${sourceSuffix(evidence)}`;
}

/**
 * Compares previous and next checks and returns change events for signals and
 * discrepancies. Issuers absent from `next` (delisted from ESMA) produce no events:
 * the ESMA diff already records their removal.
 */
export function diffChecks(
  prev: IssuerChecks[],
  next: IssuerChecks[],
  latestEvidence: Map<string, Evidence>,
  context: { at: string; fallbackSha256: string }
): ChangeEvent[] {
  const prevByLei = new Map(prev.map((c) => [c.lei, c]));
  const events: ChangeEvent[] = [];

  for (const nextChecks of next) {
    const lei = nextChecks.lei;
    const before = prevByLei.get(lei);
    const evidence = latestEvidence.get(lei);
    const base = {
      at: context.at,
      entity: "issuer" as const,
      key: lei,
      source: "gleif" as const,
      snapshotSha256: evidence?.contentSha256 ?? context.fallbackSha256,
    };

    const prevSignals = new Map((before?.signals ?? []).map((s) => [signalKey(s), s]));
    const nextSignals = new Map(nextChecks.signals.map((s) => [signalKey(s), s]));
    for (const [key, s] of nextSignals) {
      if (prevSignals.has(key)) continue;
      events.push({
        ...base,
        kind: "signal_added",
        field: s.kind,
        to: s,
        severity: s.severity,
        message: signalAddedMessage(s, evidence),
      });
    }
    for (const [key, s] of prevSignals) {
      if (nextSignals.has(key)) continue;
      events.push({
        ...base,
        kind: "signal_cleared",
        field: s.kind,
        from: s,
        severity: "info",
        message: signalClearedMessage(s, evidence),
      });
    }

    const prevDisc = new Map((before?.discrepancies ?? []).map((d) => [discrepancyKey(d), d]));
    const nextDisc = new Map(nextChecks.discrepancies.map((d) => [discrepancyKey(d), d]));
    for (const [key, d] of nextDisc) {
      if (prevDisc.has(key)) continue;
      events.push({
        ...base,
        kind: "discrepancy_added",
        field: d.kind,
        to: d,
        severity: d.kind === "name_format" ? "info" : "warning",
        message: discrepancyAddedMessage(d, evidence),
      });
    }
    for (const [key, d] of prevDisc) {
      if (nextDisc.has(key)) continue;
      events.push({
        ...base,
        kind: "discrepancy_resolved",
        field: d.kind,
        from: d,
        severity: "info",
        message: discrepancyResolvedMessage(d, evidence),
      });
    }
  }

  return events;
}
