import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ManifestSchema } from "../model/index.js";
import type { SourceSnapshot } from "../model/index.js";

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

// Only these two filenames are ever written under data/raw/.
// Combined with DATE_DIR_RE, this prevents path-traversal attacks where a
// malicious filename like "../../etc/passwd" could escape the data directory.
const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_FILENAMES = new Set(["EMTWP.csv", "ARTZZ.csv"]);

function assertSafePath(date: string, filename: string): void {
  if (!DATE_DIR_RE.test(date)) {
    throw new Error(`Invalid date format for storage path: ${date}`);
  }
  if (!ALLOWED_FILENAMES.has(filename)) {
    throw new Error(`Unexpected filename for storage: ${filename}`);
  }
}

// ---------------------------------------------------------------------------
// SHA-256 helpers
// ---------------------------------------------------------------------------

/** Returns the lowercase hex SHA-256 of `buf`. */
export function computeSha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Finds the most recently stored copy of `filename` under `dataDir` and returns
 * its SHA-256, or null if no copy has been stored yet.
 */
function findLatestStoredHash(dataDir: string, filename: string): string | null {
  if (!existsSync(dataDir)) return null;

  const dateDirs = readdirSync(dataDir)
    .filter((d) => DATE_DIR_RE.test(d))
    .sort()
    .reverse();

  for (const dateDir of dateDirs) {
    const filePath = join(dataDir, dateDir, filename);
    if (existsSync(filePath)) {
      return computeSha256(readFileSync(filePath));
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true when `newHash` differs from the hash of the most recently stored
 * copy of `filename`.  Used to skip writing identical files day after day.
 */
export function shouldStoreCsv(newHash: string, dataDir: string, filename: string): boolean {
  const existingHash = findLatestStoredHash(dataDir, filename);
  return existingHash !== newHash;
}

/**
 * Writes `content` to `data/raw/<date>/<filename>` only if its SHA-256 differs
 * from the last stored copy.  Raw bytes (BOM, CRLF) are preserved exactly.
 */
export function storeCsv(content: Buffer, dataDir: string, date: string, filename: string): void {
  assertSafePath(date, filename);

  const newHash = computeSha256(content);
  if (!shouldStoreCsv(newHash, dataDir, filename)) return;

  const destDir = join(dataDir, date);
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, filename), content);
}

/**
 * Writes (or overwrites) `data/raw/<date>/manifest.json`.
 * Always written on every ingest run so the manifest reflects today's download
 * even when the CSV files themselves have not changed.
 */
export function writeManifest(dataDir: string, date: string, files: SourceSnapshot[]): void {
  if (!DATE_DIR_RE.test(date)) {
    throw new Error(`Invalid date format for manifest path: ${date}`);
  }

  // Validate through the schema before touching the filesystem.
  const manifest = ManifestSchema.parse({ schemaVersion: 1, date, files });

  const destDir = join(dataDir, date);
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}
