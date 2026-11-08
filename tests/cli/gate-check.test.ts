import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { checkGate } from "../../src/cli/gate-check.js";
import { computeSha256 } from "../../src/esma/store.js";
import { ESMA_URLS } from "../../src/esma/constants.js";

const BASE_CSV = join(import.meta.dirname, "..", "fixtures", "esma", "EMTWP_2026-10-30.csv");
const BASE_SHA = computeSha256(readFileSync(BASE_CSV));
const TODAY = "2026-11-20";

let dataDir: string;

beforeEach(() => {
  dataDir = join(mkdtempSync(join(tmpdir(), "stablestatus-gate-")), "data");
});

afterEach(() => {
  rmSync(join(dataDir, ".."), { recursive: true, force: true });
});

function addDay(date: string, retrieval: "http" | "file" = "http", storeCsv = false): void {
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
        retrieval,
      },
    ],
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
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

describe("checkGate", () => {
  it("passes with 7 consecutive http days and matching counts", () => {
    days(14, 20).forEach((d, i) => addDay(d, "http", i === 0));
    writeMeta(25, 48);
    const report = checkGate(dataDir, TODAY);
    expect(report.streak).toBe(7);
    expect(report.missing).toEqual([]);
    expect(report.counts).toMatchObject({
      match: true,
      expected: { issuers: 25, whitepapers: 48 },
    });
    expect(report.ok).toBe(true);
  });

  it("breaks the streak on a missing day and lists it", () => {
    days(10, 20)
      .filter((d) => d !== "2026-11-16")
      .forEach((d, i) => addDay(d, "http", i === 0));
    writeMeta(25, 48);
    const report = checkGate(dataDir, TODAY);
    expect(report.streak).toBe(4);
    expect(report.missing).toEqual(["2026-11-16"]);
    expect(report.ok).toBe(false);
  });

  it("does not count a day retrieved from file", () => {
    days(13, 20).forEach((d, i) => addDay(d, d === "2026-11-15" ? "file" : "http", i === 0));
    writeMeta(25, 48);
    expect(checkGate(dataDir, TODAY).streak).toBe(5);
  });

  it("starts counting from yesterday when today has not run yet", () => {
    days(12, 19).forEach((d, i) => addDay(d, "http", i === 0));
    writeMeta(25, 48);
    const report = checkGate(dataDir, TODAY);
    expect(report.todayPending).toBe(true);
    expect(report.streak).toBe(8);
    expect(report.missing).toEqual([]);
  });

  it("fails when meta.json counts do not match the latest EMTWP", () => {
    days(14, 20).forEach((d, i) => addDay(d, "http", i === 0));
    writeMeta(24, 48);
    const report = checkGate(dataDir, TODAY);
    expect(report.streak).toBe(7);
    expect(report.counts).toMatchObject({ match: false, actual: { issuers: 24, whitepapers: 48 } });
    expect(report.ok).toBe(false);
  });

  it("fails when no stored EMTWP.csv matches the latest manifest hash", () => {
    days(14, 20).forEach((d) => addDay(d));
    writeMeta(25, 48);
    const report = checkGate(dataDir, TODAY);
    expect(report.counts).toMatchObject({ match: false, expected: null });
    expect(report.ok).toBe(false);
  });
});
