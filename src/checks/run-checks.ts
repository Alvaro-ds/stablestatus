import { join } from "node:path";

import { ChecksFileSchema } from "../model/index.js";
import type {
  ChangeEvent,
  ChecksFile,
  Evidence,
  Issuer,
  L2Reason,
  RunRecord,
  SourceRun,
} from "../model/index.js";
import { computeDnbRecordsSha256, selectDnbRows, storeDnbExtract } from "../sources/dnb.js";
import type { DnbFetchResult } from "../sources/dnb.js";
import { computeEbaRecordsSha256, storeEbaExtract } from "../sources/eba.js";
import type { EbaEntity, EbaFetchResult } from "../sources/eba.js";
import { storeGleifRaw } from "../sources/gleif.js";
import type { GleifFetchResult } from "../sources/gleif.js";
import { deriveIssuerChecks } from "./derive.js";
import { diffChecks } from "./events.js";
import { OBSERVED, buildL1Evidence } from "./gleif-l1.js";
import {
  buildDnbEvidence,
  buildEbaEvidence,
  isCreditInstitution,
  matchDnb,
  matchEba,
} from "./l2.js";
import {
  evidenceKey,
  evidenceSource,
  latestEvidence,
  readChecks,
  readEvidence,
  readNationalIds,
  readRuns,
  sameObservation,
  sourceLastCheckedAt,
  sourceNeedsAlert,
} from "./store.js";
import type { AutomatedSource } from "./store.js";

export type GleifFetcher = (leis: string[]) => Promise<GleifFetchResult>;
export type EbaFetcher = () => Promise<EbaFetchResult>;
export type DnbFetcher = () => Promise<DnbFetchResult>;

export interface ChecksStepInput {
  issuers: Issuer[];
  dataDir: string;
  date: string;
  runAt: string;
  esmaSha256: string;
  gleif: GleifFetcher;
  /** L2 sources. When absent, the source is not part of this run at all. */
  eba?: EbaFetcher;
  dnb?: DnbFetcher;
  log: (msg: string) => void;
}

export interface ChecksStepResult {
  sources: { gleif: SourceRun; eba?: SourceRun; dnb?: SourceRun };
  newEvidence: Evidence[];
  checks: ChecksFile;
  events: ChangeEvent[];
  sourceAlerts: AutomatedSource[];
}

const snapshotOf = (r: { url: string; retrievedAt: string; contentSha256: string }) => ({
  sourceUrl: r.url,
  retrievedAt: r.retrievedAt,
  contentSha256: r.contentSha256,
});

const NOT_CHECKED: SourceRun = { status: "not_checked", contentSha256: null, recordsSha256: null };
const DNB_HOME = "NL";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Rebuilds checks.json from the latest evidence per stream. `l2Reason` explains a missing
 * L2 result for issuers that are not credit institutions (those are never in the PSD2 register).
 */
export function buildChecksFile(input: {
  issuers: Issuer[];
  latest: Map<string, Evidence>;
  runs: Pick<RunRecord, "at" | "sources">[];
  runAt: string;
  l2Reason: (issuer: Issuer) => L2Reason | null;
}): ChecksFile {
  const lastChecked = (source: AutomatedSource) => sourceLastCheckedAt(input.runs, source);
  const byLei = new Map<string, Evidence[]>();
  for (const ev of input.latest.values()) {
    byLei.set(ev.issuerLei, [...(byLei.get(ev.issuerLei) ?? []), ev]);
  }
  const issuerChecks = input.issuers
    .map((issuer) => {
      const evs = byLei.get(issuer.lei) ?? [];
      const has = (source: AutomatedSource) => evs.some((e) => evidenceSource(e) === source);
      return deriveIssuerChecks(
        issuer,
        {
          l1: input.latest.get(`${issuer.lei}|L1|gleif`),
          l2: evs.filter((e) => e.check === "L2"),
          l3: evs.filter((e) => e.check === "L3"),
          l2Reason: isCreditInstitution(issuer)
            ? "no_automated_official_source"
            : input.l2Reason(issuer),
        },
        {
          gleif: has("gleif") ? lastChecked("gleif") : null,
          eba: has("eba") ? lastChecked("eba") : null,
          dnb: has("dnb") ? lastChecked("dnb") : null,
        }
      );
    })
    .sort((a, b) => a.lei.localeCompare(b.lei));
  return ChecksFileSchema.parse({
    schemaVersion: 1,
    generatedAt: input.runAt,
    issuers: issuerChecks,
  });
}

/**
 * Runs the GLEIF (L1), DNB and EBA (L2) checks for the current ESMA issuers, in that order.
 * Never throws for a source failure: that source is recorded as not_checked and checks are
 * rebuilt from the evidence already on disk. Writes only the raw extracts (data/raw/).
 */
export async function runChecksStep(input: ChecksStepInput): Promise<ChecksStepResult> {
  const { issuers, dataDir, runAt, date, log } = input;
  const rawDir = join(dataDir, "raw");
  const runs = readRuns(join(dataDir, "runs.jsonl"));
  const allEvidence = readEvidence(join(dataDir, "evidence", "evidence.jsonl"));
  const latest = latestEvidence(allEvidence);
  const prevChecks = readChecks(join(dataDir, "current", "checks.json"));
  const nationalIds = readNationalIds(join(dataDir, "manual", "national-ids.json"));
  const newEvidence: Evidence[] = [];
  const latestOf = (lei: string, check: string, source: AutomatedSource) =>
    latest.get(`${lei}|${check}|${source}`);
  const record = (evidence: Evidence) => {
    if (sameObservation(latest.get(evidenceKey(evidence)), evidence)) return;
    newEvidence.push(evidence);
    latest.set(evidenceKey(evidence), evidence);
  };
  let eventsAt = runAt;

  // --- GLEIF (L1) ---
  let gleifRun = NOT_CHECKED;
  try {
    const result = await input.gleif(issuers.map((i) => i.lei));
    const byLei = new Map(result.records.map((r) => [r.lei, r]));
    for (const issuer of issuers)
      record(buildL1Evidence(issuer.lei, byLei.get(issuer.lei), snapshotOf(result)));
    storeGleifRaw(result.body, result.recordsSha256, rawDir, date);
    gleifRun = {
      status: "ok",
      contentSha256: result.contentSha256,
      recordsSha256: result.recordsSha256,
    };
    eventsAt = result.retrievedAt;
    log(`GLEIF: ${result.records.length} record(s).`);
  } catch (err) {
    log(`GLEIF not checked: ${errorMessage(err)}`);
  }

  const eligible = issuers.filter((i) => !isCreditInstitution(i));

  // --- DNB (L2, issuers with home member state NL, matched by LEI) ---
  let dnbRun: SourceRun | undefined;
  const dnbRelations = new Map<string, string[]>();
  if (input.dnb) {
    try {
      const result = await input.dnb();
      const records = result.rows.map((r) => r.record);
      for (const issuer of eligible) {
        const licence = matchDnb(issuer.lei, records);
        if (licence) dnbRelations.set(issuer.lei, [licence.relationNumber]);
        if (issuer.homeMemberState.toUpperCase() === DNB_HOME) {
          record(buildDnbEvidence(issuer.lei, licence, snapshotOf(result)));
        }
      }
      const selected = selectDnbRows(
        result.rows,
        issuers.map((i) => i.lei)
      );
      storeDnbExtract(result, selected, rawDir, date);
      dnbRun = {
        status: "ok",
        contentSha256: result.contentSha256,
        recordsSha256: computeDnbRecordsSha256(selected.map((r) => r.record)),
      };
      log(`DNB: ${selected.length} record(s) of our issuers.`);
    } catch (err) {
      log(`DNB not checked: ${errorMessage(err)}`);
      dnbRun = NOT_CHECKED;
    }
  }

  // --- EBA (L2, by LEI or national ID; banks are not in the PSD2 register) ---
  let ebaRun: SourceRun | undefined;
  const l2Reasons = new Map<string, L2Reason>();
  if (input.eba) {
    try {
      const result = await input.eba();
      const records = result.entities.map((e) => e.record);
      const selected: EbaEntity[] = [];
      for (const issuer of eligible) {
        const previous = latestOf(issuer.lei, "L2", "eba")?.observed["EntityCode"] ?? null;
        const dnbPrevious = latestOf(issuer.lei, "L2", "dnb")?.nationalId;
        const match = matchEba(
          issuer,
          {
            registeredAs:
              latestOf(issuer.lei, "L1", "gleif")?.observed[OBSERVED.registeredAs] ?? null,
            dnbRelationNumbers: dnbRelations.get(issuer.lei) ?? (dnbPrevious ? [dnbPrevious] : []),
            manual: nationalIds.filter((n) => n.lei === issuer.lei),
            previousEntityCode: previous,
          },
          records
        );
        if (match.kind === "unmatched") {
          l2Reasons.set(issuer.lei, match.reason);
          continue;
        }
        if (match.kind === "found") {
          const entity = result.entities.find(
            (e) => e.record.entityCode === match.record.entityCode
          );
          if (entity) selected.push(entity);
        }
        record(buildEbaEvidence(issuer.lei, match, snapshotOf(result)));
      }
      storeEbaExtract(result, selected, rawDir, date);
      ebaRun = {
        status: "ok",
        contentSha256: result.contentSha256,
        recordsSha256: computeEbaRecordsSha256(selected.map((e) => e.record)),
      };
      log(`EBA: ${selected.length} of ${eligible.length} eligible issuer(s) found.`);
    } catch (err) {
      log(`EBA not checked: ${errorMessage(err)}`);
      ebaRun = NOT_CHECKED;
    }
  }

  // --- Rebuild checks.json from all latest evidence ---
  const sources = {
    gleif: gleifRun,
    ...(ebaRun ? { eba: ebaRun } : {}),
    ...(dnbRun ? { dnb: dnbRun } : {}),
  };
  const runsNow = [...runs, { at: runAt, sources }];
  const checks = buildChecksFile({
    issuers,
    latest,
    runs: runsNow,
    runAt,
    l2Reason: (issuer) =>
      l2Reasons.get(issuer.lei) ?? (ebaRun?.status === "ok" ? null : "source_unavailable"),
  });

  const evidenceById = new Map([...allEvidence, ...newEvidence].map((e) => [e.id, e]));
  const events = diffChecks(prevChecks, checks.issuers, evidenceById, latest, {
    at: eventsAt,
    fallbackSha256: input.esmaSha256,
  });
  const sourceAlerts = (["gleif", "eba", "dnb"] as const).filter(
    (s) => s in sources && sourceNeedsAlert(runsNow, s)
  );

  return { sources, newEvidence, checks, events, sourceAlerts };
}
