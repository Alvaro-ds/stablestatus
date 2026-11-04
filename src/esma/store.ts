import {
  createHash,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { SourceSnapshot } from "../model/index.js";

const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;

export function computeSha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function findLatestStoredHash(
  dataDir: string,
  filename: string,
): string | null {
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

export function shouldStoreCsv(
  newHash: string,
  dataDir: string,
  filename: string,
): boolean {
  const existingHash = findLatestStoredHash(dataDir, filename);
  return existingHash !== newHash;
}

export function storeCsv(
  content: Buffer,
  dataDir: string,
  date: string,
  filename: string,
): void {
  const newHash = computeSha256(content);

  if (!shouldStoreCsv(newHash, dataDir, filename)) return;

  const destDir = join(dataDir, date);
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, filename), content);
}

export function writeManifest(
  dataDir: string,
  date: string,
  files: SourceSnapshot[],
): void {
  const destDir = join(dataDir, date);
  mkdirSync(destDir, { recursive: true });

  const manifest = {
    schemaVersion: 1 as const,
    date,
    files,
  };

  writeFileSync(
    join(destDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
}
