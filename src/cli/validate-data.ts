import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";

import {
  ChangeEventSchema,
  ChecksFileSchema,
  EvidenceSchema,
  IssuerSchema,
  ManifestSchema,
  MetaSchema,
  NationalIdsFileSchema,
  RunRecordSchema,
  WhitePaperSchema,
} from "../model/index.js";

export interface DataError {
  file: string;
  line?: number;
  message: string;
}

const CONFLICT_RE = /^(<{7}|={7}|>{7})/;

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

export function validateData(root: string): DataError[] {
  const errors: DataError[] = [];
  const rel = (path: string) => relative(root, path).replaceAll("\\", "/");
  const dataDir = join(root, "data");
  const broken = new Set<string>();

  const changelog = join(root, "CHANGELOG-data.md");
  const scanned = [...listFiles(dataDir), ...(existsSync(changelog) ? [changelog] : [])];
  for (const path of scanned) {
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .forEach((text, i) => {
        if (CONFLICT_RE.test(text)) {
          errors.push({ file: rel(path), line: i + 1, message: "Git conflict marker" });
          broken.add(path);
        }
      });
  }

  function readJson<T>(path: string, schema: z.ZodType<T>): T | null {
    if (!existsSync(path)) {
      errors.push({ file: rel(path), message: "File is missing" });
      return null;
    }
    if (broken.has(path)) return null;
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      errors.push({ file: rel(path), message: `Invalid JSON: ${(err as Error).message}` });
      return null;
    }
    const result = schema.safeParse(value);
    if (!result.success) {
      errors.push({ file: rel(path), message: zodMessage(result.error) });
      return null;
    }
    return result.data;
  }

  function readJsonl<T>(path: string, schema: z.ZodType<T>): Array<{ value: T; line: number }> {
    if (!existsSync(path)) {
      errors.push({ file: rel(path), message: "File is missing" });
      return [];
    }
    if (broken.has(path)) return [];
    const rows: Array<{ value: T; line: number }> = [];
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .forEach((text, i) => {
        if (text.trim() === "") return;
        const line = i + 1;
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch (err) {
          errors.push({
            file: rel(path),
            line,
            message: `Invalid JSON: ${(err as Error).message}`,
          });
          return;
        }
        const result = schema.safeParse(value);
        if (result.success) rows.push({ value: result.data, line });
        else errors.push({ file: rel(path), line, message: zodMessage(result.error) });
      });
    return rows;
  }

  const current = join(dataDir, "current");
  const issuers = readJson(join(current, "issuers.json"), IssuerSchema.array());
  readJson(join(current, "whitepapers.json"), WhitePaperSchema.array());
  const meta = readJson(join(current, "meta.json"), MetaSchema);
  const checksPath = join(current, "checks.json");
  const checks = readJson(checksPath, ChecksFileSchema);
  readJsonl(join(dataDir, "changes.jsonl"), ChangeEventSchema);
  const runsPath = join(dataDir, "runs.jsonl");
  const runs = readJsonl(runsPath, RunRecordSchema);
  const evidencePath = join(dataDir, "evidence", "evidence.jsonl");
  const evidence = readJsonl(evidencePath, EvidenceSchema);
  readJson(join(dataDir, "manual", "national-ids.json"), NationalIdsFileSchema);

  const rawDir = join(dataDir, "raw");
  if (existsSync(rawDir)) {
    for (const day of readdirSync(rawDir)) {
      const manifest = join(rawDir, day, "manifest.json");
      if (existsSync(manifest)) readJson(manifest, ManifestSchema);
    }
  }

  if (issuers) {
    const leis = new Set(issuers.map((i) => i.lei));
    if (meta && meta.issuerCount !== issuers.length) {
      errors.push({
        file: rel(join(current, "meta.json")),
        message: `issuerCount is ${meta.issuerCount} but issuers.json has ${issuers.length} issuers`,
      });
    }
    for (const { value, line } of evidence) {
      if (!leis.has(value.issuerLei)) {
        errors.push({
          file: rel(evidencePath),
          line,
          message: `Unknown issuerLei ${value.issuerLei}`,
        });
      }
    }
    for (const { lei } of checks?.issuers ?? []) {
      if (!leis.has(lei))
        errors.push({ file: rel(checksPath), message: `Unknown issuerLei ${lei}` });
    }
  }

  const seen = new Map<string, number>();
  for (const { value, line } of evidence) {
    const first = seen.get(value.id);
    if (first === undefined) seen.set(value.id, line);
    else {
      errors.push({
        file: rel(evidencePath),
        line,
        message: `Duplicate evidence id ${value.id} (first on line ${first})`,
      });
    }
  }

  for (let i = 1; i < runs.length; i++) {
    const prev = runs[i - 1]!;
    const run = runs[i]!;
    if (Date.parse(run.value.at) < Date.parse(prev.value.at)) {
      errors.push({
        file: rel(runsPath),
        line: run.line,
        message: `at ${run.value.at} is earlier than ${prev.value.at} on line ${prev.line}`,
      });
    }
  }

  return errors;
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const root = resolve(process.argv[2] ?? ".");
  const errors = validateData(root);
  for (const e of errors) {
    console.error(`${e.file}${e.line === undefined ? "" : `:${e.line}`}: ${e.message}`);
  }
  if (errors.length > 0) {
    console.error(`Data validation failed: ${errors.length} error(s).`);
    process.exit(1);
  }
  console.log("Data validation passed.");
}
