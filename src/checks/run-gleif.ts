import { join } from "node:path";

import { ChecksFileSchema } from "../model/index.js";
import type { ChangeEvent, ChecksFile, Evidence, Issuer, SourceRun } from "../model/index.js";
import { storeGleifRaw } from "../sources/gleif.js";
import type { GleifFetchResult } from "../sources/gleif.js";
import { diffChecks } from "./events.js";
import { buildL1Evidence, deriveIssuerChecks } from "./gleif-l1.js";
import {
  gleifLastCheckedAt,
  gleifNeedsAlert,
  latestGleifEvidence,
  readChecks,
  readEvidence,
  readRuns,
  sameObservation,
} from "./store.js";

export type GleifFetcher = (leis: string[]) => Promise<GleifFetchResult>;

export interface GleifStepInput {
  issuers: Issuer[];
  dataDir: string;
  date: string;
  runAt: string;
  esmaSha256: string;
  fetch: GleifFetcher;
  log: (msg: string) => void;
}

export interface GleifStepResult {
  sourceRun: SourceRun;
  newEvidence: Evidence[];
  checks: ChecksFile;
  events: ChangeEvent[];
  alert: boolean;
}

/**
 * Runs the GLEIF L1 check for the current ESMA issuers. Never throws for GLEIF
 * failures: the source is then recorded as not_checked and checks are rebuilt
 * from the evidence already on disk. Writes only the raw response (data/raw/).
 */
export async function runGleifStep(input: GleifStepInput): Promise<GleifStepResult> {
  const { issuers, dataDir, runAt, log } = input;
  const runs = readRuns(join(dataDir, "runs.jsonl"));
  const latest = latestGleifEvidence(readEvidence(join(dataDir, "evidence", "evidence.jsonl")));
  const prevChecks = readChecks(join(dataDir, "current", "checks.json"));

  const newEvidence: Evidence[] = [];
  let sourceRun: SourceRun;
  let eventsAt = runAt;

  try {
    const result = await input.fetch(issuers.map((i) => i.lei));
    const byLei = new Map(result.records.map((r) => [r.lei, r]));
    const snapshot = {
      sourceUrl: result.url,
      retrievedAt: result.retrievedAt,
      contentSha256: result.contentSha256,
    };
    for (const issuer of issuers) {
      const evidence = buildL1Evidence(issuer.lei, byLei.get(issuer.lei), snapshot);
      if (sameObservation(latest.get(issuer.lei), evidence)) continue;
      newEvidence.push(evidence);
      latest.set(issuer.lei, evidence);
    }
    storeGleifRaw(result.body, result.recordsSha256, join(dataDir, "raw"), input.date);
    sourceRun = {
      status: "ok",
      contentSha256: result.contentSha256,
      recordsSha256: result.recordsSha256,
    };
    eventsAt = result.retrievedAt;
    log(`GLEIF: ${result.records.length} record(s), ${newEvidence.length} new evidence line(s).`);
  } catch (err) {
    log(`GLEIF not checked: ${err instanceof Error ? err.message : String(err)}`);
    sourceRun = { status: "not_checked", contentSha256: null, recordsSha256: null };
  }

  const lastCheckedAt = sourceRun.status === "ok" ? runAt : gleifLastCheckedAt(runs);
  const issuerChecks = issuers
    .map((i) => deriveIssuerChecks(i, latest.get(i.lei), latest.has(i.lei) ? lastCheckedAt : null))
    .sort((a, b) => a.lei.localeCompare(b.lei));
  const checks = ChecksFileSchema.parse({
    schemaVersion: 1,
    generatedAt: runAt,
    issuers: issuerChecks,
  });
  const events = diffChecks(prevChecks, issuerChecks, latest, {
    at: eventsAt,
    fallbackSha256: input.esmaSha256,
  });
  const alert = gleifNeedsAlert([...runs, { at: runAt, sources: { gleif: sourceRun } }]);

  return { sourceRun, newEvidence, checks, events, alert };
}
