import { existsSync, readFileSync } from "node:fs";

import { ChecksFileSchema, EvidenceSchema, RunRecordSchema } from "../model/index.js";
import type { Evidence, IssuerChecks, RunRecord } from "../model/index.js";

/** Consecutive days without a successful check before a source is listed in sourceAlerts. */
export const SOURCE_ALERT_DAYS = 3;

function readLines(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as unknown);
}

export function readEvidence(path: string): Evidence[] {
  return readLines(path).map((l) => EvidenceSchema.parse(l));
}

export function readRuns(path: string): RunRecord[] {
  return readLines(path).map((l) => RunRecordSchema.parse(l));
}

export function readChecks(path: string): IssuerChecks[] {
  if (!existsSync(path)) return [];
  return ChecksFileSchema.parse(JSON.parse(readFileSync(path, "utf8"))).issuers;
}

/** Latest GLEIF L1 evidence per LEI (evidence.jsonl is append-only, so the last line wins). */
export function latestGleifEvidence(evidence: Evidence[]): Map<string, Evidence> {
  const latest = new Map<string, Evidence>();
  for (const ev of evidence) {
    if (ev.sourceType === "gleif" && ev.check === "L1") latest.set(ev.issuerLei, ev);
  }
  return latest;
}

/** True when the observation is the same as the previous one, so no new evidence is needed. */
export function sameObservation(prev: Evidence | undefined, next: Evidence): boolean {
  if (!prev) return false;
  return (
    prev.result === next.result &&
    prev.nationalId === next.nationalId &&
    JSON.stringify(prev.observed) === JSON.stringify(next.observed)
  );
}

/** `at` of the last run where GLEIF was checked successfully, or null. */
export function gleifLastCheckedAt(runs: RunRecord[]): string | null {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i]?.sources?.gleif.status === "ok") return runs[i]!.at;
  }
  return null;
}

/**
 * True when the last SOURCE_ALERT_DAYS distinct days with a GLEIF check all ended
 * in not_checked. Runs without a sources field (before B6, file loads) are ignored.
 */
export function gleifNeedsAlert(runs: Pick<RunRecord, "at" | "sources">[]): boolean {
  const lastPerDay = new Map<string, string>();
  for (const run of runs) {
    if (run.sources) lastPerDay.set(run.at.slice(0, 10), run.sources.gleif.status);
  }
  const statuses = [...lastPerDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-SOURCE_ALERT_DAYS)
    .map(([, status]) => status);
  return statuses.length === SOURCE_ALERT_DAYS && statuses.every((s) => s === "not_checked");
}
