import { describe, it, expect } from "vitest";

import { ManifestSchema, ProvenanceSchema, SourceSnapshotSchema } from "../../src/model/index.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_PROVENANCE = {
  sourceUrl: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
  fetchedAt: "2026-11-04T10:00:00Z",
  snapshotSha256: "f7fb1c594f0374dc16171ac15d4f5db773bf84b1b495e6b3640bdc2a718a4484",
  rowIndex: 1,
  rowSha256: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
};

const VALID_SNAPSHOT = {
  url: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
  fetchedAt: "2026-11-04T10:00:00Z",
  sha256: "f7fb1c594f0374dc16171ac15d4f5db773bf84b1b495e6b3640bdc2a718a4484",
  sizeBytes: 12345,
  rowCount: 50,
  retrieval: "http" as const,
};

// ---------------------------------------------------------------------------
// ProvenanceSchema
// ---------------------------------------------------------------------------

describe("ProvenanceSchema", () => {
  it("parses valid provenance", () => {
    const result = ProvenanceSchema.safeParse(VALID_PROVENANCE);

    expect(result.success).toBe(true);
  });

  it("rejects missing sourceUrl", () => {
    const result = ProvenanceSchema.safeParse(
      Object.fromEntries(Object.entries(VALID_PROVENANCE).filter(([k]) => k !== "sourceUrl"))
    );

    expect(result.success).toBe(false);
  });

  it("rejects negative rowIndex", () => {
    const result = ProvenanceSchema.safeParse({ ...VALID_PROVENANCE, rowIndex: -1 });

    expect(result.success).toBe(false);
  });

  it("rejects rowIndex zero (rows are 1-based)", () => {
    const result = ProvenanceSchema.safeParse({ ...VALID_PROVENANCE, rowIndex: 0 });

    expect(result.success).toBe(false);
  });

  it("rejects non-integer rowIndex", () => {
    const result = ProvenanceSchema.safeParse({ ...VALID_PROVENANCE, rowIndex: 1.5 });

    expect(result.success).toBe(false);
  });
});

describe("ProvenanceSchema — UTC enforcement", () => {
  it("rejects fetchedAt with timezone offset (non-UTC)", () => {
    const result = ProvenanceSchema.safeParse({
      ...VALID_PROVENANCE,
      fetchedAt: "2026-11-04T10:00:00+02:00",
    });

    expect(result.success).toBe(false);
  });

  it("accepts fetchedAt with Z (UTC)", () => {
    const result = ProvenanceSchema.safeParse({
      ...VALID_PROVENANCE,
      fetchedAt: "2026-11-04T10:00:00Z",
    });

    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SourceSnapshotSchema
// ---------------------------------------------------------------------------

describe("SourceSnapshotSchema", () => {
  it("parses valid snapshot", () => {
    const result = SourceSnapshotSchema.safeParse(VALID_SNAPSHOT);

    expect(result.success).toBe(true);
  });

  it("rejects negative sizeBytes", () => {
    const result = SourceSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, sizeBytes: -1 });

    expect(result.success).toBe(false);
  });

  it("rejects negative rowCount", () => {
    const result = SourceSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, rowCount: -1 });

    expect(result.success).toBe(false);
  });

  it("allows rowCount zero (empty file / header-only)", () => {
    const result = SourceSnapshotSchema.safeParse({ ...VALID_SNAPSHOT, rowCount: 0 });

    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ManifestSchema
// ---------------------------------------------------------------------------

describe("ManifestSchema", () => {
  it("parses valid manifest", () => {
    const result = ManifestSchema.safeParse({
      date: "2026-11-04",
      schemaVersion: 1,
      files: [VALID_SNAPSHOT],
    });

    expect(result.success).toBe(true);
  });

  it("rejects wrong schemaVersion", () => {
    const result = ManifestSchema.safeParse({
      date: "2026-11-04",
      schemaVersion: 2,
      files: [VALID_SNAPSHOT],
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    // ESMA dates are dd/mm/yyyy; the manifest must use ISO YYYY-MM-DD.
    const result = ManifestSchema.safeParse({
      date: "04/11/2026",
      schemaVersion: 1,
      files: [VALID_SNAPSHOT],
    });

    expect(result.success).toBe(false);
  });

  it("allows empty files array", () => {
    const result = ManifestSchema.safeParse({
      date: "2026-11-04",
      schemaVersion: 1,
      files: [],
    });

    expect(result.success).toBe(true);
  });
});
