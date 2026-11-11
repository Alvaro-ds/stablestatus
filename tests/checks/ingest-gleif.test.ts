import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runIngest } from "../../src/cli/ingest.js";
import { computeSha256 } from "../../src/esma/store.js";
import {
  ChecksFileSchema,
  EvidenceSchema,
  RunRecordSchema,
  type ChangeEvent,
} from "../../src/model/index.js";
import {
  buildGleifUrl,
  computeRecordsSha256,
  parseGleifResponse,
  type GleifFetchResult,
} from "../../src/sources/gleif.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const ESMA_CSV = join(FIXTURES, "esma", "EMTWP_2026-10-30.csv");
const GLEIF_BUF = readFileSync(join(FIXTURES, "gleif", "2026-11-11.json"));

const EURODOLLAR = "8945001XWFMRUTCAK575";
const MONERIUM = "2549003QDNZWASSSCY31";
const STABLR = "984500AA0OCA9CE0D796";

let tmpDir: string;
let dataDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "stablestatus-gleif-ingest-"));
  dataDir = join(tmpDir, "data");
});

afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

function gleifFrom(body: Buffer) {
  return async (leis: string[]): Promise<GleifFetchResult> => {
    const records = parseGleifResponse(body);
    return {
      url: buildGleifUrl(leis),
      retrievedAt: "2026-11-11T16:00:00.000Z",
      body,
      records,
      contentSha256: computeSha256(body),
      recordsSha256: computeRecordsSha256(records),
    };
  };
}

interface GleifJson {
  meta: { goldenCopy: { publishDate: string } };
  data: {
    attributes: { lei: string; registration: { status: string; nextRenewalDate: string | null } };
  }[];
}

function patched(mutate: (json: GleifJson) => void) {
  const json = JSON.parse(GLEIF_BUF.toString("utf8"));
  mutate(json);
  return Buffer.from(JSON.stringify(json));
}

const failing = async (): Promise<GleifFetchResult> => {
  throw new Error("network down");
};

function run(day: string, gleif: (leis: string[]) => Promise<GleifFetchResult>) {
  return runIngest({
    fromFile: ESMA_CSV,
    fetchedAt: "2026-10-30T05:00:00Z",
    date: day,
    dataDir,
    changelogPath: join(tmpDir, "CHANGELOG-data.md"),
    now: new Date(`${day}T12:00:00Z`),
    log: () => {},
    gleif,
  });
}

function lines(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as unknown);
}

const evidencePath = () => join(dataDir, "evidence", "evidence.jsonl");
const runs = () => lines(join(dataDir, "runs.jsonl")).map((l) => RunRecordSchema.parse(l));
const lastRun = () => JSON.parse(readFileSync(join(dataDir, "last-run.json"), "utf8"));
const checks = () =>
  ChecksFileSchema.parse(JSON.parse(readFileSync(join(dataDir, "current", "checks.json"), "utf8")));
const gleifEvents = (events: ChangeEvent[]) => events.filter((e) => e.source === "gleif");

describe("runIngest with GLEIF — first run", () => {
  it("writes evidence, checks, raw response and run hashes", async () => {
    const result = await run("2026-11-11", gleifFrom(GLEIF_BUF));

    const evidence = lines(evidencePath()).map((l) => EvidenceSchema.parse(l));
    expect(evidence).toHaveLength(25);

    const file = checks();
    expect(file.issuers).toHaveLength(25);
    expect(file.issuers.find((c) => c.lei === STABLR)?.levelReached).toBe("L1");
    expect(file.issuers.find((c) => c.lei === EURODOLLAR)?.levelReached).toBeNull();

    expect(existsSync(join(dataDir, "raw", "2026-11-11", "gleif.json"))).toBe(true);

    const [line] = runs();
    expect(line?.sources?.gleif).toEqual({
      status: "ok",
      contentSha256: computeSha256(GLEIF_BUF),
      recordsSha256: computeRecordsSha256(parseGleifResponse(GLEIF_BUF)),
    });
    expect(lastRun().sourceAlerts).toEqual([]);

    const events = gleifEvents(result.events);
    const lapsed = events.find((e) => e.key === EURODOLLAR && e.kind === "signal_added");
    expect(lapsed?.severity).toBe("warning");
    expect(lapsed?.message).toBe(
      `GLEIF: LEI registration status LAPSED (next renewal date 2026-10-31). Source: https://search.gleif.org/#/record/${EURODOLLAR} (checked 2026-11-11).`
    );
    const monerium = events.find((e) => e.key === MONERIUM && e.kind === "discrepancy_added");
    expect(monerium?.severity).toBe("info");
    expect(monerium?.field).toBe("name_format");
    expect(monerium?.message).toContain(
      `ESMA register: legal name "Monerium ehf". GLEIF: "Monerium hf."`
    );

    const changelog = readFileSync(join(tmpDir, "CHANGELOG-data.md"), "utf8");
    expect(changelog).toContain("GLEIF: LEI registration status LAPSED");
    expect(result.events.filter((e) => e.source === "esma").length).toBeGreaterThan(0);
  });
});

describe("runIngest with GLEIF — following runs", () => {
  it("adds no evidence or events when nothing observed changed, but records the check", async () => {
    await run("2026-11-11", gleifFrom(GLEIF_BUF));
    const sameRecords = patched((json) => {
      (
        json as unknown as { meta: { goldenCopy: { publishDate: string } } }
      ).meta.goldenCopy.publishDate = "2026-11-12T08:00:00Z";
    });
    const result = await run("2026-11-12", gleifFrom(sameRecords));

    expect(result.events).toEqual([]);
    expect(lines(evidencePath())).toHaveLength(25);
    expect(runs().at(-1)?.sources?.gleif.status).toBe("ok");
    expect(runs().at(-1)?.sources?.gleif.contentSha256).toBe(computeSha256(sameRecords));
    expect(readdirSync(join(dataDir, "raw")).filter((d) => d === "2026-11-12")).toEqual([
      "2026-11-12",
    ]);
    expect(existsSync(join(dataDir, "raw", "2026-11-12", "gleif.json"))).toBe(false);
    expect(checks().issuers.find((c) => c.lei === STABLR)?.lastCheckedAt.gleif).toBe(
      "2026-11-12T12:00:00.000Z"
    );
  });

  it("clears a signal and appends evidence when GLEIF shows the LEI renewed", async () => {
    await run("2026-11-11", gleifFrom(GLEIF_BUF));
    const renewed = patched((json) => {
      const rec = json.data.find((d) => d.attributes["lei"] === EURODOLLAR)!;
      rec.attributes["registration"].status = "ISSUED";
      rec.attributes["registration"].nextRenewalDate = "2027-10-31T23:00:00Z";
    });
    const result = await run("2026-11-12", gleifFrom(renewed));

    expect(gleifEvents(result.events).map((e) => [e.key, e.kind, e.severity])).toEqual([
      [EURODOLLAR, "signal_cleared", "info"],
    ]);
    expect(gleifEvents(result.events)[0]?.message).toContain(
      "GLEIF: LEI registration status ISSUED (previously LAPSED)."
    );
    expect(lines(evidencePath())).toHaveLength(26);
    expect(checks().issuers.find((c) => c.lei === EURODOLLAR)?.levelReached).toBe("L1");
  });

  it("counts a critical signal in last-run.json", async () => {
    await run("2026-11-11", gleifFrom(GLEIF_BUF));
    const retired = patched((json) => {
      const rec = json.data.find((d) => d.attributes["lei"] === STABLR)!;
      rec.attributes["registration"].status = "RETIRED";
    });
    const result = await run("2026-11-12", gleifFrom(retired));

    expect(gleifEvents(result.events).map((e) => [e.key, e.kind, e.severity])).toEqual([
      [STABLR, "signal_added", "critical"],
    ]);
    expect(lastRun().critical).toBe(1);
  });
});

describe("runIngest with GLEIF — failures", () => {
  it("does not fail the ingest and keeps the last known checks", async () => {
    await run("2026-11-11", gleifFrom(GLEIF_BUF));
    const result = await run("2026-11-12", failing);

    expect(gleifEvents(result.events)).toEqual([]);
    expect(runs().at(-1)?.sources?.gleif).toEqual({
      status: "not_checked",
      contentSha256: null,
      recordsSha256: null,
    });
    const eurodollar = checks().issuers.find((c) => c.lei === EURODOLLAR);
    expect(eurodollar?.signals.map((s) => s.kind)).toEqual(["lei_lapsed"]);
    expect(eurodollar?.lastCheckedAt.gleif).toBe("2026-11-11T12:00:00.000Z");
    expect(lastRun().sources.gleif.status).toBe("not_checked");
    expect(lastRun().sourceAlerts).toEqual([]);
  });

  it("lists gleif in sourceAlerts after 3 consecutive days not checked", async () => {
    await run("2026-11-11", gleifFrom(GLEIF_BUF));
    await run("2026-11-12", failing);
    await run("2026-11-13", failing);
    expect(lastRun().sourceAlerts).toEqual([]);
    await run("2026-11-14", failing);
    expect(lastRun().sourceAlerts).toEqual(["gleif"]);
    await run("2026-11-15", gleifFrom(GLEIF_BUF));
    expect(lastRun().sourceAlerts).toEqual([]);
  });

  it("runs without GLEIF when no fetcher is given (historical file loads)", async () => {
    await runIngest({
      fromFile: ESMA_CSV,
      fetchedAt: "2026-10-30T05:00:00Z",
      date: "2026-11-11",
      dataDir,
      changelogPath: join(tmpDir, "CHANGELOG-data.md"),
      log: () => {},
    });
    expect(runs()[0]?.sources).toBeUndefined();
    expect(existsSync(join(dataDir, "current", "checks.json"))).toBe(false);
  });
});
