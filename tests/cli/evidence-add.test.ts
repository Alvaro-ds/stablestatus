import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OFFICIAL_DOMAINS, buildManualEvidence, officialDomain } from "../../src/checks/manual.js";
import { addManualEvidence, parseEvidenceArgs } from "../../src/cli/evidence-add.js";
import { runIngest } from "../../src/cli/ingest.js";
import { computeSha256 } from "../../src/esma/store.js";
import { ChecksFileSchema, EvidenceSchema } from "../../src/model/index.js";
import {
  buildGleifUrl,
  computeRecordsSha256,
  parseGleifResponse,
} from "../../src/sources/gleif.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const GLEIF_BUF = readFileSync(join(FIXTURES, "gleif", "2026-11-11.json"));
const STABLR = "984500AA0OCA9CE0D796";
const NOW = new Date("2026-11-12T18:00:00Z");

const VALID = {
  issuerLei: STABLR,
  check: "L3",
  sourceType: "nca_register",
  sourceUrl: "https://financialservices.mfsa.mt/financial-services-register/",
  retrievedAt: "2026-11-12T10:30:00Z",
  contentSha256: "AB".repeat(32),
  matchedBy: "national_id",
  nationalId: "C 104007",
  observed: { "Licence Type": "Electronic Money Institution", Status: "Licensed" },
  result: "confirmed",
};

describe("buildManualEvidence", () => {
  it("builds a manual evidence record and lowercases the PowerShell hash", () => {
    const ev = EvidenceSchema.parse(buildManualEvidence(VALID, NOW));
    expect(ev).toMatchObject({ method: "manual", check: "L3", contentSha256: "ab".repeat(32) });
  });

  it.each([
    ["a non-official domain", { sourceUrl: "https://example.com/mfsa.mt" }],
    ["a look-alike domain", { sourceUrl: "https://mfsa.mt.example.com/" }],
    ["a domain of another source type", { sourceType: "eba_register" }],
    ["plain http", { sourceUrl: "http://www.cssf.lu/en/" }],
    ["credentials in the URL", { sourceUrl: "https://user:pw@www.cssf.lu/en/" }],
    ["a non-official source type", { sourceType: "issuer_official" }],
    ["national_id without nationalId", { nationalId: undefined }],
    ["empty observed", { observed: {} }],
    ["not_checked as result", { result: "not_checked" }],
    ["an unknown field", { comment: "x" }],
    ["a malformed hash", { contentSha256: "abc" }],
  ])("rejects %s", (_name, patch) => {
    expect(() => buildManualEvidence({ ...VALID, ...patch }, NOW)).toThrow();
  });

  it("rejects a retrievedAt in the future", () => {
    expect(() =>
      buildManualEvidence({ ...VALID, retrievedAt: "2026-11-13T00:00:00Z" }, NOW)
    ).toThrow(/future/);
  });

  it("accepts subdomains of official domains", () => {
    expect(officialDomain("https://euclid.eba.europa.eu/register/")).toBe("eba.europa.eu");
    expect(officialDomain("https://www.cssf.lu/en/")).toBe("cssf.lu");
  });
});

describe("OFFICIAL_DOMAINS", () => {
  it("matches the list in docs/sources.md", () => {
    const docs = readFileSync(join(import.meta.dirname, "..", "..", "docs", "sources.md"), "utf8");
    const section =
      docs.split("## Official domains for manual evidence")[1]?.split("\n## ")[0] ?? "";
    const listed = [...section.matchAll(/^\| `([a-z0-9.-]+)` +\| `([a-z_]+)`/gm)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(Object.fromEntries(listed)).toEqual(OFFICIAL_DOMAINS);
  });
});

describe("parseEvidenceArgs", () => {
  it("reads flags, JSON observed and a JSON file (flags win)", () => {
    const dir = mkdtempSync(join(tmpdir(), "evidence-args-"));
    try {
      const file = join(dir, "in.json");
      writeFileSync(file, JSON.stringify({ ...VALID, result: "inactive" }));
      const args = parseEvidenceArgs([
        "--",
        "--file",
        file,
        "--result",
        "confirmed",
        "--observed",
        '{"a":"b"}',
      ]);
      expect(args).toMatchObject({ issuerLei: STABLR, result: "confirmed", observed: { a: "b" } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unknown options", () => {
    expect(() => parseEvidenceArgs(["--method", "api"])).toThrow(/Unknown option/);
  });
});

describe("addManualEvidence", () => {
  let tmpDir: string;
  let dataDir: string;
  const changelogPath = () => join(tmpDir, "CHANGELOG-data.md");

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "stablestatus-evidence-add-"));
    dataDir = join(tmpDir, "data");
    await runIngest({
      fromFile: join(FIXTURES, "esma", "EMTWP_2026-11-11.csv"),
      fetchedAt: "2026-11-11T05:00:00Z",
      date: "2026-11-12",
      dataDir,
      changelogPath: changelogPath(),
      now: new Date("2026-11-12T12:00:00Z"),
      log: () => {},
      gleif: async (leis) => {
        const records = parseGleifResponse(GLEIF_BUF);
        return {
          url: buildGleifUrl(leis),
          retrievedAt: "2026-11-12T12:00:00.000Z",
          body: GLEIF_BUF,
          records,
          contentSha256: computeSha256(GLEIF_BUF),
          recordsSha256: computeRecordsSha256(records),
        };
      },
    });
  });
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  const checksOf = (lei: string) =>
    ChecksFileSchema.parse(
      JSON.parse(readFileSync(join(dataDir, "current", "checks.json"), "utf8"))
    ).issuers.find((c) => c.lei === lei)!;

  it("appends the evidence and rebuilds checks.json (L3)", async () => {
    expect(checksOf(STABLR).levelReached).toBe("L1");
    await addManualEvidence({ dataDir, changelogPath: changelogPath(), input: VALID, now: NOW });
    const lines = readFileSync(join(dataDir, "evidence", "evidence.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ method: "manual", issuerLei: STABLR });
    expect(checksOf(STABLR).levelReached).toBe("L3");
  });

  it("a manual inactive result raises a signal and a change event", async () => {
    const { events } = await addManualEvidence({
      dataDir,
      changelogPath: changelogPath(),
      input: { ...VALID, check: "L2", result: "inactive", observed: { Status: "Withdrawn" } },
      now: NOW,
    });
    expect(events).toMatchObject([
      {
        kind: "signal_added",
        source: "manual",
        field: "nca_licence_inactive",
        severity: "critical",
      },
    ]);
    expect(readFileSync(changelogPath(), "utf8")).toContain(
      "Official register (manual check): Status Withdrawn."
    );
  });

  it("rejects an unknown issuer and a duplicate", async () => {
    await expect(
      addManualEvidence({
        dataDir,
        changelogPath: changelogPath(),
        input: { ...VALID, issuerLei: "5299000000000000AA00" },
        now: NOW,
      })
    ).rejects.toThrow(/not an issuer/);
    await addManualEvidence({ dataDir, changelogPath: changelogPath(), input: VALID, now: NOW });
    await expect(
      addManualEvidence({ dataDir, changelogPath: changelogPath(), input: VALID, now: NOW })
    ).rejects.toThrow(/already recorded/);
  });
});
