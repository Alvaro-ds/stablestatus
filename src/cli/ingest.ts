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
import type { NormalizeResult } from "../normalize/index.js";
import type { SourceSnapshot } from "../model/index.js";
import type { ChangeEvent } from "../model/change-event.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestOptions {
  fromFile?: string;
  date?: string;
  dataDir: string;
  changelogPath: string;
  now?: Date;
  log?: (msg: string) => void;
}

export interface IngestResult {
  skipped: boolean;
  reason?: string;
  events: ChangeEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadPreviousState(currentDir: string): NormalizeResult | null {
  const issuersPath = join(currentDir, "issuers.json");
  const wpPath = join(currentDir, "whitepapers.json");
  const metaPath = join(currentDir, "meta.json");
  if (!existsSync(issuersPath) || !existsSync(wpPath) || !existsSync(metaPath)) return null;
  try {
    return {
      issuers: JSON.parse(readFileSync(issuersPath, "utf8")) as NormalizeResult["issuers"],
      whitepapers: JSON.parse(readFileSync(wpPath, "utf8")) as NormalizeResult["whitepapers"],
      meta: JSON.parse(readFileSync(metaPath, "utf8")) as NormalizeResult["meta"],
    };
  } catch {
    return null;
  }
}

function writeAtomically(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, filePath);
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
  const now = options.now ?? (options.fromFile !== undefined ? new Date(`${date}T12:00:00Z`) : new Date());
  const fetchedAt = new Date().toISOString();
  const url = ESMA_URLS.EMTWP;

  // --- Step 1: Fetch or read CSV ---
  let csvBuf: Buffer;
  if (options.fromFile) {
    const filePath = resolve(options.fromFile);
    log(`Reading CSV from ${filePath}`);
    csvBuf = readFileSync(filePath);
  } else {
    log("Downloading EMTWP.csv from ESMA...");
    csvBuf = await fetchEsmaCsv(url);
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
  };

  // --- Step 3: Normalize (always with real now — catches future withdrawal dates) ---
  log("Normalizing...");
  const nextState = normalizeEmtwp(parseResult, snapshot, date, now);

  // --- Step 4: Diff ---
  const prevState = loadPreviousState(currentDir);
  const events = diffNormalized(prevState, nextState, { at: fetchedAt, snapshotSha256: sha256 });

  if (events.length === 0) {
    log("No structural changes. Skipping write.");
    return { skipped: true, reason: "no_events", events: [] };
  }

  log(`${events.length} change event(s) detected.`);

  // --- Step 6: Atomic write to data/current/ ---
  mkdirSync(currentDir, { recursive: true });
  writeAtomically(join(currentDir, "issuers.json"), JSON.stringify(nextState.issuers, null, 2));
  writeAtomically(join(currentDir, "whitepapers.json"), JSON.stringify(nextState.whitepapers, null, 2));
  writeAtomically(join(currentDir, "meta.json"), JSON.stringify(nextState.meta, null, 2));

  // --- Step 7: Store raw CSV ---
  storeCsv(csvBuf, rawDir, date, "EMTWP.csv");
  writeManifest(rawDir, date, [snapshot]);

  // --- Step 8: Append to changes.jsonl ---
  for (const event of events) {
    appendFileSync(changesPath, JSON.stringify(event) + "\n", "utf8");
  }

  // --- Step 9: Regenerate CHANGELOG-data.md ---
  await regenerateChangelog(changelogPath, changesPath);

  log(`Done. ${nextState.issuers.length} issuers, ${nextState.whitepapers.length} whitepapers.`);

  return { skipped: false, events };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { fromFile?: string; date?: string } {
  const args: { fromFile?: string; date?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from-file" && i + 1 < argv.length) {
      const val = argv[++i];
      if (val !== undefined) args.fromFile = val;
    } else if (argv[i] === "--date" && i + 1 < argv.length) {
      const val = argv[++i];
      if (val !== undefined) args.date = val;
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

  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const PROJECT_ROOT = resolve(__dirname, "..", "..");

  const ingestOpts: IngestOptions = {
    dataDir: join(PROJECT_ROOT, "data"),
    changelogPath: join(PROJECT_ROOT, "CHANGELOG-data.md"),
  };
  if (args.fromFile !== undefined) ingestOpts.fromFile = args.fromFile;
  if (args.date !== undefined) ingestOpts.date = args.date;

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
