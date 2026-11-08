import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { checkGate } from "../../src/cli/gate-check.js";
import { computeSha256 } from "../../src/esma/store.js";
import { ESMA_URLS } from "../../src/esma/constants.js";

const BASE_CSV = join(import.meta.dirname, "..", "fixtures", "esma", "EMTWP_2026-10-30.csv");
const BASE_SHA = computeSha256(readFileSync(BASE_CSV));
const TODAY = "2026-11-20";

const SCHEDULED = { runner: "github-actions", trigger: "schedule" } as const;
const DISPATCH = { runner: "github-actions", trigger: "workflow_dispatch" } as const;
const LOCAL = { runner: "local", trigger: "manual" } as const;

type RunKind = Partial<{ runner: string; trigger: string }>;

let dataDir: string;

beforeEach(() => {
  dataDir = join(mkdtempSync(join(tmpdir(), "stablestatus-gate-")), "data");
  mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  rmSync(join(dataDir, ".."), { recursive: true, force: true });
});

function addManifest(date: string, storeCsv = false): void {
  const dir = join(dataDir, "raw", date);
  mkdirSync(dir, { recursive: true });
  if (storeCsv) copyFileSync(BASE_CSV, join(dir, "EMTWP.csv"));
  const manifest = {
    date,
    schemaVersion: 1,
    files: [
      {
        url: ESMA_URLS.EMTWP,
        fetchedAt: `${date}T06:20:00.000Z`,
        sha256: BASE_SHA,
        sizeBytes: 1,
        rowCount: 50,
        retrieval: "http",
      },
    ],
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
}

function addRun(date: string, kind: RunKind, time = "06:20:00.000Z"): void {
  const run = {
    at: `${date}T${time}`,
    ...kind,
    runId: kind.runner === "github-actions" ? "123" : null,
    emtwpSha256: BASE_SHA,
    artzzSha256: null,
    events: 0,
    critical: 0,
  };
  appendFileSync(join(dataDir, "runs.jsonl"), JSON.stringify(run) + "\n");
}

function writeMeta(issuerCount: number, whitepaperCount: number): void {
  mkdirSync(join(dataDir, "current"), { recursive: true });
  const meta = {
    date: TODAY,
    schemaVersion: 1,
    sources: [
      {
        url: ESMA_URLS.EMTWP,
        sha256: BASE_SHA,
        fetchedAt: `${TODAY}T06:20:00.000Z`,
        retrieval: "http",
      },
    ],
    issuerCount,
    whitepaperCount,
  };
  writeFileSync(join(dataDir, "current", "meta.json"), JSON.stringify(meta));
}

function days(from: number, to: number): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d++) out.push(`2026-11-${String(d).padStart(2, "0")}`);
  return out;
}

function scheduledDays(from: number, to: number, except: string[] = []): void {
  days(from, to)
    .filter((d) => !except.includes(d))
    .forEach((d) => addRun(d, SCHEDULED));
}

describe("checkGate — streak from runs.jsonl", () => {
  beforeEach(() => {
    addManifest(TODAY, true);
    writeMeta(25, 48);
  });

  it("passes with 7 consecutive scheduled days and matching counts", () => {
    scheduledDays(14, 20);
    const report = checkGate(dataDir, TODAY);
    expect(report.streak).toBe(7);
    expect(report.missing).toEqual([]);
    expect(report.counts).toMatchObject({
      match: true,
      expected: { issuers: 25, whitepapers: 48 },
    });
    expect(report.ok).toBe(true);
  });

  it("counts a day with a scheduled run followed by a manual one", () => {
    scheduledDays(14, 20);
    addRun("2026-11-17", DISPATCH, "09:00:00.000Z");
    addRun("2026-11-17", LOCAL, "18:00:00.000Z");
    const report = checkGate(dataDir, TODAY);
    expect(report.streak).toBe(7);
    expect(report.otherRuns).toEqual([
      { at: "2026-11-17T09:00:00.000Z", runner: "github-actions", trigger: "workflow_dispatch" },
      { at: "2026-11-17T18:00:00.000Z", runner: "local", trigger: "manual" },
    ]);
  });

  it("breaks the streak on a day with only manual runs", () => {
    scheduledDays(10, 20, ["2026-11-16"]);
    addRun("2026-11-16", DISPATCH);
    addRun("2026-11-16", LOCAL, "18:00:00.000Z");
    const report = checkGate(dataDir, TODAY);
    expect(report.streak).toBe(4);
    expect(report.missing).toEqual(["2026-11-16"]);
    expect(report.ok).toBe(false);
  });

  it("does not count lines without runner or without trigger", () => {
    scheduledDays(10, 20, ["2026-11-15", "2026-11-16"]);
    addRun("2026-11-15", { trigger: "schedule" });
    addRun("2026-11-16", { runner: "github-actions" });
    const report = checkGate(dataDir, TODAY);
    expect(report.streak).toBe(4);
    expect(report.missing).toEqual(["2026-11-15", "2026-11-16"]);
    expect(report.otherRuns).toHaveLength(2);
  });

  it("starts counting from yesterday when today has no scheduled run yet", () => {
    scheduledDays(12, 19);
    addRun(TODAY, LOCAL);
    const report = checkGate(dataDir, TODAY);
    expect(report.todayPending).toBe(true);
    expect(report.streak).toBe(8);
    expect(report.missing).toEqual([]);
  });

  it("reports a zero streak when runs.jsonl does not exist", () => {
    const report = checkGate(dataDir, TODAY);
    expect(report.streak).toBe(0);
    expect(report.otherRuns).toEqual([]);
    expect(report.ok).toBe(false);
  });

  it("throws a clear error on an invalid runs.jsonl line", () => {
    appendFileSync(join(dataDir, "runs.jsonl"), '{"at":"not a date"}\n');
    expect(() => checkGate(dataDir, TODAY)).toThrow(/runs\.jsonl line 1/);
  });
});

describe("checkGate — counts", () => {
  it("fails when meta.json counts do not match the latest EMTWP", () => {
    addManifest(TODAY, true);
    writeMeta(24, 48);
    scheduledDays(14, 20);
    const report = checkGate(dataDir, TODAY);
    expect(report.streak).toBe(7);
    expect(report.counts).toMatchObject({ match: false, actual: { issuers: 24, whitepapers: 48 } });
    expect(report.ok).toBe(false);
  });

  it("fails when no stored EMTWP.csv matches the latest manifest hash", () => {
    addManifest(TODAY);
    writeMeta(25, 48);
    scheduledDays(14, 20);
    const report = checkGate(dataDir, TODAY);
    expect(report.counts).toMatchObject({ match: false, expected: null });
    expect(report.ok).toBe(false);
  });
});
