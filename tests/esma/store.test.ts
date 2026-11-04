import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeSha256,
  shouldStoreCsv,
  writeManifest,
  storeCsv,
} from "../../src/esma/store.js";
import type { SourceSnapshot } from "../../src/model/index.js";

const CONTENT_A = Buffer.from("col1,col2\r\nval1,val2\r\n", "utf8");
const CONTENT_B = Buffer.from("col1,col2\r\nval1,val3\r\n", "utf8");

describe("computeSha256", () => {
  it("returns lowercase hex sha256 of buffer", () => {
    const hash = computeSha256(CONTENT_A);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns different hashes for different content", () => {
    expect(computeSha256(CONTENT_A)).not.toBe(computeSha256(CONTENT_B));
  });

  it("returns identical hash for identical content", () => {
    const copy = Buffer.from(CONTENT_A);
    expect(computeSha256(CONTENT_A)).toBe(computeSha256(copy));
  });
});

describe("shouldStoreCsv", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stablestatus-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns true when no previous file exists", () => {
    const result = shouldStoreCsv(
      computeSha256(CONTENT_A),
      dir,
      "EMTWP.csv",
    );
    expect(result).toBe(true);
  });

  it("returns false when file with same hash already exists", () => {
    storeCsv(CONTENT_A, dir, "2026-11-01", "EMTWP.csv");
    const result = shouldStoreCsv(
      computeSha256(CONTENT_A),
      dir,
      "EMTWP.csv",
    );
    expect(result).toBe(false);
  });

  it("returns true when content has changed", () => {
    storeCsv(CONTENT_A, dir, "2026-11-01", "EMTWP.csv");
    const result = shouldStoreCsv(
      computeSha256(CONTENT_B),
      dir,
      "EMTWP.csv",
    );
    expect(result).toBe(true);
  });
});

describe("storeCsv", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stablestatus-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes CSV to date-namespaced directory", () => {
    storeCsv(CONTENT_A, dir, "2026-11-04", "EMTWP.csv");
    const written = readFileSync(join(dir, "2026-11-04", "EMTWP.csv"));
    expect(written).toEqual(CONTENT_A);
  });

  it("preserves exact bytes (BOM and CRLF)", () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), CONTENT_A]);
    storeCsv(withBom, dir, "2026-11-04", "EMTWP.csv");
    const written = readFileSync(join(dir, "2026-11-04", "EMTWP.csv"));
    expect(written.slice(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it("does not overwrite if hash unchanged (idempotent)", () => {
    storeCsv(CONTENT_A, dir, "2026-11-01", "EMTWP.csv");
    const pathA = join(dir, "2026-11-01", "EMTWP.csv");
    const mtimeBefore = readFileSync(pathA);

    storeCsv(CONTENT_A, dir, "2026-11-04", "EMTWP.csv");
    const pathB = join(dir, "2026-11-04", "EMTWP.csv");
    expect(existsSync(pathB)).toBe(false);
    expect(readFileSync(pathA)).toEqual(mtimeBefore);
  });
});

describe("writeManifest", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stablestatus-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes manifest.json to date directory", () => {
    const snapshot: SourceSnapshot = {
      url: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
      fetchedAt: "2026-11-04T10:00:00Z",
      sha256: computeSha256(CONTENT_A),
      sizeBytes: CONTENT_A.length,
      rowCount: 1,
    };

    writeManifest(dir, "2026-11-04", [snapshot]);

    const manifestPath = join(dir, "2026-11-04", "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.date).toBe("2026-11-04");
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0].sha256).toBe(computeSha256(CONTENT_A));
  });

  it("overwrites manifest on same date (daily refresh)", () => {
    const snapshot: SourceSnapshot = {
      url: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
      fetchedAt: "2026-11-04T10:00:00Z",
      sha256: computeSha256(CONTENT_A),
      sizeBytes: CONTENT_A.length,
      rowCount: 1,
    };

    writeManifest(dir, "2026-11-04", [snapshot]);
    writeManifest(dir, "2026-11-04", [snapshot]);

    const manifestPath = join(dir, "2026-11-04", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.files).toHaveLength(1);
  });
});
