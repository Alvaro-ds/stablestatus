import { describe, it, expect } from "vitest";

import {
  ChangeEventSchema,
  ChecksFileSchema,
  DiscrepancySchema,
  EvidenceSchema,
  RunRecordSchema,
  SignalSchema,
} from "../../src/model/index.js";

const SHA = "a".repeat(64);
const URL = "https://api.gleif.org/api/v1/lei-records?filter[lei]=8945001XWFMRUTCAK575";

const EVIDENCE = {
  id: SHA,
  issuerLei: "8945001XWFMRUTCAK575",
  check: "L1",
  sourceType: "gleif",
  sourceUrl: URL,
  viewUrl: "https://search.gleif.org/#/record/8945001XWFMRUTCAK575",
  retrievedAt: "2026-11-11T10:00:00.000Z",
  method: "api",
  contentSha256: SHA,
  matchedBy: "lei",
  nationalId: "12345678",
  observed: { "registration.status": "LAPSED", "entity.legalName": null },
  result: "inactive",
};

const SIGNAL = {
  kind: "lei_lapsed",
  severity: "warning",
  field: "registration.status",
  value: "LAPSED",
  sourceType: "gleif",
  sourceUrl: URL,
  evidenceId: SHA,
};

const DISCREPANCY = {
  kind: "country_mismatch",
  field: "country",
  esmaValue: "DK",
  otherValue: "SE",
  otherSourceType: "gleif",
  otherSourceUrl: URL,
  evidenceId: SHA,
};

describe("EvidenceSchema", () => {
  it("parses a valid record", () => {
    expect(EvidenceSchema.safeParse(EVIDENCE).success).toBe(true);
  });

  it("accepts not_checked as a result", () => {
    expect(EvidenceSchema.safeParse({ ...EVIDENCE, result: "not_checked" }).success).toBe(true);
  });

  it("rejects a third-party source type", () => {
    expect(EvidenceSchema.safeParse({ ...EVIDENCE, sourceType: "news" }).success).toBe(false);
  });

  it("rejects a malformed LEI", () => {
    expect(EvidenceSchema.safeParse({ ...EVIDENCE, issuerLei: "monerium" }).success).toBe(false);
  });
});

describe("SignalSchema", () => {
  it("parses lei_lapsed as warning", () => {
    expect(SignalSchema.safeParse(SIGNAL).success).toBe(true);
  });

  it("rejects a severity that differs from the fixed one", () => {
    expect(SignalSchema.safeParse({ ...SIGNAL, severity: "critical" }).success).toBe(false);
    expect(
      SignalSchema.safeParse({ ...SIGNAL, kind: "lei_retired", severity: "warning" }).success
    ).toBe(false);
  });

  it("accepts lei_retired as critical", () => {
    expect(
      SignalSchema.safeParse({ ...SIGNAL, kind: "lei_retired", severity: "critical" }).success
    ).toBe(true);
  });
});

describe("DiscrepancySchema", () => {
  it("parses country_mismatch", () => {
    expect(DiscrepancySchema.safeParse(DISCREPANCY).success).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(DiscrepancySchema.safeParse({ ...DISCREPANCY, kind: "typo" }).success).toBe(false);
  });
});

describe("ChecksFileSchema", () => {
  it("parses a file with one issuer", () => {
    const file = {
      schemaVersion: 1,
      generatedAt: "2026-11-11T10:00:00.000Z",
      issuers: [
        {
          lei: "8945001XWFMRUTCAK575",
          levelReached: null,
          discrepancies: [DISCREPANCY],
          signals: [SIGNAL],
          lastCheckedAt: { gleif: "2026-11-11T10:00:00.000Z" },
        },
      ],
    };
    expect(ChecksFileSchema.safeParse(file).success).toBe(true);
  });
});

describe("ChangeEventSchema and RunRecordSchema extensions", () => {
  it("accepts signal_added with source and message", () => {
    const event = {
      at: "2026-11-11T10:00:00.000Z",
      entity: "issuer",
      key: "8945001XWFMRUTCAK575",
      kind: "signal_added",
      severity: "warning",
      source: "gleif",
      message: "GLEIF: LEI registration status LAPSED.",
      snapshotSha256: SHA,
    };
    expect(ChangeEventSchema.safeParse(event).success).toBe(true);
  });

  it("still accepts run lines without sources", () => {
    const run = {
      at: "2026-11-11T10:00:00.000Z",
      runId: null,
      emtwpSha256: SHA,
      artzzSha256: null,
      events: 0,
      critical: 0,
    };
    expect(RunRecordSchema.safeParse(run).success).toBe(true);
    expect(
      RunRecordSchema.safeParse({
        ...run,
        sources: { gleif: { status: "not_checked", contentSha256: null, recordsSha256: null } },
      }).success
    ).toBe(true);
  });
});
