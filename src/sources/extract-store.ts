import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Only these files are ever written by this module (no path traversal). */
const ALLOWED_FILENAMES = new Set(["eba-pir-extract.json", "dnb-wfteg-extract.json"]);

/** A copy of the source records about our issuers, with the hashes that tie it to the download. */
export interface SourceExtract {
  sourceUrl: string;
  retrievedAt: string;
  contentSha256: string;
  recordsSha256: string;
  records: unknown[];
}

const StoredExtractSchema = z.object({ recordsSha256: z.string() });

/** sha256 of JSON.stringify(records) after sorting them by `key`: independent of source order. */
export function sortedRecordsSha256<T>(records: T[], key: (r: T) => string): string {
  const sorted = [...records].sort((a, b) => key(a).localeCompare(key(b)));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

function latestStoredRecordsSha256(rawDir: string, filename: string): string | null {
  if (!existsSync(rawDir)) return null;
  const dirs = readdirSync(rawDir)
    .filter((d) => DATE_DIR_RE.test(d))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const path = join(rawDir, dir, filename);
    if (existsSync(path)) {
      return StoredExtractSchema.parse(JSON.parse(readFileSync(path, "utf8"))).recordsSha256;
    }
  }
  return null;
}

/**
 * Writes `<rawDir>/<date>/<filename>` only when recordsSha256 differs from the last stored
 * extract. Returns true when a file was written.
 */
export function storeExtract(
  extract: SourceExtract,
  rawDir: string,
  date: string,
  filename: string
): boolean {
  if (!DATE_DIR_RE.test(date)) throw new Error(`Invalid date format for storage path: ${date}`);
  if (!ALLOWED_FILENAMES.has(filename)) throw new Error(`Unexpected extract filename: ${filename}`);
  if (latestStoredRecordsSha256(rawDir, filename) === extract.recordsSha256) return false;
  const destDir = join(rawDir, date);
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, filename), JSON.stringify(extract, null, 2) + "\n");
  return true;
}
