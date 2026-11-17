import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { integrityVerify } from "../../src/cli/integrity-verify.js";
import { chainEntry } from "../../src/integrity/chain.js";
import { readStateFiles } from "../../src/integrity/files.js";

let root: string;
const data = (file: string) => join(root, "data", file);

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "stablestatus-integrity-"));
  mkdirSync(data("current"), { recursive: true });
  writeFileSync(data("current/issuers.json"), "[]");
  writeFileSync(data("changes.jsonl"), "");
  const run = { at: "2026-11-17T05:00:00.000Z", runId: null, events: 0, critical: 0 };
  const entry = await chainEntry(new Uint8Array(), run, readStateFiles(data("")));
  writeFileSync(data("runs.jsonl"), JSON.stringify(entry) + "\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("integrityVerify", () => {
  it("passes on an untouched data directory", async () => {
    expect(await integrityVerify(root)).toEqual({ ok: true });
  });

  it("fails when evidence.jsonl appears after the last run", async () => {
    mkdirSync(data("evidence"));
    writeFileSync(data("evidence/evidence.jsonl"), "{}\n");
    const result = await integrityVerify(root);
    expect(result).toMatchObject({ ok: false, line: 1 });
    expect(result.ok ? "" : result.reason).toContain("data/evidence/evidence.jsonl");
  });

  it("fails when changes.jsonl grows after the last run", async () => {
    appendFileSync(data("changes.jsonl"), "{}\n");
    expect(await integrityVerify(root)).toMatchObject({ ok: false, line: 1 });
  });
});
