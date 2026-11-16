import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateData } from "../../src/cli/validate-data.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "data-valid");

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "stablestatus-validate-"));
  cpSync(FIXTURE, root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const path = (file: string) => join(root, file);
const readJson = (file: string) => JSON.parse(readFileSync(path(file), "utf8"));
const writeJson = (file: string, value: unknown) =>
  writeFileSync(path(file), JSON.stringify(value, null, 2) + "\n");
const lines = (file: string) => readFileSync(path(file), "utf8").trimEnd().split("\n");

describe("validateData", () => {
  it("accepts a valid data directory", () => {
    expect(validateData(root)).toEqual([]);
  });

  it("reports Git conflict markers with file and line", () => {
    const file = "data/current/checks.json";
    const text = readFileSync(path(file), "utf8").split("\n");
    text.splice(3, 0, "<<<<<<< HEAD", "=======", ">>>>>>> feat/branch");
    writeFileSync(path(file), text.join("\n"));

    expect(validateData(root)).toEqual([
      { file, line: 4, message: "Git conflict marker" },
      { file, line: 5, message: "Git conflict marker" },
      { file, line: 6, message: "Git conflict marker" },
    ]);
  });

  it("reports conflict markers in CHANGELOG-data.md", () => {
    appendFileSync(path("CHANGELOG-data.md"), ">>>>>>> main\n");

    expect(validateData(root)).toEqual([
      { file: "CHANGELOG-data.md", line: 2, message: "Git conflict marker" },
    ]);
  });

  it("reports schema errors in JSON files", () => {
    const meta = readJson("data/current/meta.json");
    writeJson("data/current/meta.json", { ...meta, schemaVersion: 2 });

    const errors = validateData(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: "data/current/meta.json" });
    expect(errors[0]!.message).toContain("schemaVersion");
  });

  it("reports invalid JSONL lines with their line number", () => {
    appendFileSync(path("data/changes.jsonl"), '{"at":"not a date"}\n');

    const errors = validateData(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: "data/changes.jsonl", line: 2 });
  });

  it("reports invalid raw manifests", () => {
    writeJson("data/raw/2026-11-16/manifest.json", { date: "2026-11-16" });

    const errors = validateData(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: "data/raw/2026-11-16/manifest.json" });
  });

  it("reports duplicate evidence ids", () => {
    const [first] = lines("data/evidence/evidence.jsonl");
    appendFileSync(path("data/evidence/evidence.jsonl"), first + "\n");

    const errors = validateData(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: "data/evidence/evidence.jsonl", line: 2 });
    expect(errors[0]!.message).toContain("Duplicate evidence id");
  });

  it("reports evidence and checks for issuers missing from issuers.json", () => {
    const unknown = "529900T8BM49AURSDO55";
    const evidence = JSON.parse(lines("data/evidence/evidence.jsonl")[0]!);
    writeFileSync(
      path("data/evidence/evidence.jsonl"),
      JSON.stringify({ ...evidence, issuerLei: unknown }) + "\n"
    );
    const checks = readJson("data/current/checks.json");
    checks.issuers[0].lei = unknown;
    writeJson("data/current/checks.json", checks);

    expect(validateData(root)).toEqual([
      {
        file: "data/evidence/evidence.jsonl",
        line: 1,
        message: `Unknown issuerLei ${unknown}`,
      },
      { file: "data/current/checks.json", message: `Unknown issuerLei ${unknown}` },
    ]);
  });

  it("reports an issuerCount that does not match issuers.json", () => {
    const meta = readJson("data/current/meta.json");
    writeJson("data/current/meta.json", { ...meta, issuerCount: 2 });

    expect(validateData(root)).toEqual([
      {
        file: "data/current/meta.json",
        message: "issuerCount is 2 but issuers.json has 1 issuers",
      },
    ]);
  });

  it("reports runs whose dates go backwards", () => {
    const runs = lines("data/runs.jsonl");
    writeFileSync(path("data/runs.jsonl"), [runs[0], runs[2], runs[1]].join("\n") + "\n");

    const errors = validateData(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: "data/runs.jsonl", line: 3 });
  });

  it("reports missing required files", () => {
    rmSync(path("data/current/whitepapers.json"));

    expect(validateData(root)).toEqual([
      { file: "data/current/whitepapers.json", message: "File is missing" },
    ]);
  });
});
