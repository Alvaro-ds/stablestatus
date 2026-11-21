import { existsSync, readFileSync } from "node:fs";

import {
  ChecksFileSchema,
  EvidenceSchema,
  NationalIdsFileSchema,
  RunRecordSchema,
  isIngestRun,
} from "../model/index.js";
import type { Evidence, IngestRunRecord, IssuerChecks, NationalIdEntry } from "../model/index.js";
import { DNB_CSV_URL } from "../sources/dnb.js";

/** Consecutive days without a successful check before a source is listed in sourceAlerts. */
export const SOURCE_ALERT_DAYS = 3;

/** Automated sources checked in the daily ingest, as named in runs.jsonl. */
export type AutomatedSource = "gleif" | "eba" | "dnb";
/** Where an evidence record comes from: an automated source, or a manual check. */
export type EvidenceSource = AutomatedSource | "manual";

const EBA_DOWNLOADS = "https://euclid.eba.europa.eu/register/downloads/";

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

/** Ingest lines of runs.jsonl; manual evidence lines have no sources and are left out. */
export function readRuns(path: string): IngestRunRecord[] {
  return readLines(path)
    .map((l) => RunRecordSchema.parse(l))
    .filter(isIngestRun);
}

export function readChecks(path: string): IssuerChecks[] {
  if (!existsSync(path)) return [];
  return ChecksFileSchema.parse(JSON.parse(readFileSync(path, "utf8"))).issuers;
}

/** data/manual/national-ids.json, or no entries when the file does not exist. */
export function readNationalIds(path: string): NationalIdEntry[] {
  if (!existsSync(path)) return [];
  return NationalIdsFileSchema.parse(JSON.parse(readFileSync(path, "utf8"))).entries;
}

export function evidenceSource(
  e: Pick<Evidence, "sourceType" | "sourceUrl" | "method">
): EvidenceSource {
  if (e.method === "manual") return "manual";
  if (e.sourceType === "gleif") return "gleif";
  if (e.sourceType === "eba_register" && e.sourceUrl.startsWith(EBA_DOWNLOADS)) return "eba";
  if (e.sourceType === "nca_register" && e.sourceUrl === DNB_CSV_URL) return "dnb";
  return "manual";
}

/** One stream of observations: same issuer, check and source (each manual URL is its own stream). */
export function evidenceKey(e: Evidence): string {
  const source = evidenceSource(e);
  return `${e.issuerLei}|${e.check}|${source === "manual" ? `manual:${e.sourceUrl}` : source}`;
}

/** Latest evidence per stream (evidence.jsonl is append-only, so the last line wins). */
export function latestEvidence(evidence: Evidence[]): Map<string, Evidence> {
  const latest = new Map<string, Evidence>();
  for (const ev of evidence) latest.set(evidenceKey(ev), ev);
  return latest;
}

/** True when the observation is the same as the previous one, so no new evidence is needed. */
export function sameObservation(prev: Evidence | undefined, next: Evidence): boolean {
  if (!prev) return false;
  return (
    prev.result === next.result &&
    prev.nationalId === next.nationalId &&
    prev.matchedBy === next.matchedBy &&
    JSON.stringify(prev.observed) === JSON.stringify(next.observed)
  );
}

/** `at` of the last run where `source` was checked successfully, or null. */
export function sourceLastCheckedAt(
  runs: Pick<IngestRunRecord, "at" | "sources">[],
  source: AutomatedSource
): string | null {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i]?.sources?.[source]?.status === "ok") return runs[i]!.at;
  }
  return null;
}

/**
 * True when the last SOURCE_ALERT_DAYS distinct days with a check of `source` all ended
 * in not_checked. Runs that did not check the source (before it existed, file loads) are ignored.
 */
export function sourceNeedsAlert(
  runs: Pick<IngestRunRecord, "at" | "sources">[],
  source: AutomatedSource
): boolean {
  const lastPerDay = new Map<string, string>();
  for (const run of runs) {
    const status = run.sources?.[source]?.status;
    if (status) lastPerDay.set(run.at.slice(0, 10), status);
  }
  const statuses = [...lastPerDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-SOURCE_ALERT_DAYS)
    .map(([, status]) => status);
  return statuses.length === SOURCE_ALERT_DAYS && statuses.every((s) => s === "not_checked");
}
