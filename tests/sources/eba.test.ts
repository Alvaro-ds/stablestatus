import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FetchError } from "../../src/esma/fetch.js";
import { computeSha256 } from "../../src/esma/store.js";
import { readZipEntries } from "../../src/lib/zip.js";
import {
  EBA_METADATA_URL,
  computeEbaRecordsSha256,
  fetchEbaRegister,
  parseEbaMetadata,
  parseEbaRegister,
  readEbaZip,
  storeEbaExtract,
} from "../../src/sources/eba.js";
import { UnexpectedContentError } from "../../src/sources/http.js";

const FIXTURES = join(__dirname, "../fixtures/eba");
const ZIP = readFileSync(join(FIXTURES, "download-PSDMD-202611120800.zip"));
const METADATA = readFileSync(join(FIXTURES, "filemetadata_2026-11-12.json"));
const ZIP_URL =
  "https://euclid.eba.europa.eu/register/downloads/PSDMD/20261112/download-PSDMD-202611120800.zip";

function metadataFor(zip: Buffer): string {
  const m = JSON.parse(METADATA.toString("utf8"));
  return JSON.stringify({ ...m, sha256_hash: computeSha256(zip) });
}

function fakeFetch(responses: Record<string, () => Response>) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const r = responses[url];
    if (!r) throw new Error(`unexpected ${url}`);
    return r();
  };
  return { fn, calls };
}

const json = (body: string) =>
  new Response(body, { headers: { "content-type": "application/json; charset=utf-8" } });
const zipResponse = (body: Buffer) =>
  new Response(new Uint8Array(body), { headers: { "content-type": "application/zip" } });
const noSleep = () => Promise.resolve();

describe("parseEbaMetadata", () => {
  it("builds the ZIP URL from the real metadata", () => {
    expect(parseEbaMetadata(METADATA)).toEqual({
      zipUrl: ZIP_URL,
      sha256: "46d54d783780aacbe01d3a3164a8a14e6b78799fcba63a12de9d9f2303e14210",
    });
  });

  it("rejects a ZIP location outside the EBA downloads path", () => {
    const m = JSON.parse(METADATA.toString("utf8"));
    const evil = { ...m, golden_copy_path_context: "https://example.com/" };
    expect(() => parseEbaMetadata(Buffer.from(JSON.stringify(evil)))).toThrow();
    const traversal = { ...m, latest_version_relative_zip_path: "../../x.zip" };
    expect(() => parseEbaMetadata(Buffer.from(JSON.stringify(traversal)))).toThrow();
  });
});

describe("readEbaZip and parseEbaRegister", () => {
  it("reads the real register extract and keeps only e-money institutions", () => {
    const entities = parseEbaRegister(readEbaZip(ZIP));
    const types = new Set(entities.map((e) => e.record.entityType));
    expect(types).toEqual(new Set(["PSD_EMI", "PSD_EEMI"]));
    expect(entities.find((e) => e.record.entityCode === "NL_DNB!R180692")?.record).toEqual({
      entityCode: "NL_DNB!R180692",
      entityType: "PSD_EMI",
      caOwnerId: "NL_DNB",
      nationalId: "R180692",
      name: "Aplauz NL B.V.",
      authDates: ["2023-02-15"],
    });
  });

  it("trims national IDs and joins multi-language names", () => {
    const entities = parseEbaRegister(readEbaZip(ZIP));
    const bg = entities.find((e) => e.record.entityCode === "BG_BNB!204112059")?.record;
    expect(bg?.name).toBe("Изи Пеймънт Сървисиз ООД / Easy Payment Services OOD");
    const lt = entities.find((e) => e.record.entityCode === "305682465")?.record;
    expect(lt?.nationalId).toBe("LB002168");
  });

  it("keeps withdrawn entities with their alternating dates", () => {
    const entities = parseEbaRegister(readEbaZip(ZIP));
    const w = entities.find((e) => e.record.entityCode === "NL_DNB!R182875")?.record;
    expect(w?.authDates).toEqual(["2022-07-29", "2026-05-21"]);
  });

  it("rejects a corrupted ZIP", () => {
    const entries = readZipEntries(ZIP);
    expect(entries.size).toBe(2);
    const corrupted = Buffer.from(ZIP);
    corrupted.writeUInt8(corrupted.readUInt8(1000) ^ 0xff, 1000);
    expect(() => readEbaZip(corrupted)).toThrow();
  });

  it("fails on an unexpected structure", () => {
    expect(() => parseEbaRegister(Buffer.from("{}"))).toThrow();
    const bad = JSON.stringify([
      [],
      [{ EntityType: "PSD_EMI", EntityCode: "X", CA_OwnerID: "NL_DNB", Properties: [] }],
    ]);
    expect(() => parseEbaRegister(Buffer.from(bad))).toThrow();
  });
});

describe("fetchEbaRegister", () => {
  it("downloads metadata then the ZIP, and hashes the ZIP bytes", async () => {
    const { fn, calls } = fakeFetch({
      [EBA_METADATA_URL]: () => json(metadataFor(ZIP)),
      [ZIP_URL]: () => zipResponse(ZIP),
    });
    const result = await fetchEbaRegister({
      fetch: fn,
      sleep: noSleep,
      now: () => new Date("2026-11-12T09:00:00Z"),
    });
    expect(calls).toEqual([EBA_METADATA_URL, ZIP_URL]);
    expect(result.url).toBe(ZIP_URL);
    expect(result.retrievedAt).toBe("2026-11-12T09:00:00.000Z");
    expect(result.contentSha256).toBe(computeSha256(ZIP));
    expect(result.entities.length).toBeGreaterThan(20);
  });

  it("rejects a ZIP that differs from the published sha256", async () => {
    const { fn } = fakeFetch({
      [EBA_METADATA_URL]: () => json(METADATA.toString("utf8")),
      [ZIP_URL]: () => zipResponse(ZIP),
    });
    await expect(fetchEbaRegister({ fetch: fn, sleep: noSleep })).rejects.toThrow(/sha256/);
  });

  it("does not retry an HTML page", async () => {
    const { fn, calls } = fakeFetch({
      [EBA_METADATA_URL]: () =>
        new Response("<html>", { headers: { "content-type": "text/html" } }),
    });
    await expect(fetchEbaRegister({ fetch: fn, sleep: noSleep })).rejects.toBeInstanceOf(
      UnexpectedContentError
    );
    expect(calls).toHaveLength(1);
  });

  it("retries 5xx and then gives up with FetchError", async () => {
    const { fn, calls } = fakeFetch({
      [EBA_METADATA_URL]: () => new Response("", { status: 503 }),
    });
    await expect(fetchEbaRegister({ fetch: fn, sleep: noSleep })).rejects.toBeInstanceOf(
      FetchError
    );
    expect(calls).toHaveLength(3);
  });
});

describe("storeEbaExtract", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "eba-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes only when the selected records change", () => {
    const entities = parseEbaRegister(readEbaZip(ZIP));
    const result = {
      url: ZIP_URL,
      retrievedAt: "2026-11-12T09:00:00.000Z",
      contentSha256: computeSha256(ZIP),
      entities,
    };
    const selected = entities.filter((e) => e.record.caOwnerId === "NL_DNB");

    expect(storeEbaExtract(result, selected, dir, "2026-11-12")).toBe(true);
    const stored = JSON.parse(
      readFileSync(join(dir, "2026-11-12", "eba-pir-extract.json"), "utf8")
    );
    expect(stored.recordsSha256).toBe(computeEbaRecordsSha256(selected.map((e) => e.record)));
    expect(stored.records).toHaveLength(selected.length);

    expect(storeEbaExtract(result, [...selected].reverse(), dir, "2026-11-13")).toBe(false);
    expect(existsSync(join(dir, "2026-11-13"))).toBe(false);
    expect(storeEbaExtract(result, selected.slice(1), dir, "2026-11-14")).toBe(true);
  });

  it("rejects unsafe dates", () => {
    const result = {
      url: ZIP_URL,
      retrievedAt: "2026-11-12T09:00:00.000Z",
      contentSha256: "0".repeat(64),
      entities: [],
    };
    expect(() => storeEbaExtract(result, [], dir, "../x")).toThrow();
  });
});
