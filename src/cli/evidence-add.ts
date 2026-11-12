import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { diffChecks } from "../checks/events.js";
import { buildManualEvidence } from "../checks/manual.js";
import { buildChecksFile } from "../checks/run-checks.js";
import { latestEvidence, readChecks, readEvidence, readRuns } from "../checks/store.js";
import { regenerateChangelog } from "../diff/changelog.js";
import { ChangeEventSchema, IssuerSchema } from "../model/index.js";
import type { ChangeEvent, Evidence } from "../model/index.js";

export interface AddEvidenceOptions {
  dataDir: string;
  changelogPath: string;
  input: unknown;
  now?: Date;
}

/**
 * Appends one manual evidence line to data/evidence/evidence.jsonl, rebuilds checks.json
 * from the evidence on disk and appends any resulting change events.
 */
export async function addManualEvidence(
  options: AddEvidenceOptions
): Promise<{ evidence: Evidence; events: ChangeEvent[] }> {
  const { dataDir } = options;
  const now = options.now ?? new Date();
  const evidence = buildManualEvidence(options.input, now);

  const issuersPath = join(dataDir, "current", "issuers.json");
  if (!existsSync(issuersPath)) throw new Error(`Missing ${issuersPath}: run the ingest first`);
  const issuers = IssuerSchema.array().parse(JSON.parse(readFileSync(issuersPath, "utf8")));
  if (!issuers.some((i) => i.lei === evidence.issuerLei)) {
    throw new Error(`${evidence.issuerLei} is not an issuer in the ESMA register`);
  }

  const evidencePath = join(dataDir, "evidence", "evidence.jsonl");
  const all = readEvidence(evidencePath);
  if (all.some((e) => e.id === evidence.id)) {
    throw new Error("This evidence (same issuer, check, URL and time) is already recorded");
  }

  const checksPath = join(dataDir, "current", "checks.json");
  const prevChecks = readChecks(checksPath);
  const prevReason = new Map(prevChecks.map((c) => [c.lei, c.l2.reason]));
  const latest = latestEvidence([...all, evidence]);
  const checks = buildChecksFile({
    issuers,
    latest,
    runs: readRuns(join(dataDir, "runs.jsonl")),
    runAt: now.toISOString(),
    l2Reason: (issuer) => prevReason.get(issuer.lei) ?? null,
  });
  const events = diffChecks(
    prevChecks,
    checks.issuers,
    new Map([...all, evidence].map((e) => [e.id, e])),
    latest,
    { at: now.toISOString(), fallbackSha256: evidence.contentSha256 }
  );
  for (const event of events) ChangeEventSchema.parse(event);

  const tmp = `${checksPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(checks, null, 2), "utf8");
  mkdirSync(join(dataDir, "evidence"), { recursive: true });
  appendFileSync(evidencePath, JSON.stringify(evidence) + "\n", "utf8");
  const changesPath = join(dataDir, "changes.jsonl");
  for (const event of events) appendFileSync(changesPath, JSON.stringify(event) + "\n", "utf8");
  renameSync(tmp, checksPath);
  if (events.length > 0) await regenerateChangelog(options.changelogPath, changesPath);

  return { evidence, events };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const FIELDS = [
  "issuerLei",
  "check",
  "sourceType",
  "sourceUrl",
  "retrievedAt",
  "contentSha256",
  "matchedBy",
  "nationalId",
  "observed",
  "result",
] as const;

/** `--file <json>` and/or `--<field> <value>` (flags win); `--observed` takes a JSON object. */
export function parseEvidenceArgs(argv: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--") continue;
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`Unexpected argument: ${flag ?? ""}`);
    }
    const name = flag.slice(2);
    i++;
    if (name === "file") {
      Object.assign(out, {
        ...(JSON.parse(readFileSync(resolve(value), "utf8")) as object),
        ...out,
      });
    } else if ((FIELDS as readonly string[]).includes(name)) {
      out[name] = name === "observed" ? (JSON.parse(value) as unknown) : value;
    } else {
      throw new Error(`Unknown option --${name}`);
    }
  }
  return out;
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
  Promise.resolve()
    .then(() =>
      addManualEvidence({
        dataDir: join(root, "data"),
        changelogPath: join(root, "CHANGELOG-data.md"),
        input: parseEvidenceArgs(process.argv.slice(2)),
      })
    )
    .then(({ evidence, events }) => {
      console.log(`Evidence ${evidence.id} added (${evidence.check}, ${evidence.result}).`);
      console.log(`checks.json rebuilt; ${events.length} change event(s).`);
    })
    .catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
