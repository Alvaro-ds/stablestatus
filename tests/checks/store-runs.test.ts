import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRuns, sourceLastCheckedAt, sourceNeedsAlert } from "../../src/checks/store.js";

const SHA = "c".repeat(64);
const NOT_CHECKED = { status: "not_checked", contentSha256: null, recordsSha256: null };
const OK = { status: "ok", contentSha256: SHA, recordsSha256: SHA };

const ingest = (day: string, gleif: object) => ({
  at: `2026-11-${day}T05:00:00.000Z`,
  runId: null,
  emtwpSha256: SHA,
  artzzSha256: null,
  events: 0,
  critical: 0,
  sources: { gleif },
});

const manual = (day: string) => ({
  kind: "manual_evidence",
  at: `2026-11-${day}T12:00:00.000Z`,
  evidenceIds: [SHA],
  events: 0,
  critical: 0,
  stateFiles: [],
  stateSha256: SHA,
  prevEntrySha256: SHA,
  entrySha256: SHA,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stablestatus-store-runs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(lines: object[]): string {
  const path = join(dir, "runs.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l) + "\n").join(""));
  return path;
}

describe("readRuns with manual evidence records", () => {
  it("returns only ingest runs", () => {
    const runs = readRuns(write([ingest("11", OK), manual("11"), ingest("12", OK)]));
    expect(runs.map((r) => r.at)).toEqual(["2026-11-11T05:00:00.000Z", "2026-11-12T05:00:00.000Z"]);
  });

  it("does not change sourceLastCheckedAt", () => {
    const runs = readRuns(write([ingest("11", OK), ingest("12", NOT_CHECKED), manual("13")]));
    expect(sourceLastCheckedAt(runs, "gleif")).toBe("2026-11-11T05:00:00.000Z");
  });

  it("does not break or fake a not_checked streak in sourceNeedsAlert", () => {
    const failing = [
      ingest("11", NOT_CHECKED),
      ingest("12", NOT_CHECKED),
      ingest("13", NOT_CHECKED),
    ];
    expect(sourceNeedsAlert(readRuns(write([...failing, manual("13")])), "gleif")).toBe(true);
    const withManual = [failing[0]!, manual("12"), failing[1]!, manual("13")];
    expect(sourceNeedsAlert(readRuns(write(withManual)), "gleif")).toBe(false);
  });
});
