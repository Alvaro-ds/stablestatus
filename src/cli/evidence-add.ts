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
import { chainEntry, splitLines, verifyChain } from "../integrity/chain.js";
import { readStateFiles } from "../integrity/files.js";
import { ChangeEventSchema, IssuerSchema, ManualEvidenceRunRecordSchema } from "../model/index.js";
import type { ChangeEvent, Evidence } from "../model/index.js";

export interface AddEvidenceOptions {
  dataDir: string;
  changelogPath: string;
  input: unknown;
  now?: Date;
}

const readOrEmpty = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

/**
 * Appends one manual evidence line to data/evidence/evidence.jsonl, rebuilds checks.json
 * from the evidence on disk, appends any resulting change events and chains the new
 * published state in data/runs.jsonl with a manual_evidence line (ADR 0005).
 *
 * Order: verify the current chain, validate the input and compute every new file and the
 * chained line in memory; only then write evidence.jsonl, changes.jsonl and checks.json
 * (each to a .tmp file, then renamed) and, last, append the line to runs.jsonl. Any error
 * before the first rename leaves data/ untouched. If the process dies after a rename but
 * before the append, integrity:verify fails on the last line; restore data/ with git and
 * run the command again.
 */
export async function addManualEvidence(
  options: AddEvidenceOptions
): Promise<{ evidence: Evidence; events: ChangeEvent[] }> {
  const { dataDir } = options;
  const now = options.now ?? new Date();

  const runsPath = join(dataDir, "runs.jsonl");
  const runsBytes = existsSync(runsPath) ? readFileSync(runsPath) : new Uint8Array();
  const current = await verifyChain(
    splitLines(new TextDecoder().decode(runsBytes)),
    readStateFiles(dataDir)
  );
  if (!current.ok) {
    throw new Error(
      `integrity:verify already fails on the current data (runs.jsonl:${current.line}: ${current.reason}). Fix it before adding evidence.`
    );
  }

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

  const changesPath = join(dataDir, "changes.jsonl");
  const writes = new Map<string, string>([
    ["evidence/evidence.jsonl", readOrEmpty(evidencePath) + JSON.stringify(evidence) + "\n"],
    ["current/checks.json", JSON.stringify(checks, null, 2)],
  ]);
  if (events.length > 0) {
    const lines = events.map((e) => JSON.stringify(e) + "\n").join("");
    writes.set("changes.jsonl", readOrEmpty(changesPath) + lines);
  }
  const files = readStateFiles(dataDir);
  for (const [rel, text] of writes) files[`data/${rel}`] = new TextEncoder().encode(text);
  const entry = ManualEvidenceRunRecordSchema.parse(
    await chainEntry(
      runsBytes,
      {
        kind: "manual_evidence",
        at: now.toISOString(),
        evidenceIds: [evidence.id],
        events: events.length,
        critical: events.filter((e) => e.severity === "critical").length,
      },
      files
    )
  );

  mkdirSync(join(dataDir, "evidence"), { recursive: true });
  for (const [rel, text] of writes) writeFileSync(join(dataDir, `${rel}.tmp`), text, "utf8");
  for (const rel of writes.keys()) renameSync(join(dataDir, `${rel}.tmp`), join(dataDir, rel));
  appendFileSync(runsPath, JSON.stringify(entry) + "\n", "utf8");
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
      console.log("runs.jsonl: manual_evidence record chained.");
    })
    .catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
