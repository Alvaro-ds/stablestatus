import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads the published files covered by stateSha256 (ADR 0005), keyed by their path
 * from the repository root: data/current/*.json, data/changes.jsonl and
 * data/evidence/evidence.jsonl. Missing files are left out.
 */
export function readStateFiles(dataDir: string): Record<string, Uint8Array> {
  const currentDir = join(dataDir, "current");
  const current = existsSync(currentDir)
    ? readdirSync(currentDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => `current/${name}`)
    : [];
  const files: Record<string, Uint8Array> = {};
  for (const rel of [...current, "changes.jsonl", "evidence/evidence.jsonl"]) {
    const path = join(dataDir, rel);
    if (existsSync(path)) files[`data/${rel}`] = readFileSync(path);
  }
  return files;
}
