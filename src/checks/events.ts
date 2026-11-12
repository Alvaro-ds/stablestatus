import type { ChangeEvent, Discrepancy, Evidence, IssuerChecks, Signal } from "../model/index.js";
import { OBSERVED } from "./gleif-l1.js";
import { evidenceKey, evidenceSource } from "./store.js";
import type { EvidenceSource } from "./store.js";

const FIELD_LABEL: Record<string, string> = {
  [OBSERVED.registrationStatus]: "LEI registration status",
  [OBSERVED.entityStatus]: "entity status",
  name: "legal name",
  country: "legal address country",
  ENT_AUT: "Authorised/Withdrawn dates",
  Einddatum: "licence end date",
  Inliquidatie: "in liquidation",
  DatumInLiquidatie: "liquidation date",
};

/** Source names used in public text (ADR 0003 §D7). */
const SOURCE_LABEL: Record<EvidenceSource, string> = {
  gleif: "GLEIF",
  eba: "EBA Register under PSD2",
  dnb: "DNB public register",
  manual: "Official register (manual check)",
};

const label = (field: string) => FIELD_LABEL[field] ?? field;
const show = (value: string | null) => (value === null ? "not available" : `"${value}"`);
const signalKey = (s: Signal) => `${s.kind}|${JSON.stringify(s.observed)}`;
const causes = (s: Signal) => Object.entries(s.observed);
const discrepancyKey = (d: Discrepancy) =>
  `${d.kind}|${d.field}|${d.esmaValue ?? ""}|${d.otherValue ?? ""}`;
const sourceLabel = (evidence: Evidence | undefined) =>
  SOURCE_LABEL[evidence ? evidenceSource(evidence) : "gleif"];

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
  return `${sourceLabel(evidence)}: ${text}${renewal}.${sourceSuffix(evidence)}`;
}

export function signalClearedMessage(signal: Signal, evidence: Evidence | undefined): string {
  const text = causes(signal)
    .map(
      ([field, value]) =>
        `${label(field)} ${evidence?.observed[field] ?? "not available"} (previously ${value ?? "not available"})`
    )
    .join("; ");
  return `${sourceLabel(evidence)}: ${text}.${sourceSuffix(evidence)}`;
}

export function discrepancyAddedMessage(d: Discrepancy, evidence: Evidence | undefined): string {
  return `ESMA register: ${label(d.field)} ${show(d.esmaValue)}. ${sourceLabel(evidence)}: ${show(d.otherValue)}.${sourceSuffix(evidence)}`;
}

export function discrepancyResolvedMessage(d: Discrepancy, evidence: Evidence | undefined): string {
  return `No longer recorded as a discrepancy: ${label(d.field)}. Previously ESMA register: ${show(d.esmaValue)}. ${sourceLabel(evidence)}: ${show(d.otherValue)}.${sourceSuffix(evidence)}`;
}

/**
 * Compares previous and next checks and returns change events for signals and
 * discrepancies. Each event names the source of the evidence behind it. Issuers absent
 * from `next` (delisted from ESMA) produce no events: the ESMA diff records their removal.
 *
 * @param evidenceById every evidence record, to find the one a signal or discrepancy cites
 * @param latest latest evidence per stream (see evidenceKey), for the current values
 */
export function diffChecks(
  prev: IssuerChecks[],
  next: IssuerChecks[],
  evidenceById: Map<string, Evidence>,
  latest: Map<string, Evidence>,
  context: { at: string; fallbackSha256: string }
): ChangeEvent[] {
  const prevByLei = new Map(prev.map((c) => [c.lei, c]));
  const events: ChangeEvent[] = [];
  const current = (ev: Evidence | undefined) =>
    ev ? (latest.get(evidenceKey(ev)) ?? ev) : undefined;
  const base = (lei: string, evidence: Evidence | undefined) => ({
    at: context.at,
    entity: "issuer" as const,
    key: lei,
    source: evidence ? evidenceSource(evidence) : ("gleif" as const),
    snapshotSha256: evidence?.contentSha256 ?? context.fallbackSha256,
  });

  for (const nextChecks of next) {
    const lei = nextChecks.lei;
    const before = prevByLei.get(lei);

    const prevSignals = new Map((before?.signals ?? []).map((s) => [signalKey(s), s]));
    const nextSignals = new Map(nextChecks.signals.map((s) => [signalKey(s), s]));
    for (const [key, s] of nextSignals) {
      if (prevSignals.has(key)) continue;
      const evidence = evidenceById.get(s.evidenceId);
      events.push({
        ...base(lei, evidence),
        kind: "signal_added",
        field: s.kind,
        to: s,
        severity: s.severity,
        message: signalAddedMessage(s, evidence),
      });
    }
    for (const [key, s] of prevSignals) {
      if (nextSignals.has(key)) continue;
      const evidence = current(evidenceById.get(s.evidenceId));
      events.push({
        ...base(lei, evidence),
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
      const evidence = evidenceById.get(d.evidenceId);
      events.push({
        ...base(lei, evidence),
        kind: "discrepancy_added",
        field: d.kind,
        to: d,
        severity: d.kind === "name_format" ? "info" : "warning",
        message: discrepancyAddedMessage(d, evidence),
      });
    }
    for (const [key, d] of prevDisc) {
      if (nextDisc.has(key)) continue;
      const evidence = current(evidenceById.get(d.evidenceId));
      events.push({
        ...base(lei, evidence),
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
