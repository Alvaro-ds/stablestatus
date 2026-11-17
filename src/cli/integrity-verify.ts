import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { splitLines, verifyChain } from "../integrity/chain.js";
import type { VerifyResult } from "../integrity/chain.js";
import { readStateFiles } from "../integrity/files.js";

/** Verifies data/runs.jsonl under `root` and the current published files (ADR 0005). */
export async function integrityVerify(root: string): Promise<VerifyResult> {
  const dataDir = join(root, "data");
  const runsPath = join(dataDir, "runs.jsonl");
  const lines = existsSync(runsPath) ? splitLines(readFileSync(runsPath, "utf8")) : [];
  return verifyChain(lines, readStateFiles(dataDir));
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const result = await integrityVerify(resolve(process.argv[2] ?? "."));
  if (!result.ok) {
    console.error(`data/runs.jsonl:${result.line}: ${result.reason}`);
    console.error("Integrity check failed.");
    process.exit(1);
  }
  console.log("Integrity check passed.");
}
