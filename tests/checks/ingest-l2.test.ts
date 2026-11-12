import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runIngest } from "../../src/cli/ingest.js";
import type { DnbFetcher, EbaFetcher } from "../../src/checks/run-checks.js";
import { computeSha256 } from "../../src/esma/store.js";
import { ChecksFileSchema, EvidenceSchema, RunRecordSchema } from "../../src/model/index.js";
import { DNB_CSV_URL, parseDnbCsv } from "../../src/sources/dnb.js";
import { parseEbaRegister, readEbaZip } from "../../src/sources/eba.js";
import type { EbaEntity } from "../../src/sources/eba.js";
import {
  buildGleifUrl,
  computeRecordsSha256,
  parseGleifResponse,
  type GleifFetchResult,
} from "../../src/sources/gleif.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const ESMA_CSV = join(FIXTURES, "esma", "EMTWP_2026-11-11.csv");
const GLEIF_BUF = readFileSync(join(FIXTURES, "gleif", "2026-11-11.json"));
const EBA_ZIP = readFileSync(join(FIXTURES, "eba", "download-PSDMD-202611120800.zip"));
const DNB_CSV = readFileSync(join(FIXTURES, "dnb", "Internetregister-WFTEG_2026-11-12.csv"));
const EBA_URL =
  "https://euclid.eba.europa.eu/register/downloads/PSDMD/20261112/download-PSDMD-202611120800.zip";

const APLAUZ = "72450039GAIN4MNI4V12";
const MONERIUM = "2549003QDNZWASSSCY31";
const PAYMENT_CORP = "315700IJDQF91J9C8B68";
const BRIDGE = "254900MVWQXMF77YZP65";
const CACEIS = "96950023SCR9X9F3L662";
const PAXOS = "743700KYSSTKZYGEUF50";

let tmpDir: string;
let dataDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "stablestatus-l2-ingest-"));
  dataDir = join(tmpDir, "data");
});

afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

const gleif = async (leis: string[]): Promise<GleifFetchResult> => {
  const records = parseGleifResponse(GLEIF_BUF);
  return {
    url: buildGleifUrl(leis),
    retrievedAt: "2026-11-11T16:00:00.000Z",
    body: GLEIF_BUF,
    records,
    contentSha256: computeSha256(GLEIF_BUF),
    recordsSha256: computeRecordsSha256(records),
  };
};

function ebaFrom(mutate: (entities: EbaEntity[]) => EbaEntity[] = (e) => e): EbaFetcher {
  return async () => ({
    url: EBA_URL,
    retrievedAt: "2026-11-12T09:00:00.000Z",
    contentSha256: computeSha256(EBA_ZIP),
    entities: mutate(parseEbaRegister(readEbaZip(EBA_ZIP))),
  });
}

const dnb: DnbFetcher = async () => ({
  url: DNB_CSV_URL,
  retrievedAt: "2026-11-12T07:00:00.000Z",
  contentSha256: computeSha256(DNB_CSV),
  rows: parseDnbCsv(DNB_CSV),
});

const failing = async (): Promise<never> => {
  throw new Error("network down");
};

function run(day: string, eba: EbaFetcher = ebaFrom(), dnbFetcher: DnbFetcher = dnb) {
  return runIngest({
    fromFile: ESMA_CSV,
    fetchedAt: "2026-11-11T05:00:00Z",
    date: day,
    dataDir,
    changelogPath: join(tmpDir, "CHANGELOG-data.md"),
    now: new Date(`${day}T12:00:00Z`),
    log: () => {},
    gleif,
    eba,
    dnb: dnbFetcher,
  });
}

function lines(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as unknown);
}

const evidence = () =>
  lines(join(dataDir, "evidence", "evidence.jsonl")).map((l) => EvidenceSchema.parse(l));
const runs = () => lines(join(dataDir, "runs.jsonl")).map((l) => RunRecordSchema.parse(l));
const lastRun = () => JSON.parse(readFileSync(join(dataDir, "last-run.json"), "utf8"));
const checksOf = (lei: string) =>
  ChecksFileSchema.parse(
    JSON.parse(readFileSync(join(dataDir, "current", "checks.json"), "utf8"))
  ).issuers.find((c) => c.lei === lei)!;

describe("runIngest with L2 — first run", () => {
  it("records EBA and DNB evidence, levels, reasons, extracts and run hashes", async () => {
    await run("2026-11-12");

    const l2 = evidence().filter((e) => e.check === "L2");
    expect(l2.filter((e) => e.sourceType === "nca_register")).toHaveLength(4);
    expect(l2.filter((e) => e.sourceType === "eba_register")).toHaveLength(17);

    expect(checksOf(APLAUZ)).toMatchObject({
      levelReached: "L2",
      l2: { result: "confirmed", reason: null },
      lastCheckedAt: { eba: "2026-11-12T12:00:00.000Z", dnb: "2026-11-12T12:00:00.000Z" },
    });
    expect(checksOf(MONERIUM).levelReached).toBe("L2");
    expect(checksOf(PAXOS).levelReached).toBe("L2");
    expect(checksOf(PAYMENT_CORP)).toMatchObject({
      levelReached: "L1",
      l2: { result: "mismatch" },
    });
    expect(checksOf(BRIDGE)).toMatchObject({
      l2: { result: "not_checked", reason: "national_id_missing" },
    });
    expect(checksOf(CACEIS)).toMatchObject({
      l2: { result: "not_checked", reason: "no_automated_official_source" },
      lastCheckedAt: { eba: null, dnb: null },
    });

    const extract = JSON.parse(
      readFileSync(join(dataDir, "raw", "2026-11-12", "eba-pir-extract.json"), "utf8")
    );
    expect(extract.records).toHaveLength(17);
    expect(existsSync(join(dataDir, "raw", "2026-11-12", "dnb-wfteg-extract.json"))).toBe(true);

    const [line] = runs();
    expect(line?.sources?.eba).toMatchObject({
      status: "ok",
      contentSha256: computeSha256(EBA_ZIP),
    });
    expect(line?.sources?.dnb).toMatchObject({
      status: "ok",
      contentSha256: computeSha256(DNB_CSV),
    });
    expect(line?.sources?.eba?.recordsSha256).toBe(extract.recordsSha256);
    expect(lastRun().sourceAlerts).toEqual([]);
  });
});

describe("runIngest with L2 — later runs", () => {
  it("adds no evidence and no extracts when nothing observed changed", async () => {
    await run("2026-11-12");
    const before = evidence().length;
    const result = await run("2026-11-13");
    expect(evidence()).toHaveLength(before);
    expect(result.events).toEqual([]);
    expect(existsSync(join(dataDir, "raw", "2026-11-13", "eba-pir-extract.json"))).toBe(false);
    expect(runs()[1]?.sources?.eba?.status).toBe("ok");
  });

  it("a withdrawal in the EBA raises a critical signal; DNB still confirms L2", async () => {
    await run("2026-11-12");
    const withdrawn = ebaFrom((entities) =>
      entities.map((e) =>
        e.record.entityCode === "NL_DNB!R180692"
          ? { ...e, record: { ...e.record, authDates: [...e.record.authDates, "2026-11-12"] } }
          : e
      )
    );
    const result = await run("2026-11-13", withdrawn);

    const [event] = result.events.filter((e) => e.kind === "signal_added");
    expect(event).toMatchObject({
      source: "eba",
      key: APLAUZ,
      field: "nca_licence_withdrawn",
      severity: "critical",
      message: `EBA Register under PSD2: Authorised/Withdrawn dates 2023-02-15, 2026-11-12. Source: ${EBA_URL} (checked 2026-11-12).`,
    });
    expect(checksOf(APLAUZ)).toMatchObject({ levelReached: "L2", l2: { result: "confirmed" } });
    expect(readFileSync(join(tmpDir, "CHANGELOG-data.md"), "utf8")).toContain(
      "EBA Register under PSD2: Authorised/Withdrawn dates"
    );
  });

  it("an entity that disappears from the EBA after a match is not_found", async () => {
    await run("2026-11-12");
    await run(
      "2026-11-13",
      ebaFrom((es) => es.filter((e) => e.record.entityCode !== "FI_FIN_FSA!32368862"))
    );
    const last = evidence()
      .filter((e) => e.issuerLei === PAXOS && e.check === "L2")
      .pop();
    expect(last).toMatchObject({ result: "not_found", observed: {} });
    expect(checksOf(PAXOS).levelReached).toBe("L1");
  });

  it("uses data/manual/national-ids.json for issuers without a matching ID", async () => {
    mkdirSync(join(dataDir, "manual"), { recursive: true });
    writeFileSync(
      join(dataDir, "manual", "national-ids.json"),
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            lei: BRIDGE,
            caOwnerId: "LU_CSSF",
            nationalId: "W00000024",
            checkedAt: "2026-11-12",
            sourceUrl: "https://www.cssf.lu/en/search-entities/",
          },
        ],
      })
    );
    await run("2026-11-12");
    expect(checksOf(BRIDGE)).toMatchObject({ levelReached: "L2", l2: { result: "confirmed" } });
  });
});

describe("runIngest with L2 — source failures", () => {
  it("does not fail the ingest and keeps earlier L2 evidence", async () => {
    await run("2026-11-12");
    await run("2026-11-13", failing, failing);
    expect(runs()[1]?.sources).toMatchObject({
      eba: { status: "not_checked" },
      dnb: { status: "not_checked" },
    });
    expect(checksOf(APLAUZ)).toMatchObject({
      levelReached: "L2",
      lastCheckedAt: { eba: "2026-11-12T12:00:00.000Z" },
    });
  });

  it("issuers never checked are not_checked with source_unavailable", async () => {
    await run("2026-11-12", failing, failing);
    expect(checksOf(APLAUZ)).toMatchObject({
      levelReached: "L1",
      l2: { result: "not_checked", reason: "source_unavailable" },
    });
  });

  it("lists a source in sourceAlerts after 3 consecutive days not checked", async () => {
    await run("2026-11-12", failing);
    await run("2026-11-13", failing);
    expect(lastRun().sourceAlerts).toEqual([]);
    await run("2026-11-14", failing);
    expect(lastRun().sourceAlerts).toEqual(["eba"]);
  });
});
