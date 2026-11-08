import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  existsSync,
  appendFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchEsmaCsv } from "../esma/fetch.js";
import { parseEsmaCsv } from "../esma/parse.js";
import { storeCsv, writeManifest, computeSha256 } from "../esma/store.js";
import { normalizeEmtwp } from "../normalize/index.js";
import { diffNormalized } from "../diff/diff.js";
import { regenerateChangelog } from "../diff/changelog.js";
import { ESMA_URLS } from "../esma/constants.js";
import { IssuerSchema, WhitePaperSchema, MetaSchema } from "../model/index.js";
import { ChangeEventSchema } from "../model/change-event.js";
import type { NormalizeResult } from "../normalize/index.js";
import type { SourceSnapshot } from "../model/index.js";
import type { ChangeEvent } from "../model/change-event.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestOptions {
  fromFile?: string;
  /** Required when fromFile is set: ISO-8601 UTC timestamp of when the file was actually downloaded from ESMA. */
  fetchedAt?: string;
  date?: string;
  dataDir: string;
  changelogPath: string;
  now?: Date;
  log?: (msg: string) => void;
  /** Override HTTP fetcher for tests. Called with the full CSV URL; must return raw bytes. */
  fetch?: (url: string) => Promise<Buffer>;
}

export interface IngestResult {
  skipped: boolean;
  reason?: string;
  events: ChangeEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadPreviousState(currentDir: string, changesPath: string): NormalizeResult | null {
  const issuersPath = join(currentDir, "issuers.json");
  const wpPath = join(currentDir, "whitepapers.json");
  const metaPath = join(currentDir, "meta.json");
  const currentExists = existsSync(issuersPath) && existsSync(wpPath) && existsSync(metaPath);
  const changesExists = existsSync(changesPath);

  // Consistency check: both must exist together or not at all.
  if (currentExists !== changesExists) {
    throw new Error(
      `Inconsistent state: data/current/ ${currentExists ? "exists" : "missing"} but ` +
        `changes.jsonl ${changesExists ? "exists" : "missing"}. ` +
        "Remove both or restore both before running ingest."
    );
  }

  if (!currentExists) return null;

  try {
    const issuers = IssuerSchema.array().parse(JSON.parse(readFileSync(issuersPath, "utf8")));
    const whitepapers = WhitePaperSchema.array().parse(JSON.parse(readFileSync(wpPath, "utf8")));
    const meta = MetaSchema.parse(JSON.parse(readFileSync(metaPath, "utf8")));
    return { issuers, whitepapers, meta };
  } catch (err) {
    throw new Error(
      `data/current/ exists but failed zod validation: ${err instanceof Error ? err.message : String(err)}. ` +
        "Remove data/current/ and changes.jsonl to start fresh."
    );
  }
}

function writeLastRun(
  dataDir: string,
  events: ChangeEvent[],
  emtwpSha256: string,
  artzzSha256: string | null
): void {
  const summary = {
    at: new Date().toISOString(),
    status: "ok",
    events: events.length,
    critical: events.filter((e) => e.severity === "critical").length,
    emtwpSha256,
    artzzSha256,
  };
  writeFileSync(join(dataDir, "last-run.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Core ingest function (exportable for tests)
// ---------------------------------------------------------------------------

export async function runIngest(options: IngestOptions): Promise<IngestResult> {
  const log = options.log ?? ((msg: string) => console.log(msg));
  const { dataDir, changelogPath } = options;
  const currentDir = join(dataDir, "current");
  const rawDir = join(dataDir, "raw");
  const changesPath = join(dataDir, "changes.jsonl");

  // Resolve date
  const today = new Date();
  const date = options.date ?? today.toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD.`);
  }

  // HTTP: use real execution time so future withdrawal dates are caught on the day they pass.
  // --from-file: use noon UTC on the given date (deterministic for historical loads).
  const now =
    options.now ?? (options.fromFile !== undefined ? new Date(`${date}T12:00:00Z`) : new Date());
  const url = ESMA_URLS.EMTWP;

  // --- Step 1: Fetch or read CSV ---
  let csvBuf: Buffer;
  let artzzBuf: Buffer | null = null;
  let fetchedAt: string;
  let retrieval: "http" | "file";

  if (options.fromFile !== undefined) {
    const filePath = resolve(options.fromFile);
    // Reject paths inside data/ to prevent circular provenance.
    const resolvedData = resolve(dataDir);
    if (filePath.startsWith(resolvedData + "/") || filePath.startsWith(resolvedData + "\\")) {
      throw new Error(`--from-file path must not be inside the data directory (${resolvedData})`);
    }
    if (!options.fetchedAt) {
      throw new Error(
        "--fetched-at <ISO> is required when using --from-file (record when the file was actually downloaded)"
      );
    }
    fetchedAt = options.fetchedAt;
    retrieval = "file";
    log(`Reading CSV from ${filePath}`);
    csvBuf = readFileSync(filePath);
  } else {
    fetchedAt = new Date().toISOString();
    retrieval = "http";
    log("Downloading EMTWP.csv and ARTZZ.csv from ESMA...");
    const fetcher = options.fetch ?? fetchEsmaCsv;
    [csvBuf, artzzBuf] = await Promise.all([fetcher(url), fetcher(ESMA_URLS.ARTZZ)]);
  }

  const sha256 = computeSha256(csvBuf);

  // --- Step 2: Parse ---
  log("Parsing CSV...");
  const parseResult = parseEsmaCsv(csvBuf, "EMTWP");

  const snapshot: SourceSnapshot = {
    url,
    fetchedAt,
    sha256,
    sizeBytes: csvBuf.length,
    rowCount: parseResult.rows.length,
    retrieval,
  };

  // Parse ARTZZ if available (HTTP mode only).
  let artzzSnapshot: SourceSnapshot | null = null;
  let artzzRowCount = 0;
  if (artzzBuf !== null) {
    const artzzSha256 = computeSha256(artzzBuf);
    const artzzParse = parseEsmaCsv(artzzBuf, "ARTZZ");
    artzzRowCount = artzzParse.rows.length;
    artzzSnapshot = {
      url: ESMA_URLS.ARTZZ,
      fetchedAt,
      sha256: artzzSha256,
      sizeBytes: artzzBuf.length,
      rowCount: artzzRowCount,
      retrieval,
    };
  }

  // --- Step 3: Normalize (always with real now — catches future withdrawal dates) ---
  log("Normalizing...");
  const nextState = normalizeEmtwp(parseResult, snapshot, date, now);

  // --- Step 4: Load and validate previous state (consistency check included) ---
  const prevState = loadPreviousState(currentDir, changesPath);

  // --- Step 5: Diff ---
  const events = diffNormalized(prevState, nextState, { at: fetchedAt, snapshotSha256: sha256 });

  // Emit art_register_non_empty if ARTZZ has data rows (first ART authorisation).
  if (artzzRowCount > 0) {
    events.push({
      at: fetchedAt,
      entity: "system",
      key: "artzz",
      kind: "art_register_non_empty",
      severity: "critical",
      snapshotSha256: sha256,
    });
  }

  // Validate each event before writing (fail fast if schema drifts).
  for (const event of events) {
    ChangeEventSchema.parse(event);
  }

  // --- Step 6: Always write daily manifest (even with no events) ---
  storeCsv(csvBuf, rawDir, date, "EMTWP.csv");
  const manifestSnapshots: SourceSnapshot[] = [snapshot];
  if (artzzBuf !== null && artzzSnapshot !== null) {
    storeCsv(artzzBuf, rawDir, date, "ARTZZ.csv");
    manifestSnapshots.push(artzzSnapshot);
  }
  writeManifest(rawDir, date, manifestSnapshots);

  if (events.length === 0) {
    log("No structural changes. Manifest updated.");
    writeLastRun(dataDir, [], sha256, artzzSnapshot?.sha256 ?? null);
    return { skipped: true, reason: "no_events", events: [] };
  }

  log(`${events.length} change event(s) detected.`);

  // --- Step 7: Atomic write to data/current/ ---
  // Write to .tmp files first, then append changes.jsonl, then rename.
  mkdirSync(currentDir, { recursive: true });
  const issuersTmp = join(currentDir, "issuers.json.tmp");
  const wpTmp = join(currentDir, "whitepapers.json.tmp");
  const metaTmp = join(currentDir, "meta.json.tmp");
  writeFileSync(issuersTmp, JSON.stringify(nextState.issuers, null, 2), "utf8");
  writeFileSync(wpTmp, JSON.stringify(nextState.whitepapers, null, 2), "utf8");
  writeFileSync(metaTmp, JSON.stringify(nextState.meta, null, 2), "utf8");

  // --- Step 8: Append to changes.jsonl (append-only, before rename) ---
  for (const event of events) {
    appendFileSync(changesPath, JSON.stringify(event) + "\n", "utf8");
  }

  // --- Step 9: Atomic rename ---
  renameSync(issuersTmp, join(currentDir, "issuers.json"));
  renameSync(wpTmp, join(currentDir, "whitepapers.json"));
  renameSync(metaTmp, join(currentDir, "meta.json"));

  // --- Step 10: Regenerate CHANGELOG-data.md ---
  await regenerateChangelog(changelogPath, changesPath);

  writeLastRun(dataDir, events, sha256, artzzSnapshot?.sha256 ?? null);

  log(`Done. ${nextState.issuers.length} issuers, ${nextState.whitepapers.length} whitepapers.`);

  return { skipped: false, events };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { fromFile?: string; date?: string; fetchedAt?: string } {
  const args: { fromFile?: string; date?: string; fetchedAt?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from-file" && i + 1 < argv.length) {
      const val = argv[++i];
      if (val !== undefined) args.fromFile = val;
    } else if (argv[i] === "--date" && i + 1 < argv.length) {
      const val = argv[++i];
      if (val !== undefined) args.date = val;
    } else if (argv[i] === "--fetched-at" && i + 1 < argv.length) {
      const val = argv[++i];
      if (val !== undefined) args.fetchedAt = val;
    }
  }
  return args;
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const args = parseArgs(process.argv.slice(2));

  if (args.fromFile && !args.date) {
    console.error("Error: --date <YYYY-MM-DD> is required when using --from-file");
    process.exit(1);
  }

  if (args.fromFile && !args.fetchedAt) {
    console.error(
      "Error: --fetched-at <ISO> is required when using --from-file (record when the file was actually downloaded from ESMA)"
    );
    process.exit(1);
  }

  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const PROJECT_ROOT = resolve(__dirname, "..", "..");

  const ingestOpts: IngestOptions = {
    dataDir: join(PROJECT_ROOT, "data"),
    changelogPath: join(PROJECT_ROOT, "CHANGELOG-data.md"),
  };
  if (args.fromFile !== undefined) ingestOpts.fromFile = args.fromFile;
  if (args.date !== undefined) ingestOpts.date = args.date;
  if (args.fetchedAt !== undefined) ingestOpts.fetchedAt = args.fetchedAt;

  runIngest(ingestOpts)
    .then((result) => {
      if (!result.skipped) {
        const hasCritical = result.events.some((e) => e.severity === "critical");
        if (hasCritical) {
          console.warn("CRITICAL events detected — review CHANGELOG-data.md");
        }
      }
    })
    .catch((err: unknown) => {
      console.error("Fatal error:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
